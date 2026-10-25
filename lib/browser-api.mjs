import {connectBrowser,browserTargetKey} from './web.mjs';
import {AppError,hash} from './sdk.mjs';
export {browserTargetKey};
export const connectBrowserApi=connectBrowser;

export async function checkBrowserApi(ctx,config){
  if(new URL(ctx.page.url()).origin!==config.origin||new URL(ctx.page.url()).pathname!==config.pathname)throw new AppError('SESSION_CHANGED','API client page changed',{},4);
  if(!config.sourcePins?.length)throw new AppError('INVALID_ADAPTER','Client API bridge requires source-byte pins');
  for(const pin of config.sourcePins){
    const url=new URL(pin.url);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||!config.sourceOrigins?.includes(url.origin)||!/^[a-f0-9]{64}$/.test(pin.sha256))throw new AppError('INVALID_ADAPTER','Invalid API client source pin');
    const result=await ctx.page.evaluate(async url=>{
      const r=await fetch(url,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
      const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>5*1024*1024)throw Error('Source too large');return {status:r.status,bytes:[...bytes]};
    },url.href).catch(()=>{throw new AppError('CLIENT_SOURCE_UNAVAILABLE','Could not check public client source bytes',{},3);});
    if(result.status!==200||hash(Buffer.from(result.bytes))!==pin.sha256)throw new AppError('VERSION_DRIFT','Client API source changed; reanalyze before use',{},4);
  }
}
function invokeExport({queueName,moduleId,exportName,args}){
  let require;const queue=window[queueName];if(!Array.isArray(queue))throw Error('Client runtime unavailable');
  const length=queue.length;queue.push([['app2cli_'+crypto.randomUUID()],{},r=>{require=r;}]);if(queue.length>length)queue.pop();
  if(!require?.m?.[moduleId])throw Error('Client module is not loaded');const fn=require(moduleId)?.[exportName];
  if(typeof fn!=='function')throw Error('Client API export unavailable');return Promise.resolve(fn(...args));
}
export async function callBrowserApi(ctx,name,args=[]){
  const binding=ctx.config.operations?.[name];
  // Browser bridge v1 deliberately exposes read operations only. Writes use
  // the direct HTTP path until an independent browser write observer is added.
  if(!binding||binding.method!=='GET'||!binding.path?.startsWith('/')||/[?#]/.test(binding.path))throw new AppError('UNKNOWN_OPERATION','Only declared GET client API bindings are supported');
  const cdp=await ctx.page.context().newCDPSession(ctx.page),events=[];
  try{
    await cdp.send('Network.enable');
    cdp.on('Network.responseReceived',e=>{try{const u=new URL(e.response.url);if(u.pathname===binding.path&&ctx.config.apiOrigins.includes(u.origin))events.push(e);}catch{}});
    const waiting=ctx.page.waitForResponse(r=>{try{const u=new URL(r.url());return r.request().method()==='GET'&&u.pathname===binding.path&&ctx.config.apiOrigins.includes(u.origin);}catch{return false;}},{timeout:20000});void waiting.catch(()=>{});
    let timer;const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({failed:true}),20000);});
    const outcome=await Promise.race([timeout,ctx.page.evaluate(invokeExport,{queueName:ctx.config.queueName,moduleId:binding.moduleId,exportName:binding.exportName,args}).then(value=>({value}),()=>({failed:true}))]).finally(()=>clearTimeout(timer));
    const response=await waiting.catch(()=>{throw new AppError('NETWORK_PROOF_UNAVAILABLE','Client invocation did not yield a matching backend response',{},3);});
    const bytes=await response.body(),event=events.find(e=>e.response.url===response.url()&&e.response.status===response.status());
    if(bytes.length>2*1024*1024||!event||event.response.fromDiskCache||event.response.fromServiceWorker||event.response.fromPrefetchCache||response.fromServiceWorker())throw new AppError('NETWORK_PROOF_UNAVAILABLE','Requires a bounded real network response, not a browser cache or service worker',{},3);
    let data;try{data=JSON.parse(bytes);}catch{throw new AppError('RESPONSE_SCHEMA_CHANGED','Client API response is not JSON',{},4);}
    const serverStatus=binding.successField?data[binding.successField]:undefined;
    if(response.status()!==200||(binding.successField&&serverStatus!==binding.successValue)||outcome.failed)throw new AppError('API_REJECTED','Client API request or mapper failed',{httpStatus:response.status(),serverStatus,clientMapperFailed:!!outcome.failed},3);
    return {data,clientResult:outcome.value,proof:{kind:'observed-client-api-network-response',transport:'browser-api',origin:new URL(response.url()).origin,path:binding.path,method:'GET',status:response.status(),serverStatus,bodySha256:hash(bytes),fromDiskCache:false,fromServiceWorker:false,requestId:event.requestId,observedAt:new Date().toISOString(),uiActions:0}};
  }finally{await cdp.detach();}
}
