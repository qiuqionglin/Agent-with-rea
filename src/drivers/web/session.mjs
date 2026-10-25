import {chromium} from 'playwright-core';
import {AppError} from '../../utils.mjs';
export async function selectedPage(session){
  const browser=await chromium.connectOverCDP(session.environment.APP2CLI_CDP);
  for(const page of browser.contexts().flatMap(c=>c.pages())){
    const cdp=await page.context().newCDPSession(page);const {targetInfo}=await cdp.send('Target.getTargetInfo');await cdp.detach();
    if(targetInfo.targetId===session.environment.APP2CLI_TARGET)return {browser,page};
  }
  await browser.close();throw new AppError('SESSION_CHANGED','Generation target was closed',{},4);
}
