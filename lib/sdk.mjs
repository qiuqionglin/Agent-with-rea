import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { dirname } from 'node:path';
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
