import { chromium } from 'playwright-core';
import { AppError,hash } from './sdk.mjs';
export const browserTargetKey=env=>{
  if(!env.APP2CLI_CDP)throw new AppError('SESSION_REQUIRED','Set APP2CLI_CDP to the owned browser CDP endpoint',{},3);
  return 'web:'+env.APP2CLI_CDP+'|'+(env.APP2CLI_TARGET||'selected-app');
};
export async function connectBrowser(env,config){
  browserTargetKey(env);const endpoint=new URL(env.APP2CLI_CDP);
  if(!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new AppError('SESSION_REQUIRED','This driver accepts loopback CDP endpoints',{},3);
  const browser=await chromium.connectOverCDP(endpoint.href);const candidates=[];
  for(const page of browser.contexts().flatMap(c=>c.pages())){
    if(!page.url().startsWith('http')||new URL(page.url()).pathname!==config.pathname||(config.origin&&new URL(page.url()).origin!==config.origin))continue;
    const session=await page.context().newCDPSession(page);const {targetInfo}=await session.send('Target.getTargetInfo');await session.detach();
    if(!env.APP2CLI_TARGET||targetInfo.targetId===env.APP2CLI_TARGET)candidates.push({page,targetId:targetInfo.targetId});
  }
  if(candidates.length!==1){await browser.close();throw new AppError('TARGET_REQUIRED','Set APP2CLI_TARGET to one exact matching page',{},3);}
  return {browser,...candidates[0],config,origin:new URL(candidates[0].page.url()).origin};
}
export async function checkBrowser(ctx,config){
  if(new URL(ctx.page.url()).origin!==ctx.origin||new URL(ctx.page.url()).pathname!==config.pathname||(config.origin&&ctx.origin!==config.origin))throw new AppError('SESSION_CHANGED','Target page moved',{},4);
  for(const pin of config.pins){
    const url=new URL(pin.path,ctx.origin);
    if(url.origin!==ctx.origin)throw new AppError('INVALID_ADAPTER','Source pins must remain on the selected application origin');
    // Fetch inside the existing browser: CDP does not expose proxy options to
    // Playwright's separate APIRequestContext, while browser fetch uses the
    // actual application network/session context.
    const r=await ctx.page.evaluate(async url=>{
      const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length>5*1024*1024)throw new Error('Source pin exceeds 5 MiB');
      return {ok:response.ok,bytes:[...bytes]};
    },url.href);
    if(!r.ok||hash(Buffer.from(r.bytes))!==pin.sha256)throw new AppError('VERSION_DRIFT','Application source changed; reanalyze and rebuild',{path:pin.path},4);
  }
  await ctx.page.waitForFunction(config.ready,{},{timeout:10000});
}
