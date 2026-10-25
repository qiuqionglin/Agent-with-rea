import Ajv from 'ajv';
import { AppError,hash,canonical } from './sdk.mjs';
const ajv=new Ajv({strict:true,allErrors:true});
const envName=/^[A-Z][A-Z0-9_]*$/;
export function connectHttp(env,config){
  const base=new URL(config.baseUrl);
  if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||!(base.protocol==='https:'||base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)))throw new AppError('INVALID_ADAPTER','HTTP baseUrl must be an HTTPS origin, or an explicit loopback test origin');
  const headers={accept:'application/json'},parameters={};
  if(config.auth){
    const a=config.auth;
    if(a.type!=='header'||!envName.test(a.env)||!['authorization','cookie','x-api-key'].includes(a.header?.toLowerCase())||typeof(a.prefix||'')!=='string')throw new AppError('INVALID_ADAPTER','Use an explicit supported auth header bound to an environment variable');
    if(!env[a.env])throw new AppError('AUTH_REQUIRED','Set the configured credential environment variable; credentials are never written into adapter files',{variable:a.env},3);
    const value=(a.prefix||'')+env[a.env];if(/[\r\n]/.test(value))throw new AppError('INVALID_INPUT','Invalid credential header');
    headers[a.header.toLowerCase()]=value;
  }
  for(const [name,variable]of Object.entries(config.parameters||{})){
    if(variable===config.auth?.env)throw new AppError('INVALID_ADAPTER','Credential variables cannot be reused as persisted resource parameters');
    if(!envName.test(variable)||!env[variable])throw new AppError('SESSION_REQUIRED','Set the required API resource variable',{variable},3);
    parameters[name]=env[variable];
  }
  return {config,origin:base.origin,headers,parameters,scopeKey:'http:'+base.origin+':'+hash(canonical({headers,parameters})),transport:'http'};
}
export const httpTargetKey=(env,config)=>connectHttp(env,config).scopeKey;
export function httpUrl(ctx,path,query={}){
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||/[?#\\]/.test(path))throw new AppError('INVALID_ADAPTER','Use an origin-relative API path without query or fragment');
  const substituted=path.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,(_,name)=>{
    const value=ctx.parameters[name];if(value===undefined||['.','..'].includes(String(value)))throw new AppError('INVALID_INPUT','Missing or invalid resource parameter',{name});return encodeURIComponent(value);
  });
  if(/[{}]/.test(substituted))throw new AppError('INVALID_ADAPTER','Unresolved path template');
  const url=new URL(substituted,ctx.origin);
  if(url.origin!==ctx.origin||url.pathname!==substituted)throw new AppError('INVALID_ADAPTER','API path changed origin or normalized unexpectedly');
  for(const [key,value]of Object.entries(query)){if(value===undefined||value===null)continue;if(typeof value==='object')throw new AppError('INVALID_INPUT','API query parameters must be scalar');url.searchParams.set(key,String(value));}
  return url;
}
export async function requestHttp(ctx,operation,{body,query={},headers={}}={}){
  const spec=ctx.config.operations?.[operation];
  if(!spec||!['GET','POST','PUT','PATCH','DELETE'].includes(spec.method))throw new AppError('UNKNOWN_OPERATION','Unknown HTTP operation',{operation});
  if(Object.keys(headers).some(k=>!['if-match','idempotency-key'].includes(k.toLowerCase())))throw new AppError('INVALID_INPUT','Only conditional/idempotency headers may be supplied per call');
  if(spec.method==='GET'&&body!==undefined)throw new AppError('INVALID_INPUT','GET requests cannot have a body');
  const url=httpUrl(ctx,spec.path,query),startedAt=new Date().toISOString();let response,bytes;
  try{
    response=await fetch(url,{method:spec.method,headers:{...ctx.headers,'cache-control':'no-cache',...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
    const reader=response.body?.getReader(),chunks=[];let size=0;
    if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw new AppError('RESPONSE_TOO_LARGE','API response exceeds 2 MiB',{},3);}chunks.push(value);}
    bytes=Buffer.concat(chunks);
  }catch(error){if(error instanceof AppError)throw error;throw new AppError('HTTP_TRANSPORT_FAILED','API request did not complete; a mutation may have an uncertain outcome',{operation,method:spec.method,path:spec.path},3);}
  const proof={kind:'http-response',transport:'http',origin:ctx.origin,path:spec.path,method:spec.method,status:response.status,bodySha256:hash(bytes),startedAt,receivedAt:new Date().toISOString(),etag:response.headers.get('etag'),requestId:response.headers.get('x-request-id'),browserUsed:false};
  if(!(spec.statuses||[200]).includes(response.status)){
    const code=response.status===401?'AUTH_REQUIRED':response.status===403?'ACCESS_DENIED':response.status===429?'RATE_LIMITED':response.status===409||response.status===412?'SERVER_CONFLICT':'HTTP_STATUS_FAILED';
    throw new AppError(code,'API returned an unexpected status',{...proof,retryAfter:response.headers.get('retry-after')},response.status===409||response.status===412?4:3);
  }
  let data;
  if(spec.response==='text')data=bytes.toString('utf8');
  else {try{data=JSON.parse(bytes);}catch{throw new AppError('RESPONSE_SCHEMA_CHANGED','API did not return JSON',proof,4);}}
  if(spec.responseSchema&&!ajv.validate(spec.responseSchema,data))throw new AppError('RESPONSE_SCHEMA_CHANGED','API JSON does not match the declared response schema',proof,4);
  return {data,proof};
}
