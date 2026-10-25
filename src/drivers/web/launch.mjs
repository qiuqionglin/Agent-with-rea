import {spawn} from 'node:child_process';
import {access,mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {AppError,writeJson,sleep} from '../../utils.mjs';
async function chromeExecutable(env=process.env){
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
