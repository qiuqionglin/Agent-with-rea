import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { runProcess } from './process.mjs';
import { readJson,writeJson,AppError,sleep,canonical } from './sdk.mjs';
import { selectedPage } from './generation-session.mjs';
import { adb,hierarchy,nodeById } from './android.mjs';
import { nativeStateMatches,validateNativeState } from './android-ui.mjs';
import { testAndroidJourney,validateJourney } from './generation-journey.mjs';
import { observeHttpWitness,withoutField } from './generation-api.mjs';

export function atPath(value,path){
  if(typeof path!=='string'||!path||path.split('.').some(k=>['__proto__','constructor','prototype'].includes(k)))throw new AppError('INVALID_TEST_PLAN','Use a plain data field path');
  return path.split('.').reduce((v,k)=>v?.[k],value);
}
export function replaceValue(input,value){
  if(input==='$value')return value;
  if(Array.isArray(input))return input.map(x=>replaceValue(x,value));
  if(input&&typeof input==='object')return Object.fromEntries(Object.entries(input).map(([k,v])=>[k,replaceValue(v,value)]));
  return input;
}
export function validatePlan(plan,manifest){
  if(plan?.semantics==='android-journey')return validateJourney(plan,manifest);
  if(plan?.schemaVersion!==1||plan?.semantics!=='replace-value')throw new AppError('INVALID_TEST_PLAN','v1 requires a reversible replace-value scenario');
  for(const [kind,readOnly]of [['read',true],['write',false]]){
    if(!manifest.commands[plan[kind]?.command]||manifest.commands[plan[kind].command].readOnly!==readOnly)throw new AppError('INVALID_TEST_PLAN','Missing read or mutation command');
    if(!plan[kind].input||typeof plan[kind].input!=='object')throw new AppError('INVALID_TEST_PLAN','Inputs must be objects');
  }
  if(!JSON.stringify(plan.write.input).includes('"$value"'))throw new AppError('INVALID_TEST_PLAN','Write must consume $value');
  if(typeof plan.testValue!=='string'&&typeof plan.testValue!=='number')throw new AppError('INVALID_TEST_PLAN','testValue must be a scalar');
  atPath({},plan.valuePath);
  const w=plan.witness;
  if(!w||!['web-text','web-input','android-text','http-json'].includes(w.kind)||typeof w.selector!=='string'||!w.selector||!['equals','contains'].includes(w.comparison))throw new AppError('INVALID_TEST_PLAN','Provide a declarative independent native/server witness');
  if(manifest.platform==='web'&&!w.kind.startsWith('web-')||manifest.platform==='android'&&w.kind!=='android-text'||manifest.platform==='api'&&w.kind!=='http-json')throw new AppError('INVALID_TEST_PLAN','Witness platform mismatch');
  if(w.kind==='http-json'&&w.comparison!=='equals')throw new AppError('INVALID_TEST_PLAN','HTTP field verification must use exact equality');
  if(typeof w.expected!=='string'||!w.expected.trim()||!String(plan.testValue).includes(w.expected))throw new AppError('INVALID_TEST_PLAN','Witness must observe a nonempty part of the test value');
}
export const witnessMatches=(actual,witness)=>witness.comparison==='equals'?actual===witness.expected:actual.includes(witness.expected);
export async function observeWitness(session,witness,{reload=false,screenshot,record,captureOnly=false,timeoutMs=20000}={}){
  if(session.platform==='api')return observeHttpWitness(session,witness,{record,captureOnly,timeoutMs});
  if(witness.kind==='android-state'){
    validateNativeState(witness);
    if(session.platform!=='android')throw new AppError('INVALID_TEST_PLAN','Android state requires an Android session');
    let tree;const end=Date.now()+timeoutMs;
    do{
      tree=await hierarchy({...session.android,python:session.environment?.APP2CLI_UIAUTOMATOR_PYTHON});
      // Restrict every assertion to the target app, never a keyboard/overlay.
      const scoped={...tree,nodes:tree.nodes.filter(n=>n.package===session.android.config.package)};
      const matched=nativeStateMatches(scoped,witness);
      const observation={kind:witness.kind,matched,hierarchySha256:tree.sha256,capturedAt:new Date().toISOString()};
      if(record)await writeJson(record,{producer:'app2cli independent native observation, not adapter output or REA',...observation,witness,hierarchy:tree});
      if(captureOnly||matched){if(screenshot)await writeFile(screenshot,await adb(session.android,['exec-out','screencap','-p'],{binary:true}),{mode:0o600});return observation;}
      await sleep(200);
    }while(Date.now()<end);
    throw new AppError('INDEPENDENT_WITNESS_FAILED','Actual application did not reach the required native state',{witness,hierarchySha256:tree?.sha256},5);
  }
  let read,tree,cleanup=async()=>{};
  if(session.platform==='web'){
    const {browser,page}=await selectedPage(session);cleanup=()=>browser.close();
    try{if(reload)await page.reload({waitUntil:'domcontentloaded',timeout:60000});}
    catch(error){await cleanup();throw error;}
    read=async()=>{const locator=page.locator(witness.selector);if(await locator.count()!==1)throw new Error('Witness must select exactly one native element');return witness.kind==='web-input'?locator.inputValue({timeout:2000}):locator.innerText({timeout:2000});};
    if(screenshot){const disconnect=cleanup;cleanup=async()=>{try{await page.screenshot({path:screenshot,timeout:10000});}catch{}finally{await disconnect();}};}
  }else{
    read=async()=>{tree=await hierarchy({...session.android,python:session.environment?.APP2CLI_UIAUTOMATOR_PYTHON});return nodeById(tree,witness.selector).text;};
    if(screenshot)cleanup=async()=>{try{await writeFile(screenshot,await adb(session.android,['exec-out','screencap','-p'],{binary:true}),{mode:0o600});}catch{}};
  }
  try{
    let actual,error;const deadline=Date.now()+timeoutMs;
    do{
      try{
        actual=await read();
        const observation={kind:witness.kind,selector:witness.selector,actual,...(captureOnly?{}:{expected:witness.expected}),reloaded:reload,...(tree?{hierarchySha256:tree.sha256}:{}),capturedAt:new Date().toISOString()};
        if(record)await writeJson(record,{producer:'app2cli independent native observation, not adapter output or REA',...observation,...(tree?{hierarchy:tree}:{})});
        if(captureOnly||witnessMatches(actual,witness))return observation;
      }catch(e){error=e.message;}
      await sleep(200);
    }while(Date.now()<deadline);
    throw new AppError('INDEPENDENT_WITNESS_FAILED','Actual application did not expose the required value',{actual,error,witness},5);
  }finally{await cleanup();}
}
export async function testGenerated(packageDir,plan,session,out){
  if(plan.semantics==='android-journey')return testAndroidJourney(packageDir,plan,session,out,{observe:observeWitness});
  // The compiler's CLI schema is the source of the commands exercised below.
  const env={...process.env,...session.environment,APP2CLI_HOME:resolve(out,'state')};let sequence=0,baseline,baselineWitness,dirty=false;
  const report={producer:'app2cli independent test runner, not agent self-assessment',status:'running',mutationAttempted:false,checks:[],startedAt:new Date().toISOString()};
  const invoke=async(command,input={},extra=[])=>{
    const args=[resolve(packageDir,'cli.mjs'),...command.split('.'),'--input',JSON.stringify(input),...extra];
    const result=await runProcess(process.execPath,args,{env,timeout:90000,log:resolve(out,'call-'+(++sequence))});
    let json;try{json=JSON.parse(result.stdout);}catch{throw new AppError('CLI_PROTOCOL_FAILED','CLI must return one JSON object',{stderr:result.stderr.slice(-4000),stdout:result.stdout.slice(-4000)});}
    return {...result,json};
  };
  const call=async(command,input,extra)=>{const r=await invoke(command,input,extra);if(r.code!==0||!r.json.ok)throw new AppError('CLI_TEST_FAILED','Generated CLI invocation failed',{command,response:r.json,stderr:r.stderr.slice(-4000)},5);return r.json;};
  const check=(name,details={})=>report.checks.push({name,passed:true,...details});
  const writeInput=value=>replaceValue(plan.write.input,value);
  const restore=async()=>{
    await call(plan.write.command,writeInput(baseline),['--request-id','restore-'+randomUUID()]);
    assert.deepEqual(atPath((await call(plan.read.command,plan.read.input)).data,plan.valuePath),baseline);
    report.restorationWitness=await observeWitness(session,{...plan.witness,comparison:'equals',expected:baselineWitness.actual},{record:resolve(out,'restoration-witness.json')});
    if(session.platform==='api')assert.deepEqual(report.restorationWitness.data,baselineWitness.data,'Full server resource must be restored');
    dirty=false;report.restored=true;
  };
  try{
    const schema=await runProcess(process.execPath,[resolve(packageDir,'cli.mjs'),'--schema'],{env,timeout:30000});assert.equal(schema.code,0);check('Generated CLI schema');
    const before=await call(plan.read.command,plan.read.input);baseline=atPath(before.data,plan.valuePath);
    if(typeof baseline!==typeof plan.testValue||canonical(baseline)===canonical(plan.testValue))throw new AppError('INVALID_TEST_PLAN','Baseline must be restorable and differ from test value');
    baselineWitness=await observeWitness(session,plan.witness,{captureOnly:true,record:resolve(out,'baseline-witness.json')});report.baselineWitness=baselineWitness;
    if(session.platform==='api')assert.deepEqual(baseline,baselineWitness.actual,'CLI baseline must match independent server GET before any write');
    if(witnessMatches(baselineWitness.actual,plan.witness))throw new AppError('INVALID_TEST_PLAN','The native witness already satisfies the mutation objective before dispatch');
    const dry=await call(plan.write.command,writeInput(plan.testValue),['--dry-run']);assert.equal(dry.dryRun,true);
    assert.deepEqual(atPath((await call(plan.read.command,plan.read.input)).data,plan.valuePath),baseline);
    const dryWitness=await observeWitness(session,{...plan.witness,comparison:'equals',expected:baselineWitness.actual},{record:resolve(out,'dry-run-witness.json')});
    if(session.platform==='api')assert.deepEqual(dryWitness.data,baselineWitness.data,'Dry run must preserve the whole resource');check('Dry run preserves application state');
    const requestId='generated-'+randomUUID(),extra=['--request-id',requestId,'--expected-revision',before.revision];dirty=true;report.mutationAttempted=true;
    const write=await call(plan.write.command,writeInput(plan.testValue),extra);
    assert.ok(write.verification.stages.includes('fresh_readback_verified'));check('Mutation and runtime fresh readback');
    const independent=await observeWitness(session,plan.witness,{reload:session.platform==='web',screenshot:resolve(out,'independent-witness.png'),record:resolve(out,'independent-witness.json')});
    if(session.platform==='api')assert.deepEqual(withoutField(independent.data,plan.witness.selector),withoutField(baselineWitness.data,plan.witness.selector),'Update must preserve unrelated server fields');
    check(session.platform==='api'?'Independent server GET and unrelated-field preservation':'Independent native witness',independent);
    assert.deepEqual(atPath((await call(plan.read.command,plan.read.input)).data,plan.valuePath),plan.testValue);check('Separate CLI process reads actual value');
    const replay=await call(plan.write.command,writeInput(plan.testValue),extra);assert.equal(replay.replayed,true);check('Request replay is deduplicated');
    const stale=await invoke(plan.write.command,writeInput(baseline),['--request-id','stale-'+randomUUID(),'--expected-revision',before.revision]);
    assert.equal(stale.json.error?.code,'STALE_STATE');assert.notEqual(stale.code,0);check('Stale revision is rejected');
    await restore();check('Original application content restored');report.status='passed';
  }catch(error){
    report.status='failed';report.error={code:error.code||'TEST_FAILED',message:error.message,details:error.details};
    if(dirty&&baseline!==undefined){try{await restore();}catch(e){report.cleanupError={code:e.code,message:e.message,details:e.details};}}
  }
  report.finishedAt=new Date().toISOString();await writeJson(resolve(out,'test-report.json'),report);return report;
}
