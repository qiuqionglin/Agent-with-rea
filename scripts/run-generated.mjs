// Use a completed run's private session bindings without copying credentials.
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {readJson,AppError} from '../lib/sdk.mjs';
import {loadAdapter} from '../lib/manifest.mjs';
const [directory,...args]=process.argv.slice(2);
try{
  if(!directory)throw new AppError('INVALID_INPUT','Usage: node scripts/run-generated.mjs <passed-run-directory> <command> [options]');
  const run=resolve(directory),result=await readJson(resolve(run,'result.json'));
  if(result.status!=='passed'||!/^[a-z][a-z0-9-]{1,48}$/.test(result.app))throw new AppError('GENERATION_UNVERIFIED','Use a completed generation');
  const adapter=await loadAdapter(resolve(run,'package/adapters',result.app));
  if(adapter.digest!==result.adapterDigest)throw new AppError('ADAPTER_CHANGED','Generated adapter differs from its acceptance record');
  const environment={};for(const [key,value]of Object.entries(result.environment||{})){if(!/^APP2CLI_[A-Z0-9_]+$/.test(key)&&key!=='REA_ADB_PATH')throw new AppError('INVALID_INPUT','Unexpected session environment variable');if(typeof value!=='string')throw new AppError('INVALID_INPUT','Invalid session binding');environment[key]=value;}
  const child=spawn(process.execPath,[resolve(run,'package/cli.mjs'),...args],{env:{...process.env,...environment},stdio:'inherit'});
  process.exitCode=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',code=>done(code??1));});
}catch(error){console.log(JSON.stringify({ok:false,error:{code:error.code||'RUN_FAILED',message:error.message}}));process.exitCode=error.exitCode||1;}
