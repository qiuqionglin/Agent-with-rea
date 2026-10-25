import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { generate } from '../lib/generate.mjs';
import { validatePlan,atPath,replaceValue } from '../lib/generation-test.mjs';
import { runProcess } from '../lib/process.mjs';
import { hash,writeJson,readJson,AppError } from '../lib/sdk.mjs';
import { reaEvidence } from '../lib/rea.mjs';
import { projectWebCapture } from '../lib/inspect.mjs';
import { checkBrowser } from '../lib/web.mjs';

// Orchestration fixtures only: these deliberately do NOT claim a live app run.
async function setup(t){
  const directory=await mkdtemp(join(tmpdir(),'app2cli-generation-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const out=join(directory,'run'),calls=[];
  const manifest={schemaVersion:1,id:'unseen-fixture',description:'Generation fixture',platform:'web',verification:'reload-persisted',config:{},analysis:{recipe:'Fixture only',claims:[{operation:'fixture_analysis',contains:'fixture-only'}]},commands:{read:{description:'Read',readOnly:true,inputSchema:{type:'object',properties:{},additionalProperties:false}},set:{description:'Set',readOnly:false,inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}}};
  const deps={
    prepare:async({evidence,out})=>{
      const raw={operation:'fixture_analysis',normalized_result:{note:'fixture-only'}},bytes=JSON.stringify(raw);
      await writeJson(join(evidence,'evidence.json'),{platform:'web',records:[{file:'raw.json',operation:raw.operation,sha256:hash(bytes)}]});await writeFile(join(evidence,'raw.json'),bytes);
      const session={platform:'web',url:'https://fixture.invalid/',environment:{}};await writeJson(join(out,'session.json'),session);return session;
    },snapshot:async()=>({producer:'fixture only'}),
    agent:async(prompt,attempt)=>{
      calls.push(prompt);const marker=/APP2CLI_[a-f0-9]{32}/.exec(prompt)[0];
      const plan={schemaVersion:1,semantics:'replace-value',read:{command:'read',input:{}},write:{command:'set',input:{text:'$value'}},valuePath:'text',testValue:marker,witness:{kind:'web-text',selector:'#preview',comparison:'equals',expected:marker}};
      const candidate={decision:'candidate',reason:'fixture',manifest:JSON.stringify(manifest),module:'export default {};',testPlan:JSON.stringify(plan)};
      await writeJson(join(attempt,'agent-response.json'),candidate);return candidate;
    },test:async()=>({status:'passed',checks:[{name:'fixture'}]})
  };
  return {out,deps,calls,manifest};
}
test('real validator failures are fed to a new generation round, then success is reported',async t=>{
  const f=await setup(t);let checks=0;
  f.deps.test=async()=>++checks===1?{status:'failed',checks:[],error:{code:'INDEPENDENT_WITNESS_FAILED',message:'Native display is unchanged'}}:{status:'passed',checks:[{name:'fixture'}]};
  const result=await generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out},f.deps);
  assert.equal(result.rounds,2);assert.equal(result.repairs,1);assert.match(f.calls[1],/Native display is unchanged/);
  assert.equal((await readJson(join(f.out,'generation.json'))).attempts[0].status,'failed');
});
test('successful navigation probes refresh the next observation and probe failures are not adapter repairs',async t=>{
  const f=await setup(t),author=f.deps.agent;let calls=0,screen='before';
  f.deps.snapshot=async()=>({screen});
  f.deps.probe=async()=>{screen='after';};
  f.deps.agent=async(...args)=>{
    if(++calls===1)return {decision:'probe',reason:'fixture navigation',probe:{kind:'fixture'}};
    assert.equal((await readJson(join(f.out,'observation.json'))).screen,'after');
    if(calls===2)return {decision:'probe',reason:'fixture failure',probe:{kind:'fixture-failure'}};
    return author(...args);
  };
  f.deps.probe=async request=>{if(request.kind==='fixture-failure')throw new AppError('UI_CHANGED','Native selector moved');screen='after';};
  const result=await generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out},f.deps);
  assert.equal(result.rounds,3);assert.equal(result.repairs,0);assert.equal(result.failedRounds,1);
});
test('repair attempts cannot replace the immutable test value with observed stale data',async t=>{
  const f=await setup(t),agent=f.deps.agent;let checks=0;
  f.deps.test=async()=>{checks++;return {status:'failed',error:{message:'wrong value'},checks:[]};};
  f.deps.agent=async(...args)=>{const result=await agent(...args);if(f.calls.length>1){const p=JSON.parse(result.testPlan);p.testValue='already-there';p.witness.expected='already-there';result.testPlan=JSON.stringify(p);}return result;};
  await assert.rejects(generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out,'max-attempts':2},f.deps),{code:'GENERATION_EXHAUSTED'});
  assert.equal(checks,1);assert.equal((await readJson(join(f.out,'generation.json'))).attempts[1].error.code,'INVALID_TEST_PLAN');
});
test('uncertain baseline restoration stops automatic repair instead of repeating mutations',async t=>{
  const f=await setup(t);f.deps.test=async()=>({status:'failed',error:{message:'write failed'},cleanupError:{message:'baseline unknown'},checks:[]});
  await assert.rejects(generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out},f.deps),{code:'RESTORATION_FAILED'});assert.equal(f.calls.length,1);
});
test('generation never overwrites an existing evidence directory',async t=>{
  const f=await setup(t);await generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out},f.deps);
  const before=await readFile(join(f.out,'generation.json'),'utf8');
  await assert.rejects(generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out},f.deps),{code:'OUTPUT_EXISTS'});assert.equal(await readFile(join(f.out,'generation.json'),'utf8'),before);
});
test('resume verifies evidence and retains the original challenge and prior failed attempt',async t=>{
  const f=await setup(t);f.deps.test=async()=>({status:'failed',checks:[],error:{message:'fixture failure'}});
  await assert.rejects(generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out,'max-attempts':1},f.deps),{code:'GENERATION_EXHAUSTED'});
  const first=await readJson(join(f.out,'generation.json')),response=await readFile(join(f.out,'attempt-1/agent-response.json'),'utf8');
  f.deps.test=async()=>({status:'passed',checks:[{name:'fixture'}]});f.deps.prepare=async()=>assert.fail('Resume must not rerun analysis');
  await generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out,'max-attempts':2,resume:true},f.deps);
  const final=await readJson(join(f.out,'generation.json'));assert.equal(final.marker,first.marker);assert.equal(final.attempts.length,2);
  assert.equal(await readFile(join(f.out,'attempt-1/agent-response.json'),'utf8'),response);
});
test('resume rejects modified analysis evidence before invoking the agent',async t=>{
  const f=await setup(t);f.deps.test=async()=>({status:'failed',checks:[],error:{message:'fixture'}});
  await assert.rejects(generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out,'max-attempts':1},f.deps),{code:'GENERATION_EXHAUSTED'});
  await writeFile(join(f.out,'evidence/raw.json'),'{}');
  await assert.rejects(generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out,'max-attempts':2,resume:true},f.deps),{code:'EVIDENCE_MISMATCH'});assert.equal(f.calls.length,1);
});
test('authoring timeout is bounded feedback while provider authentication errors stop',async t=>{
  const f=await setup(t),agent=f.deps.agent;let invocations=0;
  f.deps.agent=async(...args)=>{if(++invocations===1)throw new AppError('PROCESS_TIMEOUT','Authoring timed out',{log:'attempt-1/agent'});return agent(...args);};
  const result=await generate('https://fixture.invalid/',{id:'unseen-fixture',out:f.out},f.deps);
  assert.equal(result.rounds,2);assert.match(f.calls[0],/Authoring timed out/);
  const g=await setup(t);let blockedCalls=0;g.deps.agent=async()=>{blockedCalls++;throw new AppError('AGENT_FAILED','Provider unavailable');};
  await assert.rejects(generate('https://fixture.invalid/',{id:'unseen-fixture',out:g.out},g.deps),{code:'AGENT_FAILED'});assert.equal(blockedCalls,1);
});
test('witness plans require an actual mutation and nonempty observed value',async t=>{
  const f=await setup(t),candidate=await f.deps.agent('APP2CLI_0123456789abcdef0123456789abcdef',f.out),plan=JSON.parse(candidate.testPlan);
  validatePlan(plan,f.manifest);assert.throws(()=>validatePlan({...plan,witness:{...plan.witness,expected:''}},f.manifest),{code:'INVALID_TEST_PLAN'});
  assert.throws(()=>validatePlan({...plan,write:{command:'read',input:{$value:'$value'}}},f.manifest),{code:'INVALID_TEST_PLAN'});
  assert.throws(()=>atPath({},'constructor.prototype'),{code:'INVALID_TEST_PLAN'});
  assert.deepEqual(replaceValue({nested:['$value'],literal:'do not interpolate $value'},{a:1}),{nested:[{a:1}],literal:'do not interpolate $value'});
});
test('full REA envelope preserves nullable fields without rewriting its evidence ID',()=>{
  const data={evidence_id:'unchanged',operation:'inspect_web_page',subject:null,normalized_result:{}};
  assert.strictEqual(reaEvidence({ok:true,data}),data);assert.strictEqual(reaEvidence(data),data);
});
test('corrupt captured script bytes are quarantined rather than assigned a fabricated digest',()=>{
  const artifact={text:'original bytes',bytes:14,sha256:hash('original bytes')};
  const original={scripts:{items:[{url:'https://app.invalid/good.js',source:{included:true,artifact}},{url:'https://app.invalid/bad.js',source:{included:true,artifact:{...artifact,text:'changed'}}}]},limitations:[]};
  const result=projectWebCapture(original);assert.equal(result.excluded.length,1);assert.equal(result.projected.scripts.items[0].source.artifact.sha256,artifact.sha256);
  assert.equal(result.projected.scripts.items[1].source.included,false);assert.equal(original.scripts.items[1].source.included,true);assert.equal(result.excluded[0].reportedSha256,artifact.sha256);
});
test('subprocess input is literal and timeouts stop an unresponsive child',async()=>{
  const r=await runProcess(process.execPath,['-e','process.stdin.pipe(process.stdout)'],{input:'$(not-a-command) `literal`\n'});assert.equal(r.stdout,'$(not-a-command) `literal`\n');
  await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:50}),{code:'PROCESS_TIMEOUT'});
});
test('browser source checks use the selected session and reject a different origin or changed bytes',async()=>{
  const bytes=Buffer.from('source'),calls=[];
  const ctx={origin:'https://app.invalid',page:{url:()=> 'https://app.invalid/?deployment=1',evaluate:async(fn,url)=>{calls.push(url);return {ok:true,bytes:[...bytes]};},waitForFunction:async()=>{}}};
  const config={origin:ctx.origin,pathname:'/',pins:[{path:'/app.js?version=1',sha256:hash(bytes)}],ready:'true'};
  await checkBrowser(ctx,config);assert.deepEqual(calls,['https://app.invalid/app.js?version=1']);
  await assert.rejects(checkBrowser(ctx,{...config,origin:'https://different.invalid'}),{code:'SESSION_CHANGED'});
  await assert.rejects(checkBrowser(ctx,{...config,pins:[{path:'https://other.invalid/app.js',sha256:hash(bytes)}]}),{code:'INVALID_ADAPTER'});
  await assert.rejects(checkBrowser(ctx,{...config,pins:[{path:'/app.js',sha256:hash('changed')}]}),{code:'VERSION_DRIFT'});
});

async function androidFixture(t){
  const f=await setup(t),apk=join(dirname(f.out),'fixture.apk');await writeFile(apk,'fixture bytes');
  f.manifest.platform='android';f.manifest.verification='native-ui-readback';f.manifest.config={apkSha256:hash('fixture bytes')};
  f.deps.prepare=async({evidence,out})=>{
    const raw={operation:'fixture_analysis',subject:{digest:{sha256:hash('fixture bytes')}},normalized_result:{note:'fixture-only'}},bytes=JSON.stringify(raw);
    await writeJson(join(evidence,'evidence.json'),{platform:'android',records:[{file:'raw.json',operation:raw.operation,sha256:hash(bytes)}]});await writeFile(join(evidence,'raw.json'),bytes);
    const session={platform:'android',apk,android:{config:f.manifest.config},environment:{}};await writeJson(join(out,'session.json'),session);return session;
  };
  f.deps.agent=async(prompt,attempt)=>{
    f.calls.push(prompt);
    const step=(name,value)=>({name,command:'set',input:{text:value},effect:'navigation',witness:{kind:'android-state',all:[{text:value}]},readback:{path:'screen',value}});
    const plan={schemaVersion:2,semantics:'android-journey',read:{command:'read',input:{}},start:step('start','home'),steps:[step('search','search'),step('home','home')],cleanup:step('cleanup','home')};
    const candidate={decision:'candidate',reason:'fixture',manifest:JSON.stringify(f.manifest),module:'export default {};',testPlan:JSON.stringify(plan)};await writeJson(join(attempt,'agent-response.json'),candidate);return candidate;
  };
  return {...f,apk};
}
test('required journey commands cannot pass by being omitted from execution',async t=>{
  const f=await androidFixture(t);let tests=0;f.deps.test=async()=>{tests++;return {status:'passed',checks:[]};};
  await assert.rejects(generate(f.apk,{id:'unseen-fixture',out:f.out,scenario:'android-journey','require-step':'search.submit','max-attempts':1},f.deps),{code:'GENERATION_EXHAUSTED'});
  assert.equal(tests,0);assert.equal((await readJson(join(f.out,'generation.json'))).attempts[0].error.code,'REQUIRED_STEP_MISSING');
});
test('explicit extensions retain prior provenance and reject a modified seed',async t=>{
  const f=await androidFixture(t),flags={id:'unseen-fixture',out:f.out,scenario:'android-journey'};
  const first=await generate(f.apk,flags,f.deps),next=join(dirname(f.out),'extension');
  await generate(f.apk,{...flags,out:next,seed:f.out},f.deps);
  assert.equal((await readJson(join(next,'seed-provenance.json'))).adapterDigest,first.adapterDigest);assert.match(f.calls.at(-1),/explicitly requested extension/);
  await writeFile(join(f.out,'package/adapters/unseen-fixture/adapter.mjs'),'export default {changed:true};');
  await assert.rejects(generate(f.apk,{...flags,out:join(dirname(f.out),'tampered'),seed:f.out},f.deps),{code:'SEED_MISMATCH'});
});
test('caller-reviewed oracle is pinned and an agent cannot alter it',async t=>{
  const f=await androidFixture(t),author=f.deps.agent,review=join(dirname(f.out),'reviewed.json');
  const original=await author('fixture only',dirname(f.out));await writeJson(review,JSON.parse(original.testPlan));let tests=0;
  f.deps.agent=async(...args)=>{const result=await author(...args),plan=JSON.parse(result.testPlan);plan.steps[0].witness.all=[{text:'different'}];result.testPlan=JSON.stringify(plan);return result;};
  f.deps.test=async()=>{tests++;return {status:'passed',checks:[]};};
  const flags={id:'unseen-fixture',out:f.out,scenario:'android-journey','reviewed-plan':review,'max-attempts':1};
  await assert.rejects(generate(f.apk,flags,f.deps),{code:'GENERATION_EXHAUSTED'});assert.equal(tests,0);
  assert.equal((await readJson(join(f.out,'generation.json'))).attempts[0].error.code,'REVIEWED_PLAN_CHANGED');
  const changed=await readJson(review);changed.steps[0].readback.value='changed';await writeJson(review,changed);
  await assert.rejects(generate(f.apk,{...flags,resume:true,'max-attempts':2},f.deps),{code:'RESUME_REJECTED'});
});
