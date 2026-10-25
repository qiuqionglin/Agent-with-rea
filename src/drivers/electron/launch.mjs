import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {AppError,sleep,writeJson,runProcess} from '../../utils.mjs';
import {identifyElectron} from './artifact.mjs';
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
export async function prepareElectron(target,out,{workspace=resolve(out,'workspace')}={}){
  const identity=await identifyElectron(target);
  if(!identity.execution.supported)throw new AppError('DESKTOP_BRIDGE_REQUIRED','This application needs an additional desktop execution bridge; static inspection alone cannot produce callable APIs',{blockers:identity.execution.blockers,archive:identity.asarRelativePath,entrypoint:identity.entrypoint,next:'Use inspect electron <app> --out <new-directory> for read-only REA diagnostics'},3);
  await mkdir(workspace,{recursive:true,mode:0o700});
  const profile=resolve(out,'electron-profile');await mkdir(profile,{mode:0o700});
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
