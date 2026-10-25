import {AppError,canonical,writeJson,sleep} from '../utils.mjs';
import {connectHttp,requestHttp} from '../drivers/http/index.mjs';
export function jsonField(data,path){
  if(typeof path!=='string'||!path||path.split('.').some(k=>!k||['__proto__','prototype','constructor'].includes(k)))throw new AppError('INVALID_INPUT','Use a plain JSON data path');
  return path.split('.').reduce((value,key)=>value?.[key],data);
}
export function withoutField(data,path){
  const copy=structuredClone(data),parts=path.split('.');let parent=copy;
  for(const key of parts.slice(0,-1))parent=parent?.[key];
  if(parent&&typeof parent==='object')delete parent[parts.at(-1)];return copy;
}
export async function apiSnapshot(session){
  const r=await requestHttp(connectHttp({...process.env,...session.environment},session.api.config),'observe');
  for(const [path,value]of Object.entries(session.api.owner))if(canonical(jsonField(r.data,path))!==canonical(value))throw new AppError('RESOURCE_NOT_OWNED','API fixture expired or changed ownership; reprovision and verify before continuing',{path},4);
  return {producer:'fresh HTTP GET observation, not REA or generated adapter output',...r};
}
export async function observeHttpWitness(session,witness,{record,captureOnly=false,timeoutMs=20000}={}){
  if(witness.kind!=='http-json'||witness.selector!==session.api.field)throw new AppError('INVALID_TEST_PLAN','HTTP observer must use the caller-pinned server field');
  const ctx=connectHttp({...process.env,...session.environment},session.api.config),deadline=Date.now()+timeoutMs;let observation;
  do{
    const r=await requestHttp(ctx,'observe');
    for(const [path,value]of Object.entries(session.api.owner))if(canonical(jsonField(r.data,path))!==canonical(value))throw new AppError('RESOURCE_NOT_OWNED','Independent GET no longer identifies the owned resource',{path},4);
    const actual=jsonField(r.data,witness.selector);
    observation={producer:'independent HTTP GET observer; generated adapter is not imported',kind:witness.kind,selector:witness.selector,actual,data:r.data,proof:r.proof};
    if(record)await writeJson(record,observation);
    if(captureOnly||actual===witness.expected)return observation;
    await sleep(200);
  }while(Date.now()<deadline);
  throw new AppError('INDEPENDENT_WITNESS_FAILED','Fresh server GET did not confirm the requested value',{actual:observation?.actual,expected:witness.expected,proof:observation?.proof},5);
}
