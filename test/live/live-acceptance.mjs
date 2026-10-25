import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from '../../src/generator/build.mjs';
import { readJson,writeJson,canonical } from '../../src/sdk.mjs';
const exec=promisify(execFile),stamp=new Date().toISOString().replace(/[:.]/g,'-'),root=resolve('.local/acceptance',stamp);
const report={producer:'Real application acceptance summary; not REA raw output',startedAt:new Date().toISOString(),checks:[],webRestored:false,androidReadback:false};
const state=resolve('.local/acceptance-state'),env={...process.env,APP2CLI_HOME:state};
async function cli(pkg,args,ok=true){let stdout,code=0;try{({stdout}=await exec(process.execPath,[resolve(pkg.output,'cli.mjs'),...args],{env,timeout:90000,maxBuffer:2*1024*1024}));}catch(e){stdout=e.stdout;code=e.code;}const r=JSON.parse(stdout);if(ok){assert.equal(code,0,JSON.stringify(r));assert.equal(r.ok,true);}return r;}
async function check(name,fn){const start=performance.now();await fn();report.checks.push({name,passed:true,durationMs:Math.round(performance.now()-start)});console.error('PASS '+name);}
let web,baseline,created;
try{
  web=await build('examples/todomvc',{evidence:'.local/evidence/web',out:resolve(root,'todomvc')});
  const android=await build('examples/fossify-calculator',{evidence:'.local/evidence/android',out:resolve(root,'fossify-calculator')});
  report.packages=[{id:'todomvc',adapterDigest:web.adapterDigest},{id:'fossify-calculator',adapterDigest:android.adapterDigest}];
  await check('Both generated CLIs expose typed command schemas',async()=>{assert.ok((await cli(web,['--schema'])).commands['todos.create']);assert.ok((await cli(android,['--schema'])).commands.calculate);});
  baseline=await cli(web,['todos','list']);const request='web-'+randomUUID(),title='Acceptance '+stamp;
  await check('Web native creation survives reload',async()=>{created=await cli(web,['todos','create','--title',title,'--request-id',request]);assert.equal(created.data.title,title);assert.equal(created.verification.level,'reload-persisted');});
  await check('Web get and rename use the created object',async()=>{assert.equal((await cli(web,['todos','get','--id',created.data.id])).data.title,title);assert.equal((await cli(web,['todos','rename','--id',created.data.id,'--title',title+' edited'])).data.title,title+' edited');});
  await check('Web completion persists',async()=>{assert.equal((await cli(web,['todos','set_completed','--id',created.data.id,'--completed','true'])).data.completed,true);});
  await check('Web replay creates no duplicate',async()=>{assert.equal((await cli(web,['todos','create','--title',title,'--request-id',request])).replayed,true);assert.equal((await cli(web,['todos','list'])).data.length,baseline.data.length+1);});
  await check('Web stale and invalid writes are rejected',async()=>{assert.equal((await cli(web,['todos','rename','--id',created.data.id,'--title','stale','--expected-revision',baseline.revision],false)).error.code,'STALE_STATE');assert.equal((await cli(web,['todos','set_completed','--id',created.data.id,'--completed','invalid'],false)).error.code,'INVALID_INPUT');});
  await check('Web deletion restores the original list',async()=>{await cli(web,['todos','delete','--id',created.data.id]);created=null;assert.equal(canonical((await cli(web,['todos','list'])).data),canonical(baseline.data));report.webRestored=true;});
  await check('Android display reads the installed native app',async()=>{const s=await cli(android,['display']);assert.equal(typeof s.data.result,'string');});
  const androidRequest='android-'+randomUUID();let beforeAndroid;
  await check('Android native addition yields 42',async()=>{beforeAndroid=await cli(android,['display']);const r=await cli(android,['calculate','--a','15','--operator','add','--b','27','--request-id',androidRequest]);assert.equal(r.data.result,'42');assert.equal(r.verification.level,'native-ui-readback');});
  await check('Android replay returns the earlier verified result',async()=>{assert.equal((await cli(android,['calculate','--a','15','--operator','add','--b','27','--request-id',androidRequest])).replayed,true);assert.equal((await cli(android,['display'])).data.result,'42');});
  await check('Android stale operation and division by zero are rejected',async()=>{assert.equal((await cli(android,['calculate','--a','1','--operator','add','--b','2','--expected-revision',beforeAndroid.revision],false)).error.code,'STALE_STATE');assert.equal((await cli(android,['calculate','--a','1','--operator','divide','--b','0'],false)).error.code,'INVALID_INPUT');});
  await check('Android clear is verified from the UI',async()=>{assert.equal((await cli(android,['clear'])).data.result,'0');});
  await check('Android native multiplication yields 84',async()=>{const r=await cli(android,['calculate','--a','12','--operator','multiply','--b','7']);assert.equal(r.data.result,'84');report.androidReadback=true;report.androidDisplay=r.data;});
  report.status='passed';
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;console.error(e.message);}
finally{
  if(created&&web){try{await cli(web,['todos','delete','--id',created.data.id]);report.webRestored=canonical((await cli(web,['todos','list'])).data)===canonical(baseline.data);}catch{report.cleanupRequired=true;}}
  report.finishedAt=new Date().toISOString();report.passed=report.checks.length;await writeJson(resolve(root,'report.json'),report);await writeJson('.local/acceptance/latest.json',{directory:root,report});console.log(JSON.stringify({status:report.status,passed:report.passed,webRestored:report.webRestored,androidReadback:report.androidReadback,directory:root}));
}
