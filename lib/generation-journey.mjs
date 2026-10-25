import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runProcess } from './process.mjs';
import { AppError,writeJson } from './sdk.mjs';
import { validateNativeState } from './android-ui.mjs';

// v2 tests navigation to observed screens, not persistent account mutations.
// Cleanup establishes a declared landing screen, not an identical video/feed.
export function validateJourney(plan,manifest){
  if(plan.schemaVersion!==2||manifest.platform!=='android'||!Array.isArray(plan.steps)||plan.steps.length<2||plan.steps.length>20)throw new AppError('INVALID_TEST_PLAN','Android journey needs 2-20 steps and schemaVersion 2');
  if(!manifest.commands[plan.read?.command]?.readOnly)throw new AppError('INVALID_TEST_PLAN','Journey requires a separate read command');
  const names=new Set();
  for(const step of [plan.start,...plan.steps,plan.cleanup]){
    if(!step||typeof step.name!=='string'||!/^[a-z][a-z0-9-]{0,59}$/.test(step.name)||!manifest.commands[step.command]||manifest.commands[step.command].readOnly!==false||step.effect!=='navigation'||!step.input||Array.isArray(step.input)||typeof step.input!=='object')throw new AppError('INVALID_TEST_PLAN','Every journey action must have a slug name, navigation command and object input');
    validateNativeState(step.witness);
    if(!step.readback||typeof step.readback.path!=='string'||!step.readback.path||step.readback.path.split('.').some(k=>!k||['__proto__','constructor','prototype'].includes(k))||!['string','number','boolean'].includes(typeof step.readback.value))throw new AppError('INVALID_TEST_PLAN','Each screen needs an explicit fresh CLI readback field and scalar expected value');
  }
  for(const step of plan.steps){if(names.has(step.name))throw new AppError('INVALID_TEST_PLAN','Step names must be unique');names.add(step.name);}
  if(JSON.stringify(plan.start.witness)!==JSON.stringify(plan.cleanup.witness))throw new AppError('INVALID_TEST_PLAN','Cleanup must return to the declared starting screen');
}
export async function testAndroidJourney(packageDir,plan,session,out,{observe,invoke:providedInvoke}={}){
  const report={producer:'app2cli independent navigation test runner, not agent self-assessment',semantics:'android-journey',status:'running',checks:[],steps:[],mutationAttempted:false,restorationScope:'declared landing screen only; feed item, history and server state are not restored',startedAt:new Date().toISOString()};
  let sequence=0,dirty=false;
  const env={...process.env,...session.environment,APP2CLI_HOME:resolve(out,'state')};
  const checkpoint=()=>writeJson(resolve(out,'test-progress.json'),{...report,updatedAt:new Date().toISOString()});
  const invoke=providedInvoke||(async(command,input={},extra=[])=>{
    const result=await runProcess(process.execPath,[resolve(packageDir,'cli.mjs'),...command.split('.'),'--input',JSON.stringify(input),...extra],{env,timeout:120000,log:resolve(out,'call-'+(++sequence))});
    let json;try{json=JSON.parse(result.stdout);}catch{throw new AppError('CLI_PROTOCOL_FAILED','CLI did not return a JSON object');}
    return {...result,json};
  });
  const call=async(command,input,extra)=>{const r=await invoke(command,input,extra);if(r.code!==0||!r.json.ok)throw new AppError('CLI_TEST_FAILED','Generated navigation command failed',{command,response:r.json},5);return r.json;};
  const check=(name,details={})=>report.checks.push({name,passed:true,...details});
  const witness=(step,suffix='',options={})=>observe(session,step.witness,{record:resolve(out,step.name+suffix+'-witness.json'),...options});
  const readback=async step=>{
    const fresh=await call(plan.read.command,plan.read.input||{});
    const value=step.readback.path.split('.').reduce((v,k)=>v?.[k],fresh.data);
    assert.deepEqual(value,step.readback.value,'Fresh CLI read did not report the observed screen');
  };
  const cleanup=async()=>{
    await call(plan.cleanup.command,plan.cleanup.input,['--request-id','cleanup-'+randomUUID()]);
    report.cleanupWitness=await witness(plan.cleanup);await readback(plan.cleanup);report.restored=true;dirty=false;await checkpoint();
  };
  try{
    dirty=true;report.mutationAttempted=true;await checkpoint();
    await call(plan.start.command,plan.start.input,['--request-id','start-'+randomUUID()]);
    await witness(plan.start);await readback(plan.start);check('Declared initial screen observed');
    for(const [index,step]of plan.steps.entries()){
      const prior=index?plan.steps[index-1]:plan.start;
      await call(plan.read.command,plan.read.input||{});
      // A no-op cannot pass by choosing an already satisfied screen predicate.
      const before=await witness(step,'-before',{captureOnly:true});
      if(before.matched)throw new AppError('INVALID_TEST_PLAN','Navigation objective already holds before dispatch',{step:step.name});
      const dry=await call(step.command,step.input,['--dry-run']);assert.equal(dry.dryRun,true);
      await witness(prior,'-after-dry');
      const afterDry=await witness(step,'-dry-target',{captureOnly:true});
      assert.equal(afterDry.matched,false,'Dry run reached the target screen');check(step.name+': dry run preserves starting screen');
      const requestId='journey-'+randomUUID();
      const result=await call(step.command,step.input,['--request-id',requestId]);
      assert.ok(result.verification?.stages.includes('fresh_readback_verified'));
      const native=await witness(step,'',{screenshot:resolve(out,'step-'+(index+1)+'.png')});
      check(step.name+': independent native postcondition',native);
      await readback(step);await witness(step,'-fresh');
      check(step.name+': separate CLI read and native reread');
      const replay=await call(step.command,step.input,['--request-id',requestId]);assert.equal(replay.replayed,true);await witness(step,'-replay');
      check(step.name+': replay is deduplicated');
      report.steps.push({name:step.name,command:step.command,input:step.input,readback:step.readback,verified:true,witness:step.witness});await checkpoint();
    }
    // Explicit bad revision must fail before dispatch even on volatile feeds.
    const stale=await invoke(plan.cleanup.command,plan.cleanup.input,['--request-id','stale-'+randomUUID(),'--expected-revision','invalid-revision']);
    assert.equal(stale.json.error?.code,'STALE_STATE');assert.notEqual(stale.code,0);check('Stale revision rejected before navigation');
    await cleanup();check('Declared landing screen restored');report.status='passed';
  }catch(error){
    report.status='failed';report.error={code:error.code||'TEST_FAILED',message:error.message,details:error.details};
    if(dirty){try{await cleanup();}catch(e){report.cleanupError={code:e.code||'CLEANUP_FAILED',message:e.message,details:e.details};}}
  }
  report.finishedAt=new Date().toISOString();await writeJson(resolve(out,'test-report.json'),report);return report;
}
