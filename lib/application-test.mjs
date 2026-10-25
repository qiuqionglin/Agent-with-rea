import assert from 'node:assert/strict';
import {readFile,mkdir,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {selectedPage} from './application-session.mjs';
import {recordApplicationNetwork} from './application-observation.mjs';
import {runProcess} from './process.mjs';
import {AppError,canonical,hash,writeJson,sleep} from './sdk.mjs';
export function valueAt(value,path){if(typeof path!=='string'||!path||path.split('.').some(k=>!k||['__proto__','prototype','constructor'].includes(k)))throw new AppError('INVALID_PLAN','Use a plain observed data path');return path.split('.').reduce((v,k)=>v?.[k],value);}
export function resolveApplicationValue(value,context){
  if(typeof value==='string'){
    const exact=/^\$\{([^}]+)\}$/.exec(value);if(exact){const v=valueAt(context,exact[1]);if(v===undefined)throw new AppError('INVALID_PLAN','Unresolved scenario reference',{reference:exact[1]});return v;}
    return value.replace(/\$\{([^}]+)\}/g,(_,path)=>{const v=valueAt(context,path);if(v===undefined)throw new AppError('INVALID_PLAN','Unresolved scenario reference',{reference:path});return String(v);});
  }
  if(Array.isArray(value))return value.map(v=>resolveApplicationValue(v,context));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveApplicationValue(v,context)]));return value;
}
export function validateApplicationPlan(plan,manifest){
  if(plan?.schemaVersion!==3||plan.semantics!=='application-journey'||!Array.isArray(plan.steps)||plan.steps.length<5||plan.steps.length>20||!Array.isArray(plan.cleanup)||plan.cleanup.length<1)throw new AppError('INVALID_PLAN','Use a 5-20 step application journey with explicit cleanup');
  const names=new Set(),commands=new Set(),cleanupNames=new Set(plan.cleanup.map(s=>s.name));let writes=0;
  for(const step of [...plan.steps,...plan.cleanup]){
    if(!/^[a-z][a-z0-9_]*$/.test(step.name)||names.has(step.name))throw new AppError('INVALID_PLAN','Step names must be unique');names.add(step.name);
    const command=manifest.commands[step.command];if(!command)throw new AppError('INVALID_PLAN','Step command is not declared');commands.add(step.command);
    if(!['read','create','update','delete','export','navigation'].includes(step.effect)||command.readOnly!==(step.effect==='read'))throw new AppError('INVALID_PLAN','Step effect must match command mutability');
    if(step.changed===false&&!cleanupNames.has(step.name)&&!['read','navigation'].includes(step.effect))throw new AppError('INVALID_PLAN','Content mutations must require an observed change');
    if(!command.readOnly)writes++;
    if(!step.input||!step.witness||!['server-html','server-json','file','page-text'].includes(step.witness.kind)||!['equals','contains','count','absent'].includes(step.witness.comparison))throw new AppError('INVALID_PLAN','Each step needs input and a bounded independent witness');
    for(const predicate of [step.witness,...(step.expect?[step.expect]:[])]){
      if(predicate.comparison!=='absent'&&!Object.hasOwn(predicate,'expected'))throw new AppError('INVALID_PLAN','Independent assertions need an explicit expected value');
      if(predicate.comparison==='contains'&&(typeof predicate.expected!=='string'||!predicate.expected))throw new AppError('INVALID_PLAN','Contains requires nonempty expected text');
      if(predicate.comparison==='count'&&(!Number.isInteger(predicate.expected)||predicate.expected<0))throw new AppError('INVALID_PLAN','Count requires a nonnegative integer');
    }
    if(step.witness.kind.startsWith('server-')&&manifest.platform!=='web'||step.witness.kind==='file'&&manifest.platform!=='electron')throw new AppError('INVALID_PLAN','Observer platform mismatch');
  }
  if(manifest.platform==='electron'&&(!plan.steps.some(s=>s.witness.kind==='file')||!plan.steps.some(s=>s.witness.kind==='page-text')))throw new AppError('INVALID_PLAN','Electron acceptance needs both actual renderer state and persisted file witnesses');
  if(commands.size<4||writes<2)throw new AppError('INVALID_PLAN','Exercise at least four business commands and two mutations');
}
function matches(actual,w){if(w.comparison==='absent')return actual===null||actual===0;if(w.comparison==='contains')return typeof actual==='string'&&actual.includes(String(w.expected));return canonical(actual)===canonical(w.expected);}
export async function observeApplicationWitness(session,witness,{captureOnly=false,timeout=10000}={}){
  const deadline=Date.now()+timeout;let last;
  do{
    if(witness.kind==='file'){
      const root=await realpath(session.environment.APP2CLI_WORKSPACE),path=resolve(root,witness.path);if(!path.startsWith(root+'/'))throw new AppError('INVALID_PLAN','File observer must remain in the owned workspace');
      let bytes;try{const actual=await realpath(path);if(!actual.startsWith(root+'/'))throw new AppError('INVALID_PLAN','Observed file resolves outside workspace');bytes=await readFile(actual);if(bytes.length>4*1024*1024)throw new AppError('OBSERVATION_LIMIT','File exceeds observer bound');}catch(e){if(e.code!=='ENOENT')throw e;}
      last={kind:'file',path:witness.path,actual:bytes?bytes.toString('utf8'):null,sha256:bytes?hash(bytes):null};
    }else{
      const {browser,page}=await selectedPage(session);try{
        if(witness.kind==='page-text'){const l=page.locator(witness.selector);const count=await l.count();last={kind:witness.kind,actual:witness.comparison==='count'?count:count===1?await l.innerText():count===0?null:null};}
        else{
          const path=witness.path;if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||/[\\#]/.test(path))throw new AppError('INVALID_PLAN','Independent GET must stay on the application origin');
          last=await page.evaluate(async w=>{const u=new URL(w.path,location.origin);if(u.origin!==location.origin)throw Error('Observer origin mismatch');const r=await fetch(u.href,{credentials:'same-origin',cache:'no-store',redirect:'error'});const text=await r.text();if(text.length>4*1024*1024)throw Error('Observer limit');let actual;
            if(w.kind==='server-json'){const data=JSON.parse(text);actual=w.selector?w.selector.split('.').reduce((v,k)=>v?.[k],data):data;}
            else{const doc=new DOMParser().parseFromString(text,'text/html'),es=[...doc.querySelectorAll(w.selector)];actual=w.comparison==='count'?es.length:w.comparison==='absent'?es.length:es.map(e=>w.attribute?e.getAttribute(w.attribute):(e.textContent||'').trim()).join('\n');}
            return {kind:w.kind,status:r.status,actual,body:text};},witness);
          if(last.status!==200)throw new AppError('OBSERVER_HTTP_FAILED','Independent GET failed',{status:last.status});last.bodySha256=hash(last.body);delete last.body;
        }
      }finally{await browser.close();}
    }
    last.capturedAt=new Date().toISOString();if(captureOnly||matches(last.actual,witness))return last;await sleep(200);
  }while(Date.now()<deadline);
  throw new AppError('INDEPENDENT_WITNESS_FAILED','Independent application state did not confirm the requested operation',{witness,last},5);
}
export async function testApplication(packageDir,plan,session,out,{marker}={}){
  await mkdir(out,{recursive:true});const env={...process.env,...session.environment,APP2CLI_HOME:resolve(out,'state')},context={marker,workspace:session.environment.APP2CLI_WORKSPACE,steps:{}};
  const report={producer:'Independent application-journey runner; no generated adapter imported by observers',status:'running',checks:[],steps:[],startedAt:new Date().toISOString(),cleanupComplete:false};let sequence=0,dirty=false;
  async function invoke(step,extra=[]){const input=resolveApplicationValue(step.input,context),result=await runProcess(process.execPath,[resolve(packageDir,'cli.mjs'),...step.command.split('.'),'--input',JSON.stringify(input),...extra],{env,timeout:90000,log:resolve(out,'call-'+(++sequence))});let j;try{j=JSON.parse(result.stdout);}catch{throw new AppError('CLI_PROTOCOL_FAILED','CLI did not return one JSON object');}return {result:j,exitCode:result.code,input};}
  async function call(step,extra=[]){const r=await invoke(step,extra);if(r.exitCode!==0||!r.result.ok)throw new AppError('CLI_TEST_FAILED','Generated CLI invocation failed',{command:step.command,response:r.result},5);return r;}
  const check=name=>report.checks.push({name,passed:true});
  async function executeStep(step,cleanup=false){
    let before;try{before=await observeApplicationWitness(session,resolveApplicationValue(step.witness,context),{captureOnly:true});}catch(e){if(e.code!=='INVALID_PLAN')throw e;}
    const {browser,page}=await selectedPage(session),network=[];const stop=await recordApplicationNetwork(page,network);
    const requestId=(cleanup?'cleanup-':'step-')+randomUUID();let dry,r;
    try{
    if(!cleanup&&!['read','navigation'].includes(step.effect)&&!report.runtimeGuardsTested&&before){
      dry=await call(step,['--dry-run']);if(dry.result.dryRun!==true)throw new AppError('DRY_RUN_FAILED','CLI did not honor dry run');
      const unchanged=await observeApplicationWitness(session,resolveApplicationValue(step.witness,context),{captureOnly:true});if(canonical(unchanged.actual)!==canonical(before.actual))throw new AppError('DRY_RUN_MUTATED','Dry run changed independent application state');check('Dry run preserves independently observed state');
    }
    r=await call(step,['--request-id',requestId]);}finally{await stop();await browser.close();}
    context.steps[step.name]=r.result;
    const witness=resolveApplicationValue(step.witness,context),after=await observeApplicationWitness(session,witness);
    if(step.changed!==false&&!['read','navigation'].includes(step.effect)&&before&&canonical(before.actual)===canonical(after.actual))throw new AppError('NO_OBSERVED_CHANGE','Mutation witness did not change',{step:step.name},5);
    if(step.effect!=='read'&&session.platform==='web'&&!(cleanup&&step.changed===false)&&!network.some(e=>['POST','PUT','PATCH','DELETE'].includes(e.request.method)))throw new AppError('NO_API_DISPATCH','Web mutation produced no observed HTTP mutation request',{step:step.name},5);
    if(dry){
      const replay=await call(step,['--request-id',requestId]);if(replay.result.replayed!==true)throw new AppError('REPLAY_FAILED','Verified request was not deduplicated');await observeApplicationWitness(session,witness);check('Mutation replay is deduplicated');
      if(dry.result.revision!==r.result.revision){const stale=await invoke(step,['--request-id','stale-'+randomUUID(),'--expected-revision',dry.result.revision]);if(stale.result.error?.code!=='STALE_STATE')throw new AppError('STALE_GUARD_FAILED','Stale state was not rejected');check('Stale revision rejected');}
      report.runtimeGuardsTested=true;
    }
    if(step.expect){const e=resolveApplicationValue(step.expect,context);if(!matches(valueAt(r.result.data,e.path),e))throw new AppError('CLI_RESULT_MISMATCH','CLI result does not match its declared outcome',{step:step.name},5);}
    const record={name:step.name,command:step.command,effect:step.effect,transitionObserved:!!before&&canonical(before.actual)!==canonical(after.actual),before,after,network:network.map(e=>({method:e.request.method,url:e.request.url,status:e.response.status})),passed:true};report.steps.push(record);await writeJson(resolve(out,'step-'+step.name+'.json'),record);check(step.name+' independent readback');return r;
  }
  try{
    const schema=await runProcess(process.execPath,[resolve(packageDir,'cli.mjs'),'--schema'],{env,timeout:30000});assert.equal(schema.code,0);check('Generated multi-command CLI schema');
    for(const step of plan.steps){if(step.effect!=='read')dirty=true;await executeStep(step);}
    for(const step of plan.cleanup)await executeStep(step,true);report.cleanupComplete=true;dirty=false;check('Declared cleanup independently confirmed');report.status='passed';
  }catch(e){report.status='failed';report.error={code:e.code||'TEST_FAILED',message:e.message,details:e.details};if(dirty){try{for(const step of plan.cleanup)await executeStep(step,true);report.cleanupComplete=true;}catch(c){report.cleanupError={code:c.code||'CLEANUP_FAILED',message:c.message,details:c.details};}}}
  report.bindings=context.steps;report.finishedAt=new Date().toISOString();await writeJson(resolve(out,'test-report.json'),report);return report;
}
