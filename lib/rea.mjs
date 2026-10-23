import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve,dirname } from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import { hash,writeJson,AppError } from './sdk.mjs';
const require=createRequire(import.meta.url);
export function reaEntry(){
  if(process.env.REA_CLI_PATH)return resolve(process.env.REA_CLI_PATH);
  try{return resolve(dirname(require.resolve('rea-agents/package.json')),'scripts/rea.mjs');}
  catch{throw new AppError('REA_UNAVAILABLE','Install rea-agents@6.7.0 or set REA_CLI_PATH to its scripts/rea.mjs',{},3);}
}
export async function runRea(args,path){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const startedAt=new Date().toISOString();const child=spawn(process.execPath,[reaEntry(),...args,'--format','json'],{env:process.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);}).finally(()=>clearTimeout(timer));
  await writeFile(path,stdout,{mode:0o600});await writeFile(path+'.stderr',stderr,{mode:0o600});
  await writeJson(path+'.meta.json',{producer:'unmodified REA CLI stdout',args,startedAt,finishedAt:new Date().toISOString(),exitCode:code,sha256:hash(stdout)});
  if(code!==0)throw new AppError('REA_FAILED','REA analysis failed; inspect raw evidence',{path,exitCode:code},3);
  let raw;try{raw=JSON.parse(stdout);}catch{throw new AppError('REA_FAILED','REA did not return JSON',{path},3);}
  if(raw.error||raw.isError)throw new AppError('REA_FAILED','REA returned an error',{path},3);
  return {raw,file:path,sha256:hash(stdout),operation:raw.operation};
}
