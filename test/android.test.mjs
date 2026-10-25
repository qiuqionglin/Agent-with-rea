import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile,chmod,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAndroid } from '../src/generator/session.mjs';
import { observeWitness } from '../src/verify/resource.mjs';
import { hash,writeJson } from '../src/sdk.mjs';
import { touchSelector,tapSelector } from '../src/drivers/android/ui.mjs';

// Protocol fixture, not native Android acceptance. An absent `pm path` exits
// 1 just as it did on the real device; transport errors must still propagate.
async function device(t,{installed=false,wrongHash=false,offline=false}={}){
  const dir=await mkdtemp(join(tmpdir(),'app2cli-android-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const apk=join(dir,'input.apk'),adb=join(dir,'adb'),state=join(dir,'installed'),log=join(dir,'calls');
  const bytes=Buffer.from('fixture APK bytes');await writeFile(apk,bytes);
  if(installed)await writeFile(state,'yes');
  await writeJson(join(dir,'package.json'),{ok:true,data:{operation:'inspect_android_package',normalized_result:{package_name:'org.example.app'}}});
  await writeFile(adb,`#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2),command=args.slice(3).join(' '),state=${JSON.stringify(state)};
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(${offline})process.exit(1);
if(args[2]==='install'){fs.writeFileSync(state,'yes');console.log('Success');}
else if(command.includes("'pm' 'list' 'packages'")){console.log('package:org.example.app.extra');if(fs.existsSync(state))console.log('package:org.example.app');}
else if(command.includes("'pm' 'path'")){if(!fs.existsSync(state))process.exit(1);console.log('package:/data/app/base.apk');}
else if(command.includes("'sha256sum'"))console.log(${JSON.stringify(wrongHash?'0'.repeat(64):hash(bytes))}+'  /data/app/base.apk');
else if(command.includes("'resolve-activity'"))console.log('org.example.app/.MainActivity');
else if(command.includes("'am' 'start'"))console.log('Starting: Intent');
else if(command.includes("'uiautomator' 'dump'"))console.log('UI hierchary dumped to temporary XML');
else if(args[2]==='exec-out'&&args[3]==='cat')console.log('<hierarchy><node resource-id="org.example.app:id/text" package="org.example.app" text="actual device value" class="android.widget.EditText" focused="true" enabled="true" clickable="false" bounds="[10,20][110,80]"/></hierarchy>');
else if(command.includes("'rm' '-f'"))process.exit(0);
else if(command.includes("'input' 'tap'"))process.exit(0);
else process.exit(2);
`);await chmod(adb,0o700);
  const previous=process.env.REA_ADB_PATH;process.env.REA_ADB_PATH=adb;
  t.after(()=>{if(previous===undefined)delete process.env.REA_ADB_PATH;else process.env.REA_ADB_PATH=previous;});
  return {dir,apk,log,flags:{serial:'fixture-device'},calls:async()=> (await readFile(log,'utf8')).trim().split('\n').map(JSON.parse)};
}

test('Android first install is explicit and handles absent pm path without masking transport errors',async t=>{
  const d=await device(t);
  await assert.rejects(prepareAndroid(d.apk,d.dir,d.dir,d.flags),{code:'INSTALL_REQUIRED'});
  assert.equal((await d.calls()).some(args=>args[2]==='install'),false);
  const session=await prepareAndroid(d.apk,d.dir,d.dir,{...d.flags,install:true});
  assert.equal(session.android.config.component,'org.example.app/.MainActivity');
  assert.equal((await d.calls()).filter(args=>args[2]==='install').length,1);
  await prepareAndroid(d.apk,d.dir,d.dir,{...d.flags,install:true});
  assert.equal((await d.calls()).filter(args=>args[2]==='install').length,1);
});

test('Android --install never overwrites an existing APK with different bytes',async t=>{
  const d=await device(t,{installed:true,wrongHash:true});
  await assert.rejects(prepareAndroid(d.apk,d.dir,d.dir,{...d.flags,install:true}),{code:'VERSION_DRIFT'});
  assert.equal((await d.calls()).some(args=>args[2]==='install'),false);
});

test('Android transport failure is not mistaken for an absent package',async t=>{
  const d=await device(t,{offline:true});
  await assert.rejects(prepareAndroid(d.apk,d.dir,d.dir,{...d.flags,install:true}),{code:'ADB_FAILED'});
  assert.equal((await d.calls()).some(args=>args[2]==='install'),false);
});

test('independent Android observer retains native evidence and rejects a forged expected value',async t=>{
  const d=await device(t),session={platform:'android',android:{adb:process.env.REA_ADB_PATH,serial:'fixture-device',config:{package:'org.example.app'}}};
  const w={kind:'android-text',selector:'org.example.app:id/text',comparison:'equals',expected:'forged CLI result'};
  const observation=await observeWitness(session,w,{captureOnly:true,record:join(d.dir,'native.json')});
  assert.equal(observation.actual,'actual device value');assert.match(observation.hierarchySha256,/^[a-f0-9]{64}$/);
  const record=JSON.parse(await readFile(join(d.dir,'native.json'),'utf8'));
  assert.equal(record.hierarchy.nodes[0].class,'android.widget.EditText');assert.equal(record.hierarchy.nodes[0].focused,'true');
  await assert.rejects(observeWitness(session,w,{timeoutMs:0}),{code:'INDEPENDENT_WITNESS_FAILED'});
});

test('stored native backend works without shell environment and foreign overlays cannot satisfy a witness',async t=>{
  const d=await device(t),helper=join(d.dir,'native-helper');
  await writeFile(helper,`#!${process.execPath}
let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{
const request=JSON.parse(input);if(request.mode!=='dump'||request.package!=='org.example.app')process.exit(1);
console.log(JSON.stringify({ok:true,xml:'<hierarchy><node package="org.example.app" text="Home"/><node package="other.overlay" text="Search"/></hierarchy>'}));
});\n`);await chmod(helper,0o700);
  const session={platform:'android',environment:{APP2CLI_UIAUTOMATOR_PYTHON:helper},android:{adb:process.env.REA_ADB_PATH,serial:'fixture-device',config:{package:'org.example.app'}}};
  const valid={kind:'android-state',all:[{text:'Home'}]};
  assert.equal((await observeWitness(session,valid,{timeoutMs:0})).matched,true);
  await assert.rejects(observeWitness(session,{kind:'android-state',all:[{text:'Search'}]},{timeoutMs:0}),{code:'INDEPENDENT_WITNESS_FAILED'});
});


test('explicit touch uses current unique bounds without fabricating a clickable flag',async t=>{
  const d=await device(t),ctx={adb:process.env.REA_ADB_PATH,serial:'fixture-device',config:{package:'org.example.app'}};
  await assert.rejects(tapSelector(ctx,{'resource-id':'org.example.app:id/text'}),{code:'UI_CHANGED'});
  await touchSelector(ctx,{'resource-id':'org.example.app:id/text'});
  assert.ok((await d.calls()).some(args=>args.join(' ').includes("'input' 'tap' '60' '50'")));
  await assert.rejects(touchSelector(ctx,{text:'missing'}),{code:'UI_CHANGED'});
});
