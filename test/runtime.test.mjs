import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAdapter } from '../lib/manifest.mjs';
import { execute } from '../lib/runtime.mjs';
import { withLock } from '../lib/lock.mjs';
import { hash,readJson,writeJson } from '../lib/sdk.mjs';
import { build } from '../lib/build.mjs';
import { runAppCli } from '../lib/app-cli.mjs';
import { parseArgs,commandInput } from '../lib/arguments.mjs';

// This fixture tests kernel guarantees only. It is not native-app evidence.
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'agent-with-rea-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const manifest={schemaVersion:1,id:'fixture',description:'Kernel fixture only',platform:'web',verification:'reload-persisted',config:{file:join(root,'state.json')},analysis:{recipe:'test fixture',claims:[{operation:'fixture_analysis',contains:'fixture-proof'}]},commands:{read:{description:'Read fixture',readOnly:true,inputSchema:{type:'object',properties:{},additionalProperties:false}},set:{description:'Write fixture',readOnly:false,inputSchema:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false}}}};
  await writeJson(join(root,'adapter.json'),manifest);await writeJson(manifest.config.file,{value:0,writes:0});
  await writeFile(join(root,'adapter.mjs'),`import{readFile,writeFile}from'node:fs/promises';const read=async c=>JSON.parse(await readFile(c.file,'utf8'));export default{targetKey:(e,c)=>c.file,connect:async(e,c)=>c,check:async()=>{},read:async c=>({scopeKey:'fixture-scope',data:await read(c)}),plan:(n,i)=>({expected:i.value}),dispatch:async(c,n,i)=>{const s=await read(c);await writeFile(c.file,JSON.stringify({value:i.value,writes:s.writes+1}));},matches:(p,s)=>p.expected===s.data.value,refresh:async()=>{},result:(n,i,s)=>s.data,close:async()=>{}};`);
  const raw={operation:'fixture_analysis',normalized_result:{fact:'fixture-proof'}};const bytes=JSON.stringify(raw);await writeFile(join(root,'raw.json'),bytes);await writeJson(join(root,'evidence.json'),{platform:'web',records:[{file:'raw.json',operation:raw.operation,evidenceId:'fixture-only',sha256:hash(bytes)}]});
  return {root,adapter:await loadAdapter(root),options:{stateRoot:join(root,'runtime')},manifest};
}
test('invalid input is rejected before dispatch',async t=>{const f=await fixture(t);await assert.rejects(execute(f.adapter,'set',{value:'bad'},f.options),{code:'INVALID_INPUT'});assert.equal((await readJson(f.manifest.config.file)).writes,0);});
test('request replay returns verified result without a second write',async t=>{const f=await fixture(t),o={...f.options,requestId:'same'};const first=await execute(f.adapter,'set',{value:7},o);assert.equal(first.data.value,7);assert.equal((await execute(f.adapter,'set',{value:7},o)).replayed,true);assert.equal((await readJson(f.manifest.config.file)).writes,1);});
test('request ID conflict and stale revision cannot dispatch',async t=>{const f=await fixture(t);const before=await execute(f.adapter,'read',{},f.options);await execute(f.adapter,'set',{value:7},{...f.options,requestId:'same'});await assert.rejects(execute(f.adapter,'set',{value:8},{...f.options,requestId:'same'}),{code:'IDEMPOTENCY_CONFLICT'});await assert.rejects(execute(f.adapter,'set',{value:8},{...f.options,expectedRevision:before.revision}),{code:'STALE_STATE'});assert.equal((await readJson(f.manifest.config.file)).writes,1);});
test('dry run does not reserve a request or change state',async t=>{const f=await fixture(t);const r=await execute(f.adapter,'set',{value:9},{...f.options,dryRun:true,requestId:'plan'});assert.equal(r.dryRun,true);assert.equal((await readJson(f.manifest.config.file)).writes,0);assert.equal((await execute(f.adapter,'set',{value:9},{...f.options,requestId:'plan'})).ok,true);});
test('a failed dispatched operation cannot be blindly retried',async t=>{const f=await fixture(t);const source=await readFile(join(f.root,'adapter.mjs'),'utf8');await writeFile(join(f.root,'adapter.mjs'),source.replace('const s=await read(c);await writeFile',"throw Error('simulated transport failure');const s=await read(c);await writeFile"));const a=await loadAdapter(f.root),o={...f.options,requestId:'uncertain'};await assert.rejects(execute(a,'set',{value:1},o),/simulated/);await assert.rejects(execute(a,'set',{value:1},o),{code:'OUTCOME_UNCERTAIN'});});
test('a successful dispatch acknowledgement without state change fails verification',async t=>{const f=await fixture(t);const source=await readFile(join(f.root,'adapter.mjs'),'utf8');await writeFile(join(f.root,'adapter.mjs'),source.replace('const s=await read(c);await writeFile(c.file,JSON.stringify({value:i.value,writes:s.writes+1}));','return {accepted:true};'));const a=await loadAdapter(f.root),o={...f.options,requestId:'no-op'};await assert.rejects(execute(a,'set',{value:1},o),{code:'VERIFICATION_FAILED'});assert.equal((await readJson(f.manifest.config.file)).writes,0);await assert.rejects(execute(a,'set',{value:1},o),{code:'OUTCOME_UNCERTAIN'});});
test('cross-process lock ownership is exclusive',async t=>{const f=await fixture(t);await withLock(join(f.root,'lock'),async()=>{await assert.rejects(withLock(join(f.root,'lock'),async()=>{}),{code:'SESSION_BUSY'});});await withLock(join(f.root,'lock'),async()=>{});});
test('compiler rejects tampered evidence bytes',async t=>{const f=await fixture(t);await writeFile(join(f.root,'raw.json'),'{}');await assert.rejects(build(f.root,{evidence:f.root,out:join(f.root,'package')}),{code:'EVIDENCE_MISMATCH'});});
test('compiler emits an independent CLI with a frozen adapter digest',async t=>{const f=await fixture(t);const result=await build(f.root,{evidence:f.root,out:join(f.root,'package')});assert.equal(result.runtimeVerified,false);const help=await runAppCli(join(result.output,'adapters/fixture'),['--schema'],result.adapterDigest);assert.equal(help.app,'fixture');await writeFile(join(result.output,'adapters/fixture/adapter.mjs'),'export default {};');await assert.rejects(runAppCli(join(result.output,'adapters/fixture'),['--schema'],result.adapterDigest),{code:'ADAPTER_CHANGED'});});
test('schema-driven flags preserve types and reject duplicate values',()=>{const {positional,flags}=parseArgs(['--dry-run','set','--value','3']);assert.deepEqual(positional,['set']);assert.equal(flags['dry-run'],true);const c={inputSchema:{properties:{value:{type:'integer'}}}};assert.deepEqual(commandInput(c,flags),{value:3});assert.throws(()=>parseArgs(['--value','2','--value','3']),{code:'INVALID_INPUT'});});
test('capability inventory stays separate from concrete acceptance and rejects a mismatched digest',async t=>{
  const f=await fixture(t);f.manifest.capabilities=[{id:'read-value',description:'Fixture read',commands:['read'],status:'implemented-unverified',reason:'Declaration only'}];
  await writeJson(join(f.root,'adapter.json'),f.manifest);
  const result=await build(f.root,{evidence:f.root,out:join(f.root,'package')}),dir=join(result.output,'adapters/fixture');
  const before=await runAppCli(dir,['--capabilities']);assert.equal(before.acceptance,null);assert.equal(before.capabilities[0].status,'implemented-unverified');
  await writeJson(join(result.output,'acceptance.json'),{adapterDigest:result.adapterDigest,scenarios:[{command:'read',input:{},verified:true}]});
  const after=await runAppCli(dir,['--capabilities']);assert.equal(after.acceptance.scenarios.length,1);assert.equal(after.capabilities[0].status,'implemented-unverified');
  await writeJson(join(result.output,'acceptance.json'),{adapterDigest:'wrong'});
  await assert.rejects(runAppCli(dir,['--capabilities']),{code:'ADAPTER_CHANGED'});
});
test('capabilities cannot invent commands or promote themselves to tested',async t=>{
  const f=await fixture(t);
  f.manifest.capabilities=[{id:'fake-command',description:'No implementation',commands:['missing'],status:'implemented-unverified',reason:'Fixture'}];
  await writeJson(join(f.root,'adapter.json'),f.manifest);await assert.rejects(loadAdapter(f.root),{code:'INVALID_ADAPTER'});
  f.manifest.capabilities[0].commands=['read'];f.manifest.capabilities[0].status='verified';
  await writeJson(join(f.root,'adapter.json'),f.manifest);await assert.rejects(loadAdapter(f.root),{code:'INVALID_ADAPTER'});
});
