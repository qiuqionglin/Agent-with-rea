import {selectedPage} from '../drivers/web/session.mjs';
import {hierarchy} from '../drivers/android/index.mjs';
import {apiSnapshot} from './http.mjs';
export async function snapshot(session){
  if(session.platform==='api'){return apiSnapshot(session);}
  if(session.platform==='android')return {producer:'app2cli live UI observation, not REA',...(await hierarchy(session.android))};
  const {browser,page}=await selectedPage(session);
  try{
    return {producer:'app2cli live DOM observation, not REA',url:page.url(),title:await page.title(),accessibility:await page.locator('body').ariaSnapshot(),dom:await page.evaluate(()=>({
      controls:[...document.querySelectorAll('input,textarea,button,[contenteditable],[role],select,[data-testid]')].slice(0,200).map(e=>({tag:e.tagName,id:e.id,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),title:e.getAttribute('title'),type:e.getAttribute('type'),classes:String(e.className),text:(e.textContent||'').slice(0,120)})),
      globals:Object.keys(window).filter(k=>!/^(on|webkit|chrome|scheduler)/.test(k)).slice(-100),storageKeys:Object.keys(localStorage),scripts:[...document.scripts].map(s=>s.src).filter(Boolean)
    }))};
  }finally{await browser.close();}
}
