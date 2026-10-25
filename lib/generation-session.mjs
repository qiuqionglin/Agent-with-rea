import { spawn } from 'node:child_process';
import { access,mkdir,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { AppError,hash,readJson,writeJson,sleep } from './sdk.mjs';
import { runProcess } from './process.mjs';
import { reaEvidence } from './rea.mjs';
import { adb,shell,hierarchy,checkAndroid } from './android.mjs';

export async function chromeExecutable(env=process.env){
  const paths=[env.APP2CLI_CHROME,process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':null,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
  for(const path of paths){try{await access(path);return path;}catch{}}
  throw new AppError('BROWSER_UNAVAILABLE','Install Chrome/Chromium or set APP2CLI_CHROME',{},3);
}
export async function prepareWeb(url,out,flags){
  let endpoint=flags.cdp||process.env.APP2CLI_CDP,ownedPid;
  if(!endpoint){
    const profile=resolve(out,'browser-profile');await mkdir(profile,{mode:0o700});
    const args=['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check'];
    if(!flags.headed)args.push('--headless=new');
    if(process.env.APP2CLI_PROXY)args.push('--proxy-server='+process.env.APP2CLI_PROXY);
    args.push('about:blank');
    const child=spawn(await chromeExecutable(),args,{detached:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();ownedPid=child.pid;
    for(let i=0;i<100;i++){
      try{const port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];if(/^\d+$/.test(port)){endpoint='http://127.0.0.1:'+port;break;}}catch{}
      await sleep(100);
    }
    if(!endpoint){process.kill(ownedPid,'SIGTERM');throw new AppError('BROWSER_UNAVAILABLE','Chrome did not expose loopback CDP',{},3);}
  }
  if(!['127.0.0.1','localhost','[::1]'].includes(new URL(endpoint).hostname))throw new AppError('INVALID_INPUT','CDP must use loopback');
  const browser=await chromium.connectOverCDP(endpoint);
  try{
    const pages=browser.contexts().flatMap(c=>c.pages());let page;
    if(flags.target){
      for(const candidate of pages){const cdp=await candidate.context().newCDPSession(candidate);const {targetInfo}=await cdp.send('Target.getTargetInfo');await cdp.detach();if(targetInfo.targetId===flags.target)page=candidate;}
      if(!page||page.url()!==url)throw new AppError('TARGET_REQUIRED','Selected target must already display the input URL',{},3);
    }else{
      page=await browser.contexts()[0].newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
    }
    await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
    const cdp=await page.context().newCDPSession(page);const {targetInfo}=await cdp.send('Target.getTargetInfo');await cdp.detach();
    const session={platform:'web',url:page.url(),ownedPid,environment:{APP2CLI_CDP:endpoint,APP2CLI_TARGET:targetInfo.targetId}};
    await writeJson(resolve(out,'session.json'),session);return session;
  }catch(error){if(ownedPid){try{process.kill(ownedPid,'SIGTERM');}catch{}}throw error;}
  finally{await browser.close();}
}
export async function selectedPage(session){
  const browser=await chromium.connectOverCDP(session.environment.APP2CLI_CDP);
  for(const page of browser.contexts().flatMap(c=>c.pages())){
    const cdp=await page.context().newCDPSession(page);const {targetInfo}=await cdp.send('Target.getTargetInfo');await cdp.detach();
    if(targetInfo.targetId===session.environment.APP2CLI_TARGET)return {browser,page};
  }
  await browser.close();throw new AppError('SESSION_CHANGED','Generation target was closed',{},4);
}
export async function snapshot(session){
  if(session.platform==='android')return {producer:'app2cli live UI observation, not REA',...(await hierarchy(session.android))};
  const {browser,page}=await selectedPage(session);
  try{
    return {producer:'app2cli live DOM observation, not REA',url:page.url(),title:await page.title(),accessibility:await page.locator('body').ariaSnapshot(),dom:await page.evaluate(()=>({
      controls:[...document.querySelectorAll('input,textarea,button,[contenteditable],[role],select,[data-testid]')].slice(0,200).map(e=>({tag:e.tagName,id:e.id,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),title:e.getAttribute('title'),type:e.getAttribute('type'),classes:String(e.className),text:(e.textContent||'').slice(0,120)})),
      globals:Object.keys(window).filter(k=>!/^(on|webkit|chrome|scheduler)/.test(k)).slice(-100),storageKeys:Object.keys(localStorage),scripts:[...document.scripts].map(s=>s.src).filter(Boolean)
    }))};
  }finally{await browser.close();}
}
export async function prepareAndroid(apk,evidence,out,flags){
  const pkg=reaEvidence(await readJson(resolve(evidence,'package.json'))).normalized_result.package_name;
  if(!pkg||!/^[A-Za-z0-9_.]+$/.test(pkg))throw new AppError('INVALID_PACKAGE','REA did not identify an Android package');
  const adbPath=process.env.REA_ADB_PATH||'adb';let serial=flags.serial||process.env.APP2CLI_ANDROID_SERIAL;
  if(!serial){
    const result=await runProcess(adbPath,['devices']);const devices=result.stdout.split('\n').filter(l=>/\tdevice$/.test(l)).map(l=>l.split('\t')[0]);
    if(devices.length!==1)throw new AppError('DEVICE_REQUIRED','Connect one authorized Android device or pass --serial',{},3);serial=devices[0];
  }
  const ctx={serial,adb:adbPath,config:{package:pkg,apkSha256:hash(await readFile(apk))}};
  // pm path exits 1 for an absent package. Query the successful empty-list
  // form so an authorized first install does not fail before --install runs.
  const installed=(await shell(ctx,['pm','list','packages',pkg])).trim().split(/\r?\n/).includes('package:'+pkg);
  if(!installed){
    if(!flags.install)throw new AppError('INSTALL_REQUIRED','APK is not installed; use --install on a dedicated test device',{},3);
    const result=await adb(ctx,['install',apk],{timeout:180000});if(!result.includes('Success'))throw new AppError('INSTALL_FAILED',result,{},3);
  }
  await checkAndroid(ctx,ctx.config);
  const component=(await shell(ctx,['cmd','package','resolve-activity','--brief',pkg])).trim().split('\n').at(-1);
  if(!component.startsWith(pkg+'/'))throw new AppError('LAUNCH_FAILED','No exported launcher resolved',{},3);
  ctx.config.component=component;const launched=await shell(ctx,['am','start','-n',component]);
  if(/Error|Exception|Permission Denial/.test(launched))throw new AppError('LAUNCH_FAILED','Resolved activity did not launch',{},3);
  const session={platform:'android',apk,android:ctx,environment:{APP2CLI_ANDROID_SERIAL:serial,REA_ADB_PATH:adbPath}};
  await writeJson(resolve(out,'session.json'),session);return session;
}
