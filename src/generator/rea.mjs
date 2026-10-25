import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve,dirname } from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import { hash,writeJson,AppError } from '../sdk.mjs';
const require=createRequire(import.meta.url);
export const reaEvidence=envelope=>envelope?.ok===true&&envelope.data?.operation?envelope.data:envelope;
function reaEntry(){
  if(process.env.REA_CLI_PATH)return resolve(process.env.REA_CLI_PATH);
  try{return resolve(dirname(require.resolve('rea-agents/package.json')),'scripts/rea.mjs');}
  catch{throw new AppError('REA_UNAVAILABLE','Install rea-agents@6.7.0 or set REA_CLI_PATH to its scripts/rea.mjs',{},3);}
}
export async function runRea(args,path){
  const timeoutMs=Number(process.env.APP2CLI_REA_TIMEOUT_MS||180000);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>1800000)throw new AppError('INVALID_INPUT','APP2CLI_REA_TIMEOUT_MS must be 1000-1800000');
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const startedAt=new Date().toISOString();const child=spawn(process.execPath,[reaEntry(),...args,'--format','json','--full-output'],{env:process.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},timeoutMs);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);}).finally(()=>clearTimeout(timer));
  await writeFile(path,stdout,{mode:0o600});await writeFile(path+'.stderr',stderr,{mode:0o600});
  await writeJson(path+'.meta.json',{producer:'unmodified REA CLI stdout',args,startedAt,finishedAt:new Date().toISOString(),exitCode:code,timeoutMs,timedOut,sha256:hash(stdout)});
  if(code!==0)throw new AppError('REA_FAILED','REA analysis failed; inspect raw evidence',{path,exitCode:code},3);
  let raw;try{raw=reaEvidence(JSON.parse(stdout));}catch{throw new AppError('REA_FAILED','REA did not return JSON',{path},3);}
  if(raw.error||raw.isError)throw new AppError('REA_FAILED','REA returned an error',{path},3);
  // Keep the full CLI envelope byte-for-byte. REA consumers need the data
  // member as an Evidence document; this projection is separately labeled.
  const evidenceFile=path+'.evidence.json';await writeJson(evidenceFile,raw);
  await writeJson(evidenceFile+'.meta.json',{producer:'app2cli data-member projection of full REA CLI envelope',source:path,sourceSha256:hash(stdout)});
  return {raw,file:path,evidenceFile,sha256:hash(stdout),operation:raw.operation};
}
