import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AppError,hash,readJson,writeJson,runProcess} from '../utils.mjs';
import {reaEvidence} from './rea.mjs';
import {adb,shell,checkAndroid} from '../drivers/android/index.mjs';
export async function prepareAndroid(apk,evidence,out,flags){
  const pkg=reaEvidence(await readJson(resolve(evidence,'package.json'))).normalized_result.package_name;
  if(!pkg||!/^[A-Za-z0-9_.]+$/.test(pkg))throw new AppError('INVALID_PACKAGE','REA did not identify an Android package');
  const adbPath=process.env.REA_ADB_PATH||'adb';let serial=flags.serial||process.env.APP2CLI_ANDROID_SERIAL;
  if(!serial){
    const result=await runProcess(adbPath,['devices']);const devices=result.stdout.split('\n').filter(l=>/\tdevice$/.test(l)).map(l=>l.split('\t')[0]);
    if(devices.length!==1)throw new AppError('DEVICE_REQUIRED','Connect one authorized Android device or pass --serial',{},3);serial=devices[0];
  }
  const ctx={serial,adb:adbPath,config:{package:pkg,apkSha256:hash(await readFile(apk))}};
  // pm path exits 1 for an absent package. Query the successful empty-list
  // form so an authorized first install does not fail before --install runs.
  const installed=(await shell(ctx,['pm','list','packages',pkg])).trim().split(/\r?\n/).includes('package:'+pkg);
  if(!installed){
    if(!flags.install)throw new AppError('INSTALL_REQUIRED','APK is not installed; use --install on a dedicated test device',{},3);
    const result=await adb(ctx,['install',apk],{timeout:180000});if(!result.includes('Success'))throw new AppError('INSTALL_FAILED',result,{},3);
  }
  await checkAndroid(ctx,ctx.config);
  const component=(await shell(ctx,['cmd','package','resolve-activity','--brief',pkg])).trim().split('\n').at(-1);
  if(!component.startsWith(pkg+'/'))throw new AppError('LAUNCH_FAILED','No exported launcher resolved',{},3);
  ctx.config.component=component;const launched=await shell(ctx,['am','start','-n',component]);
  if(/Error|Exception|Permission Denial/.test(launched))throw new AppError('LAUNCH_FAILED','Resolved activity did not launch',{},3);
  const session={platform:'android',apk,android:ctx,environment:{APP2CLI_ANDROID_SERIAL:serial,REA_ADB_PATH:adbPath,...(process.env.APP2CLI_UIAUTOMATOR_PYTHON?{APP2CLI_UIAUTOMATOR_PYTHON:process.env.APP2CLI_UIAUTOMATOR_PYTHON}:{})}};
  await writeJson(resolve(out,'session.json'),session);return session;
}
