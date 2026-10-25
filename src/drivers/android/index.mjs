import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { AppError,hash,sleep } from '../../sdk.mjs';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../utils.mjs';
const exec=promisify(execFile),quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
export function androidTargetKey(env){
  if(!env.APP2CLI_ANDROID_SERIAL)throw new AppError('SESSION_REQUIRED','Set APP2CLI_ANDROID_SERIAL to one adb devices serial',{},3);
  return 'android:'+env.APP2CLI_ANDROID_SERIAL;
}
export async function adb(ctx,args,options={}){
  try{return (await exec(ctx.adb,['-s',ctx.serial,...args],{timeout:options.timeout||30000,maxBuffer:4*1024*1024,encoding:options.binary?null:'utf8'})).stdout;}
  catch(e){throw new AppError('ADB_FAILED','ADB operation failed',{operation:args[0],message:String(e.stderr||e.message).slice(0,400)},3);}
}
export const shell=(ctx,args)=>adb(ctx,['shell',args.map(quote).join(' ')]);
export async function nativeHelper(ctx,request){
  const python=ctx.python||process.env.APP2CLI_UIAUTOMATOR_PYTHON;
  if(!python)throw new AppError('TEXT_BACKEND_REQUIRED','Set APP2CLI_UIAUTOMATOR_PYTHON to a Python environment with uiautomator2==3.7.1',{},3);
  const result=await runProcess(python,[fileURLToPath(new URL('./text.py',import.meta.url))],{input:JSON.stringify({...request,serial:ctx.serial,package:ctx.config.package}),env:{...process.env,ADBUTILS_ADB_PATH:ctx.adb},timeout:60000});
  let answer;try{answer=JSON.parse(result.stdout);}catch{}
  if(result.code!==0||!answer?.ok)throw new AppError('NATIVE_HELPER_FAILED','Native accessibility helper failed',{reason:answer?.error||'Helper unavailable'},3);
  return answer;
}
export async function connectAndroid(env,config){
  androidTargetKey(env);const ctx={serial:env.APP2CLI_ANDROID_SERIAL,adb:env.REA_ADB_PATH||'adb',config};
  await checkAndroid(ctx,config);
  const activities=await shell(ctx,['dumpsys','activity','activities']);
  const resumed=activities.split('\n').filter(line=>/topResumedActivity|mResumedActivity/.test(line));
  if(!resumed.some(line=>line.includes(config.package+'/'))){
    const result=await shell(ctx,['am','start','-n',config.component]);
    if(/Error|Exception|Permission Denial/.test(result))throw new AppError('LAUNCH_FAILED','Exported activity did not launch',{},3);
  }
  return ctx;
}
export async function checkAndroid(ctx,config){
  const output=await shell(ctx,['pm','path',config.package]);const paths=output.trim().split(/\r?\n/).filter(x=>x.startsWith('package:')).map(x=>x.slice(8));
  if(paths.length!==1)throw new AppError('APK_SET_CHANGED','Example expects one installed standalone APK',{},4);
  const digest=(await shell(ctx,['sha256sum',paths[0]])).trim().split(/\s+/)[0];
  if(digest!==config.apkSha256)throw new AppError('VERSION_DRIFT','Installed APK differs from REA-analyzed release',{},4);
}
export async function hierarchy(ctx){
  const path='/data/local/tmp/app2cli-'+randomUUID()+'.xml';
  try{
    let xml;
    if(ctx.python||process.env.APP2CLI_UIAUTOMATOR_PYTHON)xml=(await nativeHelper(ctx,{mode:'dump'})).xml;
    else{
    for(let attempt=0;attempt<3;attempt++){
      const status=await shell(ctx,['uiautomator','dump','--compressed',path]);
      if(status.includes('dumped'))break;
      if(attempt===2)throw new AppError('UI_UNAVAILABLE','Native UI hierarchy is not ready',{},3);
      await sleep(300);
    }
      xml=await adb(ctx,['exec-out','cat',path]);
    }
    if(typeof xml!=='string'||!xml.includes('<hierarchy'))throw new AppError('UI_UNAVAILABLE','Native observer returned no hierarchy',{},3);
    const doc=new DOMParser().parseFromString(xml,'text/xml');
    const elements=[...doc.getElementsByTagName('node')];
    const nodes=elements.map((n,index)=>({...Object.fromEntries(['resource-id','text','content-desc','package','class','bounds','clickable','long-clickable','enabled','focusable','focused','password','selected','checked','checkable','scrollable'].map(k=>[k,n.getAttribute(k)])),nodeIndex:index,parentIndex:elements.indexOf(n.parentNode)}));
    if(!nodes.some(n=>n.package===ctx.config.package))throw new AppError('SESSION_CHANGED','Expected app is not visible',{},4);
    return {nodes,sha256:hash(xml)};
  }finally{if(!ctx.python&&!process.env.APP2CLI_UIAUTOMATOR_PYTHON)await shell(ctx,['rm','-f',path]).catch(()=>{});}
}
export function nodeById(tree,id){const found=tree.nodes.filter(n=>n['resource-id']===id);if(found.length!==1)throw new AppError('UI_CHANGED','Expected one native UI element',{id},4);return found[0];}
export async function tap(ctx,node,longPress=false){
  const m=/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.bounds);if(!m||node.clickable!=='true'||node.enabled!=='true')throw new AppError('UI_CHANGED','Element is not actionable',{},4);
  const x=Math.floor((Number(m[1])+Number(m[3]))/2),y=Math.floor((Number(m[2])+Number(m[4]))/2);
  await shell(ctx,longPress?['input','swipe',x,y,x,y,800]:['input','tap',x,y]);
}
