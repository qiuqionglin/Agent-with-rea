import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {init,parse} from 'es-module-lexer';
import {build} from '../src/generator/build.mjs';
import {runtimeBundle} from '../src/generator/bundle.mjs';
import {loadAdapter} from '../src/runtime/manifest.mjs';
import {hash,readJson,writeJson,runProcess} from '../src/utils.mjs';

// Packaging/protocol checks only; these fixtures are not live REA evidence.
for(const sdkImport of ['../../lib/http-adapter.mjs','#app2cli/http-resource']){
  test(`a standalone HTTP CLI preserves execution and ships only its runtime (${sdkImport})`,async t=>{
    let resource={owner:'fixture',value:'before',untouched:42};
    const server=createServer(async(req,res)=>{
      if(req.method==='PATCH'){let text='';for await(const bytes of req)text+=bytes;resource={...resource,...JSON.parse(text)};}
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(resource));
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
    const root=await mkdtemp(join(tmpdir(),'app2cli-package-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const manifest={schemaVersion:1,id:'package-fixture',description:'Packaging fixture',platform:'api',transport:'http',verification:'server-confirmed',
      analysis:{recipe:'Protocol fixture, not live REA',claims:[{operation:'fixture_analysis'}]},
      config:{baseUrl:'http://127.0.0.1:'+server.address().port,field:'value',owner:{owner:'fixture'},updateMode:'field-patch',operations:{observe:{method:'GET',path:'/resource'},update:{method:'PATCH',path:'/resource'}}},
      commands:{'resource.read':{description:'Read',readOnly:true,inputSchema:{type:'object',properties:{},additionalProperties:false}},'resource.set':{description:'Set',readOnly:false,inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}}};
    const source=`// import '../../src/generator/rea.mjs'; is only a comment.\nconst text="import '../../src/drivers/android/index.mjs'";\nimport {createHttpResourceAdapter} from '${sdkImport}';\nexport default createHttpResourceAdapter();\n`;
    await writeJson(join(root,'adapter.json'),manifest);await writeFile(join(root,'adapter.mjs'),source);
    const evidence=JSON.stringify({operation:'fixture_analysis',normalized_result:{fixture:true}});
    await writeFile(join(root,'raw.json'),evidence);await writeJson(join(root,'evidence.json'),{platform:'api',records:[{file:'raw.json',operation:'fixture_analysis',sha256:hash(evidence)}]});
    const built=await build(root,{evidence:root,out:join(root,'package')});
    const pkg=await readJson(join(built.output,'package.json')),provenance=await readJson(join(built.output,'provenance.json'));
    assert.deepEqual(Object.keys(pkg.dependencies),['ajv']);
    assert.ok(provenance.runtimeFiles.includes('src/drivers/http/index.mjs'));
    assert.ok(provenance.runtimeFiles.every(p=>!/^src\/(generator|verify)\//.test(p)&&!/^src\/drivers\/(android|web|electron)\//.test(p)));
    assert.equal(await readFile(join(built.output,'adapters/package-fixture/adapter.mjs'),'utf8'),source);
    // Give the detached package only installed dependencies, never repo source.
    await symlink(resolve('node_modules'),join(built.output,'node_modules'),'dir');
    async function call(args){
      const r=await runProcess(process.execPath,[join(built.output,'cli.mjs'),...args],{cwd:tmpdir(),env:{...process.env,APP2CLI_HOME:join(root,'state')}});
      assert.equal(r.code,0,r.stdout+r.stderr);return JSON.parse(r.stdout);
    }
    assert.equal((await call(['resource','read'])).data.value,'before');
    const dry=await call(['resource','set','--value','after','--dry-run']);assert.equal(dry.dryRun,true);assert.equal(resource.value,'before');
    assert.equal((await call(['resource','set','--value','after','--request-id','write'])).data.value,'after');
    assert.deepEqual(resource,{owner:'fixture',value:'after',untouched:42});
    assert.equal((await call(['resource','set','--value','after','--request-id','write'])).replayed,true);
    assert.equal((await call(['resource','set','--value','before'])).data.value,'before');
    // Source/contract edits remain detectable after moving and packaging.
    await writeFile(join(built.output,'adapters/package-fixture/adapter.mjs'),source+'\n');
    const tampered=await runProcess(process.execPath,[join(built.output,'cli.mjs'),'--schema']);
    assert.equal(JSON.parse(tampered.stdout).error.code,'ADAPTER_CHANGED');
  });
}

test('every published example loads, has a runtime closure and keeps its historical CLI path',async()=>{
  const aliases={'todomvc':'adapters/todomvc','fossify-calculator':'adapters/fossify-calculator','booker-api':'examples/booker-api-generated','dillinger':'examples/dillinger-generated','douyin-web':'examples/douyin-browser-api','douyin-android':'examples/douyin-generated','editor':'examples/editor-generated','linkding':'examples/linkding-generated','marktext':'examples/marktext-generated'};
  const methods=['targetKey','connect','check','read','plan','dispatch','matches','refresh','result','close'];
  const entries=(await readdir('examples',{withFileTypes:true})).filter(e=>e.isDirectory());
  assert.equal(entries.length,9);
  for(const entry of entries){
    const dir=resolve('examples',entry.name),adapter=await loadAdapter(dir);
    const {default:plugin}=await import(pathToFileURL(join(dir,'adapter.mjs')));
    for(const method of methods)assert.equal(typeof plugin[method],'function',entry.name+': '+method);
    const bundle=await runtimeBundle(adapter);
    assert.ok(bundle.files.every(p=>!p.startsWith('src/generator/')&&!p.startsWith('src/verify/')));
    if(adapter.manifest.platform==='android')assert.ok(bundle.files.includes('src/drivers/android/text.py'));
    const cli=await runProcess(process.execPath,['bin/app2cli.mjs','run',aliases[entry.name],'--schema']);
    assert.equal(cli.code,0,cli.stdout+cli.stderr);assert.equal(JSON.parse(cli.stdout).adapterDigest,adapter.digest);
  }
  const list=await runProcess(process.execPath,['bin/app2cli.mjs','list']);
  assert.equal(JSON.parse(list.stdout).apps.length,entries.length);
});

test('packaging refuses generator dependencies, computed imports and unprovided dependencies',async()=>{
  const adapter={manifest:{id:'import-fixture'},source:Buffer.from('')};
  for(const source of ["import '../../src/generator/rea.mjs'",'const name="node:fs"; await import(name)',"import 'missing-sdk'"]){
    adapter.source=Buffer.from(source);
    await assert.rejects(runtimeBundle(adapter),{code:'UNSUPPORTED_ADAPTER_IMPORT'});
  }
});

test('runtime, drivers and independent verification have no authoring dependency',async()=>{
  await init;
  async function modules(directory){
    const files=[];
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=join(directory,entry.name);
      if(entry.isDirectory())files.push(...await modules(path));else if(path.endsWith('.mjs'))files.push(path);
    }
    return files;
  }
  for(const file of [...await modules('src/runtime'),...await modules('src/drivers'),...await modules('src/verify'),'src/sdk.mjs','src/utils.mjs']){
    const [requests]=parse(await readFile(file,'utf8'));
    for(const request of requests){
      if(!request.n?.startsWith('.'))continue;
      const target=resolve(file,'..',request.n);
      assert.ok(!target.startsWith(resolve('src/generator')+'/'),file+' imports authoring code');
      if(!file.startsWith('src/verify/'))assert.ok(!target.startsWith(resolve('src/verify')+'/'),file+' imports verification code');
    }
  }
});
