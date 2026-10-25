import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {connectHttp,httpUrl,requestHttp} from '../lib/http.mjs';
import {observeHttpWitness} from '../lib/generation-api.mjs';

async function fixture(t){
  const calls=[];let value='baseline';
  const server=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;calls.push({method:req.method,path:req.url,headers:req.headers,body});
    if(req.url==='/redirect'){res.writeHead(302,{location:'/resource/42'}).end();return;}
    if(req.url==='/rate'){res.writeHead(429,{'retry-after':'15'}).end('sensitive server details');return;}
    if(req.url==='/bad'){res.writeHead(200,{'content-type':'application/json'}).end('{"unexpected":true}');return;}
    if(req.url==='/uncertain'){value='written-before-disconnect';req.socket.destroy();return;}
    if(req.method==='PATCH')value=JSON.parse(body).value;
    res.writeHead(200,{'content-type':'application/json','x-request-id':'fixture-id'}).end(JSON.stringify({owner:'fixture',value}));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const config={baseUrl:'http://127.0.0.1:'+server.address().port,auth:{type:'header',header:'authorization',env:'TEST_TOKEN',prefix:'Bearer '},parameters:{id:'TEST_ID'},operations:{observe:{method:'GET',path:'/resource/{id}'},update:{method:'PATCH',path:'/resource/{id}'},redirect:{method:'GET',path:'/redirect'},rate:{method:'PATCH',path:'/rate'},bad:{method:'GET',path:'/bad',responseSchema:{type:'object',required:['value'],properties:{value:{type:'string'}}}},uncertain:{method:'PATCH',path:'/uncertain'}}};
  const env={TEST_TOKEN:'fixture-secret',TEST_ID:'42'},ctx=connectHttp(env,config);return {ctx,calls,env,config};
}
test('HTTP requests use server state and proof omits credential values',async t=>{
  const f=await fixture(t),before=await requestHttp(f.ctx,'observe');assert.equal(before.data.value,'baseline');
  await requestHttp(f.ctx,'update',{body:{value:'actual-change'}});const after=await requestHttp(f.ctx,'observe');assert.equal(after.data.value,'actual-change');assert.equal(after.proof.browserUsed,false);
  assert.equal(f.calls[1].headers.authorization,'Bearer fixture-secret');assert.ok(!JSON.stringify(after.proof).includes('fixture-secret'));assert.match(after.proof.bodySha256,/^[a-f0-9]{64}$/);
});
test('missing auth and escaping paths fail before network access',async t=>{
  const f=await fixture(t);assert.throws(()=>connectHttp({TEST_ID:'42'},f.config),{code:'AUTH_REQUIRED'});
  assert.throws(()=>connectHttp(f.env,{...f.config,parameters:{id:'TEST_TOKEN'}}),{code:'INVALID_ADAPTER'});
  for(const path of ['//other.invalid/x','/../other','/path?token=bad','/path#bad','/bad\\path'])assert.throws(()=>httpUrl(f.ctx,path));
  assert.throws(()=>httpUrl({...f.ctx,parameters:{id:'..'}},'/resource/{id}'));
  assert.equal(httpUrl({...f.ctx,parameters:{id:'a/b'}},'/resource/{id}').pathname,'/resource/a%2Fb');assert.equal(f.calls.length,0);
});
test('HTTP driver refuses redirects and does not replay rate-limited writes',async t=>{
  const f=await fixture(t);await assert.rejects(requestHttp(f.ctx,'redirect'),{code:'HTTP_TRANSPORT_FAILED'});assert.equal(f.calls.length,1);
  await assert.rejects(requestHttp(f.ctx,'rate',{body:{value:'x'}}),error=>error.code==='RATE_LIMITED'&&error.details.retryAfter==='15'&&!JSON.stringify(error).includes('sensitive server details'));
  assert.equal(f.calls.filter(x=>x.path==='/rate').length,1);
});
test('response schema drift and uncertain writes are explicit and never auto-retried',async t=>{
  const f=await fixture(t);await assert.rejects(requestHttp(f.ctx,'bad'),{code:'RESPONSE_SCHEMA_CHANGED'});
  await assert.rejects(requestHttp(f.ctx,'uncertain',{body:{value:'x'}}),{code:'HTTP_TRANSPORT_FAILED'});assert.equal(f.calls.filter(x=>x.path==='/uncertain').length,1);
  assert.equal((await requestHttp(f.ctx,'observe')).data.value,'written-before-disconnect');
});
test('independent HTTP observer rejects a forged result and wrong resource ownership',async t=>{
  const f=await fixture(t),session={platform:'api',environment:f.env,api:{config:f.config,field:'value',owner:{owner:'fixture'}}};
  const witness={kind:'http-json',selector:'value',comparison:'equals',expected:'forged'};
  assert.equal((await observeHttpWitness(session,witness,{captureOnly:true})).actual,'baseline');
  await assert.rejects(observeHttpWitness(session,witness,{timeoutMs:0}),{code:'INDEPENDENT_WITNESS_FAILED'});
  await assert.rejects(observeHttpWitness({...session,api:{...session.api,owner:{owner:'other'}}},witness,{captureOnly:true}),{code:'RESOURCE_NOT_OWNED'});
});
