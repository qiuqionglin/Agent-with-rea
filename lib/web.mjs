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
    if(!page.url().startsWith('http')||new URL(page.url()).pathname!==config.pathname)continue;
    const session=await page.context().newCDPSession(page);const {targetInfo}=await session.send('Target.getTargetInfo');await session.detach();
    if(!env.APP2CLI_TARGET||targetInfo.targetId===env.APP2CLI_TARGET)candidates.push({page,targetId:targetInfo.targetId});
  }
  if(candidates.length!==1){await browser.close();throw new AppError('TARGET_REQUIRED','Set APP2CLI_TARGET to one exact matching page',{},3);}
  return {browser,...candidates[0],config,origin:new URL(candidates[0].page.url()).origin};
}
export async function checkBrowser(ctx,config){
  if(ctx.page.url()!==ctx.origin+config.pathname)throw new AppError('SESSION_CHANGED','Target page moved',{},4);
  for(const pin of config.pins){
    const r=await ctx.page.request.get(ctx.origin+pin.path);if(!r.ok()||hash(await r.body())!==pin.sha256)throw new AppError('VERSION_DRIFT','Application source changed; reanalyze and rebuild',{path:pin.path},4);
  }
  await ctx.page.waitForFunction(config.ready,{},{timeout:10000});
}
