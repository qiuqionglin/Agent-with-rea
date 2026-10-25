import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testAndroidJourney,validateJourney } from '../lib/generation-journey.mjs';
import { selectNode,actionableNode,nativeStateMatches } from '../lib/android-ui.mjs';
import { AppError } from '../lib/sdk.mjs';

const state=name=>({kind:'android-state',all:[{text:name}]});
const step=(name,target)=>({name,command:'navigate',input:{target},effect:'navigation',witness:state(target),readback:{path:'screen',value:target}});
const plan={schemaVersion:2,semantics:'android-journey',read:{command:'read',input:{}},start:step('start','home'),steps:[step('open-search','search'),step('open-profile','profile')],cleanup:step('cleanup','home')};
const manifest={platform:'android',commands:{read:{readOnly:true},navigate:{readOnly:false}}};

test('journey validation rejects traversal, empty witnesses, duplicate steps and a different cleanup screen',()=>{
  validateJourney(plan,manifest);
  for(const modified of [
    {...plan,steps:[step('../escape','search'),plan.steps[1]]},
    {...plan,steps:[{...plan.steps[0],witness:{kind:'android-state',all:[{}]}},plan.steps[1]]},
    {...plan,steps:[plan.steps[0],plan.steps[0]]},
    {...plan,cleanup:step('cleanup','different')},
  ])assert.throws(()=>validateJourney(modified,manifest));
});

async function fixture(t,{noop=false,dryMutates=false,cleanupFails=false}={}){
  const dir=await mkdtemp(join(tmpdir(),'app2cli-journey-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let native='home',writes=0;const journal=new Set();
  const invoke=async(command,input,extra=[])=>{
    const ok=data=>({code:0,json:{ok:true,...data}});
    if(command==='read')return ok({data:{screen:native}});
    if(extra.includes('--expected-revision'))return {code:4,json:{ok:false,error:{code:'STALE_STATE'}}};
    if(extra.includes('--dry-run')){if(dryMutates)native=input.target;return ok({dryRun:true});}
    const id=extra[extra.indexOf('--request-id')+1];
    if(journal.has(id))return ok({replayed:true});
    if(cleanupFails&&id.startsWith('cleanup'))return {code:1,json:{ok:false,error:{code:'FAILURE'}}};
    journal.add(id);writes++;if(!noop)native=input.target;
    return ok({verification:{stages:['fresh_readback_verified']}});
  };
  const observe=async(session,witness,{captureOnly=false}={})=>{
    const matched=native===witness.all[0].text;
    if(!captureOnly&&!matched)throw new AppError('INDEPENDENT_WITNESS_FAILED','Real fixture screen is '+native);
    return {matched};
  };
  return {run:()=>testAndroidJourney(dir,plan,{environment:{}},dir,{invoke,observe}),writes:()=>writes};
}
test('navigation acceptance checks independent transitions, replay and landing restoration',async t=>{
  const f=await fixture(t),r=await f.run();assert.equal(r.status,'passed');assert.equal(r.steps.length,2);assert.equal(r.restored,true);assert.equal(f.writes(),4);
  assert.match(r.restorationScope,/feed item.*not restored/);
});
test('a no-op adapter with forged readback is rejected by the independent navigation observer',async t=>{
  const f=await fixture(t,{noop:true}),r=await f.run();assert.equal(r.status,'failed');assert.equal(r.error.code,'INDEPENDENT_WITNESS_FAILED');assert.equal(r.restored,true);
});
test('a dry-run navigation side effect fails before real navigation is attempted',async t=>{
  const f=await fixture(t,{dryMutates:true}),r=await f.run();assert.equal(r.status,'failed');assert.equal(r.error.code,'INDEPENDENT_WITNESS_FAILED');assert.equal(f.writes(),2);assert.equal(r.restored,true);
});
test('failed cleanup remains explicit instead of claiming original state restored',async t=>{
  const f=await fixture(t,{cleanupFails:true}),r=await f.run();assert.equal(r.status,'failed');assert.ok(r.cleanupError);assert.notEqual(r.restored,true);
});
test('duplicate native IDs need a disambiguating selector and a real clickable ancestor',()=>{
  const tree={nodes:[{nodeIndex:0,parentIndex:-1,clickable:'true',enabled:'true'},{nodeIndex:1,parentIndex:0,'resource-id':'app:id/tab',text:'Home'},{nodeIndex:2,parentIndex:0,'resource-id':'app:id/tab',text:'Search'}]};
  assert.throws(()=>selectNode(tree,{'resource-id':'app:id/tab'}),{code:'UI_CHANGED'});
  const node=selectNode(tree,{'resource-id':'app:id/tab',text:'Search'});assert.equal(actionableNode(tree,node).nodeIndex,0);
  assert.equal(nativeStateMatches(tree,{kind:'android-state',all:[{text:'Search'}],none:[{text:'Pay'}]}),true);
  assert.equal(nativeStateMatches(tree,{kind:'android-state',all:[{text:'Search'}],none:[{text:'Home'}]}),false);
});
