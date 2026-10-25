import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile,mkdir,open} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {realpathSync,existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {AppError,hash,sleep,writeJson} from './sdk.mjs';
import {identifyElectron} from './application-artifact.mjs';
import {runProcess} from './process.mjs';
import {selectedPage,prepareWeb} from './generation-session.mjs';
export {selectedPage};
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
export async function prepareApplication(target,out,flags={}){
  const workspace=resolve(out,'workspace');await mkdir(workspace,{recursive:true,mode:0o700});
  if(/^https?:\/\//.test(target)){const s=await prepareWeb(target,out,flags);s.environment.APP2CLI_WORKSPACE=workspace;return s;}
  const identity=await identifyElectron(target),profile=resolve(out,'electron-profile');await mkdir(profile,{mode:0o700});
  const exe=await runProcess('/usr/bin/plutil',['-extract','CFBundleExecutable','raw',identity.path+'/Contents/Info.plist']);
  if(exe.code!==0||!exe.stdout.trim()||/[\\/]/.test(exe.stdout.trim()))throw new AppError('INVALID_ARTIFACT','Electron bundle executable could not be identified');
  const port=await freePort(),log=await open(resolve(out,'electron.log'),'wx',0o600);
  const child=spawn(resolve(identity.path,'Contents/MacOS',exe.stdout.trim()),['--user-data-dir='+profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{detached:true,stdio:['ignore',log.fd,log.fd],env:process.env});
  await new Promise((r,j)=>{child.once('spawn',r);child.once('error',j);});child.unref();await log.close();
  let browser;
  try{
    for(let i=0;i<100;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:800});break;}catch{}await sleep(200);}
    if(!browser)throw new AppError('ELECTRON_UNAVAILABLE','Owned Electron application did not expose its renderer endpoint');
    let page;for(let i=0;i<80;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('file:')&&decodeURI(p.url()).includes(identity.path+'/'));if(page)break;await sleep(200);}
    if(!page)throw new AppError('TARGET_REQUIRED','No renderer belonging to the supplied application was observed');
    const cdp=await page.context().newCDPSession(page),{targetInfo}=await cdp.send('Target.getTargetInfo');await cdp.detach();
    const session={platform:'electron',url:page.url(),ownedPid:child.pid,artifact:{path:identity.path,asar:identity.asar,sha256:identity.artifact.sha256,name:identity.name,version:identity.version,main:identity.main},profile,environment:{APP2CLI_CDP:'http://127.0.0.1:'+port,APP2CLI_TARGET:targetInfo.targetId,APP2CLI_ARTIFACT:identity.path,APP2CLI_WORKSPACE:workspace}};
    await writeJson(resolve(out,'session.json'),session);return session;
  }catch(e){try{process.kill(child.pid,'SIGTERM');}catch{}throw e;}finally{if(browser)await browser.close();}
}
export const applicationTargetKey=env=>{
  if(!env.APP2CLI_CDP||!env.APP2CLI_TARGET)throw new AppError('SESSION_REQUIRED','Use the generated owned-session environment');return 'web:'+env.APP2CLI_CDP+'|'+env.APP2CLI_TARGET;
};
export async function connectApplication(env,config){
  applicationTargetKey(env);const endpoint=new URL(env.APP2CLI_CDP);if(!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))throw new AppError('SESSION_REQUIRED','Application CDP must be loopback');
  const {browser,page}=await selectedPage({environment:env});
  try{
    const ctx={browser,page,config,workspace:env.APP2CLI_WORKSPACE,artifact:env.APP2CLI_ARTIFACT,namespace:env.APP2CLI_NAMESPACE};
    if(config.artifactSha256){if(!ctx.artifact)throw new AppError('SESSION_REQUIRED','APP2CLI_ARTIFACT is required');if(!decodeURI(page.url()).startsWith('file://'+resolve(ctx.artifact)+'/'))throw new AppError('TARGET_CHANGED','Renderer does not belong to the supplied app');}
    else if(new URL(page.url()).origin!==config.origin)throw new AppError('TARGET_CHANGED','Application origin changed');
    return ctx;
  }catch(e){await browser.close();throw e;}
}
export async function checkApplication(ctx){
  if(ctx.config.artifactSha256){if(hash(await readFile(resolve(ctx.artifact,'Contents/Resources/app.asar')))!==ctx.config.artifactSha256)throw new AppError('VERSION_DRIFT','Application artifact changed');}
  else {
    if(new URL(ctx.page.url()).origin!==ctx.config.origin)throw new AppError('TARGET_CHANGED','Application origin changed');
    if(!ctx.sourceChecked){
      for(const pin of ctx.config.sourcePins||[]){const u=new URL(pin.url);if(u.origin!==ctx.config.origin)throw new AppError('INVALID_ADAPTER','Web source pin must belong to the target origin');const text=await ctx.page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store',redirect:'error'});if(!r.ok)throw Error('Source unavailable');return r.text();},pin.url);if(hash(text)!==pin.sha256)throw new AppError('VERSION_DRIFT','Application source bytes changed');}
      ctx.sourceChecked=true;
    }
  }
}
export function workspacePath(ctx,path){
  if(!ctx.workspace||typeof path!=='string')throw new AppError('WORKSPACE_REQUIRED','Use a private workspace resource');
  const root=realpathSync(ctx.workspace),p=resolve(root,path);if(!p.startsWith(root+'/'))throw new AppError('INVALID_INPUT','Path must remain in the test workspace');
  let ancestor=p;while(!existsSync(ancestor))ancestor=dirname(ancestor);const actual=realpathSync(ancestor);if(actual!==root&&!actual.startsWith(root+'/'))throw new AppError('INVALID_INPUT','Path resolves outside the owned workspace');return p;
}
export async function callApplication(ctx,path,args=[]){
  if(typeof path!=='string'||!path||path.split('.').some(k=>['__proto__','constructor','prototype'].includes(k)))throw new AppError('INVALID_INPUT','Use an observed application API path');
  return ctx.page.evaluate(async({path,args})=>{const keys=path.split('.');let parent=window;for(const k of keys.slice(0,-1))parent=parent?.[k];const fn=parent?.[keys.at(-1)];if(typeof fn!=='function')throw Error('Observed application API is unavailable');return fn.apply(parent,args);},{path,args});
}
export async function browserRequest(ctx,{method='GET',path,body,format='json',csrf}){
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(method)||typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||/[\\#]/.test(path))throw new AppError('INVALID_INPUT','Use a declared same-origin request');
  const response=await ctx.page.evaluate(async({method,path,body,format,csrf})=>{
    const url=new URL(path,location.origin);if(url.origin!==location.origin)throw Error('Cross-origin API request refused');
    const headers={accept:format==='json'?'application/json':'text/html'};let payload;
    if(body!==undefined){if(format==='form'){const p=new URLSearchParams();for(const [k,v]of Object.entries(body))if(Array.isArray(v))for(const x of v)p.append(k,String(x));else if(v!==undefined&&v!==null)p.set(k,String(v));payload=p.toString();headers['content-type']='application/x-www-form-urlencoded';}else{payload=JSON.stringify(body);headers['content-type']='application/json';}}
    if(csrf){const token=csrf.kind==='cookie'?document.cookie.split('; ').find(x=>x.startsWith(csrf.name+'='))?.split('=').slice(1).join('='):document.querySelector(csrf.selector)?.value;if(!token)throw Error('CSRF token unavailable');headers[csrf.header]=decodeURIComponent(token);}
    const r=await fetch(url.href,{method,headers,body:payload,credentials:'same-origin',cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(20000)});const text=await r.text();if(text.length>4*1024*1024)throw Error('Response exceeds limit');return {status:r.status,text,url:r.url,redirected:r.redirected};
  },{method,path,body,format,csrf});
  if(new URL(response.url).origin!==ctx.config.origin)throw new AppError('SESSION_CHANGED','Request left the application origin');
  if(response.status>=400)throw new AppError('API_REJECTED','Application request failed',{method,path,status:response.status},3);
  let data=response.text;if(format==='json'&&data){try{data=JSON.parse(data);}catch{throw new AppError('RESPONSE_SCHEMA_CHANGED','Expected JSON from the observed application API');}}
  return {data,proof:{transport:'browser-api',method,path:new URL(response.url).pathname,status:response.status,bodySha256:hash(response.text),observedAt:new Date().toISOString()}};
}
