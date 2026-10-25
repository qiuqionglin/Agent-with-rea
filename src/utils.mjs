import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
export class AppError extends Error {
  constructor(code,message,details={},exitCode=2){super(message);Object.assign(this,{code,details,exitCode});}
}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function canonical(value){
  return JSON.stringify(function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));return v;}(value));
}
export const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
export async function writeJson(path,value){
  await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=path+'.'+process.pid+'.tmp';
  await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,path);
}
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// No shell interpolation; generated code and prompts never become shell commands.
export async function runProcess(command,args,{cwd,env=process.env,input='',timeout=120000,log,maxBytes=16*1024*1024}={}){
  const child=spawn(command,args,{cwd,env,stdio:['pipe','pipe','pipe']});
  const logs=log?{stdout:createWriteStream(log+'.stdout',{flags:'wx',mode:0o600}),stderr:createWriteStream(log+'.stderr',{flags:'wx',mode:0o600})}:null;
  let logError;
  if(logs)for(const stream of Object.values(logs))stream.on('error',error=>{logError=error;child.kill('SIGTERM');});
  let stdout='',stderr='',timedOut=false,overflow=false,force;
  const stop=()=>{child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),1500);};
  const collect=key=>chunk=>{
    logs?.[key].write(chunk);
    if(key==='stdout')stdout+=chunk;else stderr+=chunk;
    if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>maxBytes&&!overflow){overflow=true;stop();}
  };
  child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));
  child.stdin.on('error',()=>{});child.stdin.end(input);
  const timer=setTimeout(()=>{timedOut=true;stop();},timeout);
  let code;
  try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}
  finally{clearTimeout(timer);clearTimeout(force);if(logs){for(const stream of Object.values(logs))stream.end();await Promise.all(Object.values(logs).map(stream=>finished(stream))).catch(error=>{logError=error;});}}
  if(logError)throw logError;
  if(timedOut||overflow)throw new AppError(timedOut?'PROCESS_TIMEOUT':'OUTPUT_LIMIT','Child process exceeded its bound',{command,log},3);
  return {code,stdout,stderr};
}
