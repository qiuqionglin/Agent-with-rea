import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadAdapter} from '../lib/manifest.mjs';
import {workspacePath} from '../lib/application-session.mjs';
import {readAsar,exportApplicationSources} from '../lib/application-artifact.mjs';
import {redactObject,safeUrl} from '../lib/application-observation.mjs';
import {resolveApplicationValue,observeApplicationWitness,validateApplicationPlan} from '../lib/application-test.mjs';
async function temp(t){const p=await mkdtemp(join(tmpdir(),'app2cli-application-test-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}
function asar(header,data){const text=Buffer.from(JSON.stringify(header)),size=Math.ceil((8+text.length)/4)*4,bytes=Buffer.alloc(8+size+data.length);bytes.writeUInt32LE(4,0);bytes.writeUInt32LE(size,4);bytes.writeUInt32LE(size-4,8);bytes.writeUInt32LE(text.length,12);text.copy(bytes,16);data.copy(bytes,8+size);return bytes;}
test('ASAR extractor reads actual bounded member bytes and rejects traversal and malformed ranges',async t=>{
  const root=await temp(t),path=join(root,'app.asar'),data=Buffer.from('{"name":"fixture"}');await writeFile(path,asar({files:{'package.json':{size:data.length,offset:'0'}}},data));
  const a=await readAsar(path);assert.deepEqual(await a.read('package.json'),data);const index=await exportApplicationSources(a,join(root,'sources'));assert.equal(index.sources.length,1);
  await writeFile(path,asar({files:{'../escape':{size:1,offset:'0'}}},data));await assert.rejects(readAsar(path),{code:'INVALID_ARTIFACT'});
  await writeFile(path,asar({files:{'main.js':{size:1000,offset:'999'}}},data));await assert.rejects((await readAsar(path)).read('main.js'),{code:'INVALID_ARTIFACT'});
});
test('discovery records redact auth fields without discarding request semantics',()=>{
  assert.deepEqual(redactObject({title:'test',nested:{accessToken:'secret',password:'secret'},rows:[{csrfmiddlewaretoken:'secret',id:7}]}),{title:'test',nested:{accessToken:'[REDACTED]',password:'[REDACTED]'},rows:[{csrfmiddlewaretoken:'[REDACTED]',id:7}]});
  const u=new URL(safeUrl('https://user:secret@example.test/search?q=owned&token=secret'));assert.equal(u.username,'');assert.equal(u.password,'');assert.equal(u.searchParams.get('q'),'owned');assert.equal(u.searchParams.get('token'),'[REDACTED]');
});
test('journey references preserve IDs as JSON types and reject unresolved bindings',()=>{
  const c={marker:'OWNED',steps:{create:{data:{id:42}}}};assert.deepEqual(resolveApplicationValue({id:'${steps.create.data.id}',name:'${marker}-test'},c),{id:42,name:'OWNED-test'});assert.throws(()=>resolveApplicationValue('${steps.missing.data.id}',c),{code:'INVALID_PLAN'});assert.throws(()=>resolveApplicationValue('${constructor}',{}),{code:'INVALID_PLAN'});
});
test('independent file observer rejects forged expected values and symlink escapes',async t=>{
  const root=await temp(t),workspace=join(root,'workspace');await mkdir(workspace);await writeFile(join(workspace,'note.md'),'actual application output');await writeFile(join(root,'outside.md'),'outside');await symlink(join(root,'outside.md'),join(workspace,'escape.md'));
  assert.throws(()=>workspacePath({workspace},'escape.md'),{code:'INVALID_INPUT'});
  const session={environment:{APP2CLI_WORKSPACE:workspace}},w={kind:'file',path:'note.md',comparison:'equals',expected:'actual application output'};
  assert.equal((await observeApplicationWitness(session,w)).actual,w.expected);
  await assert.rejects(observeApplicationWitness(session,{...w,expected:'forged'},{timeout:0}),{code:'INDEPENDENT_WITNESS_FAILED'});
  await assert.rejects(observeApplicationWitness(session,{...w,path:'../outside.md'}),{code:'INVALID_PLAN'});await assert.rejects(observeApplicationWitness(session,{...w,path:'escape.md'}),{code:'INVALID_PLAN'});
});
test('multi-function plans cannot relabel a write as read or omit native renderer verification',()=>{
  const commands=Object.fromEntries(['create','read','update','save','open'].map(c=>[c,{readOnly:c==='read'}]));
  const steps=Object.keys(commands).map((c,i)=>({name:c,command:c,effect:c==='read'?'read':'update',input:{},witness:{kind:i===4?'page-text':'file',path:'note.md',selector:'#editor',comparison:'contains',expected:'marker'}}));
  const p={schemaVersion:3,semantics:'application-journey',steps,cleanup:[{...steps[3],name:'cleanup',changed:false}]};validateApplicationPlan(p,{platform:'electron',commands});
  assert.throws(()=>validateApplicationPlan({...p,steps:steps.map(s=>({...s,witness:{...s.witness,expected:''}}))},{platform:'electron',commands}),{code:'INVALID_PLAN'});
  assert.throws(()=>validateApplicationPlan({...p,steps:steps.map(s=>({...s,effect:'read'}))},{platform:'electron',commands}),{code:'INVALID_PLAN'});
  assert.throws(()=>validateApplicationPlan({...p,steps:steps.map(s=>({...s,witness:{...s.witness,kind:'file'}}))},{platform:'electron',commands}),{code:'INVALID_PLAN'});
});

test('Electron command transport is accepted by the real manifest compiler',async t=>{
 const root=await temp(t);await writeFile(join(root,'adapter.json'),JSON.stringify({schemaVersion:1,id:'electron-fixture',description:'Schema regression fixture',platform:'electron',transport:'electron-api',verification:'native-file-readback',commands:{read:{description:'Read',readOnly:true,transport:'electron-api',inputSchema:{type:'object'}}},analysis:{recipe:'Fixture only',claims:[{operation:'fixture'}]},config:{}}));await writeFile(join(root,'adapter.mjs'),'export default {};');assert.equal((await loadAdapter(root)).manifest.transport,'electron-api');
});
