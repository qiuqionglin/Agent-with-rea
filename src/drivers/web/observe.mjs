import {resolve} from 'node:path';
import {hash,writeJson} from '../../utils.mjs';
import {selectedPage} from './session.mjs';
const sensitive=/password|passwd|token|secret|cookie|authorization|credential|csrf|session/i;
export function redactObject(value){if(Array.isArray(value))return value.map(redactObject);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sensitive.test(k)?'[REDACTED]':redactObject(v)]));return value;}
export function safeUrl(value){const u=new URL(value);u.username='';u.password='';u.hash='';for(const key of u.searchParams.keys())if(sensitive.test(key))u.searchParams.set(key,'[REDACTED]');return u.href;}
function safeBody(text,type){
  if(type?.includes('json')){try{return JSON.stringify(redactObject(JSON.parse(text)));}catch{return '[non-JSON body omitted]';}}
  if(type?.includes('x-www-form-urlencoded')){const p=new URLSearchParams(text);for(const key of p.keys())if(sensitive.test(key))p.set(key,'[REDACTED]');return p.toString();}
  return undefined;
}
export async function recordApplicationNetwork(page,entries){
  const pending=[];const listener=response=>{const req=response.request();if(!['document','xhr','fetch'].includes(req.resourceType())||!/^https?:/.test(req.url()))return;
    pending.push((async()=>{
      if(entries.length>=120)return;const headers=req.headers(),rh=response.headers(),post=req.postData(),type=headers['content-type']||'',rType=rh['content-type']||'';
      let text;try{if(rType.includes('json')){const b=await response.body();if(b.length<=512*1024)text=safeBody(b.toString(),rType);}}catch{}
      entries.push({startedDateTime:new Date().toISOString(),time:0,request:{method:req.method(),url:safeUrl(req.url()),httpVersion:'HTTP/1.1',headers:type?[{name:'Content-Type',value:type}]:[],cookies:[],queryString:[],headersSize:-1,bodySize:post?Buffer.byteLength(post):0,...(post?{postData:{mimeType:type||'text/plain',text:safeBody(post,type)||'[body omitted]'}}:{})},response:{status:response.status(),statusText:response.statusText(),httpVersion:'HTTP/1.1',headers:rType?[{name:'Content-Type',value:rType}]:[],cookies:[],content:{mimeType:rType||'application/octet-stream',size:text?Buffer.byteLength(text):0,...(text?{text}:{})},redirectURL:'',headersSize:-1,bodySize:-1},cache:{},timings:{send:0,wait:0,receive:0},comment:'Actual browser exchange; credentials redacted and non-JSON response bodies omitted before retention.'});
    })());
  };page.on('response',listener);return async()=>{page.off('response',listener);await Promise.allSettled(pending);};
}
export async function observeApplication(session,out){
  const {browser,page}=await selectedPage(session);try{
    const observation=await page.evaluate(()=>({url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,16000),controls:[...document.querySelectorAll('input,textarea,button,select,a,[role=button]')].slice(0,160).map(e=>({tag:e.tagName,id:e.id,name:e.name,type:e.type,text:(e.innerText||e.getAttribute('aria-label')||'').slice(0,100),href:e.tagName==='A'?e.getAttribute('href'):undefined})),forms:[...document.forms].map(f=>({action:f.getAttribute('action'),method:f.method,fields:[...f.elements].map(e=>({name:e.name,type:e.type,tag:e.tagName}))})),globals:Object.keys(window).filter(k=>!/^on/.test(k)).slice(-100),scripts:[...document.scripts].map(s=>s.src).filter(Boolean)}));
    await writeJson(resolve(out,'observation.json'),{producer:'Independent DOM/runtime inventory; not REA or an accepted operation',...observation});return observation;
  }finally{await browser.close();}
}
