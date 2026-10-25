import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {generate} from '../lib/generate.mjs';
import {hash,writeJson} from '../lib/sdk.mjs';

// Explicit local protocol fixture, not REA/model or public-backend evidence.
test('HTTP generation builds and executes separate CLI processes with independent GET restoration',async t=>{
  let resource={owner:'test',value:'baseline',untouched:42},patches=0;
  const server=createServer(async(req,res)=>{
    if(req.method==='PATCH'){let body='';for await(const b of req)body+=b;resource={...resource,...JSON.parse(body)};patches++;}
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(resource));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  // Keep packages under this checkout so ordinary dependency resolution works.
  const directory=await mkdtemp(resolve('.local-api-protocol-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const origin='http://127.0.0.1:'+server.address().port;
  const config={baseUrl:origin,field:'value',owner:{owner:'test'},updateMode:'field-patch',parameters:{},operations:{observe:{method:'GET',path:'/resource'},update:{method:'PATCH',path:'/resource'}}};
  const manifest={schemaVersion:1,id:'api-protocol',description:'Protocol fixture only',platform:'api',transport:'http',verification:'server-confirmed',config,analysis:{recipe:'Test fixture only',claims:[{operation:'inspect_web_network_capture'}]},commands:{'resource.read':{description:'Read',readOnly:true,transport:'http',inputSchema:{type:'object',properties:{},additionalProperties:false}},'resource.set':{description:'Set',readOnly:false,transport:'http',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}}};
  const module="import {createHttpResourceAdapter} from '../../lib/http-adapter.mjs'; export default createHttpResourceAdapter();";
  const result=await generate(origin,{id:'api-protocol',transport:'http',out:join(directory,'run')},{
    prepare:async({evidence,out})=>{
      const bytes=JSON.stringify({operation:'inspect_web_network_capture',normalized_result:{note:'Not live REA'}});
      await writeJson(join(evidence,'evidence.json'),{platform:'api',records:[{file:'fixture.json',operation:'inspect_web_network_capture',sha256:hash(bytes)}]});await writeFile(join(evidence,'fixture.json'),bytes);
      const session={platform:'api',url:origin,environment:{},api:{schemaVersion:1,field:'value',owner:{owner:'test'},config}};await writeJson(join(out,'api-case.json'),session.api);return session;
    },
    agent:async prompt=>{
      const marker=/APP2CLI_[a-f0-9]{32}/.exec(prompt)[0];
      return {decision:'candidate',reason:'Protocol fixture only',manifest:JSON.stringify(manifest),module,testPlan:JSON.stringify({schemaVersion:1,semantics:'replace-value',read:{command:'resource.read',input:{}},write:{command:'resource.set',input:{value:'$value'}},valuePath:'value',testValue:marker,witness:{kind:'http-json',selector:'value',comparison:'equals',expected:marker}})};
    }
  });
  assert.equal(result.checks,8);assert.equal(result.transport,'http');assert.equal(result.verification,'server-confirmed');assert.equal(patches,2);assert.deepEqual(resource,{owner:'test',value:'baseline',untouched:42});
});
