import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {hash,writeJson,AppError} from './sdk.mjs';
import {selectedPage} from './application-session.mjs';
import {runRea} from './rea.mjs';
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
export async function retainNetwork(entries,evidence,index,name){
  if(!entries.length)return;
  const har=resolve(evidence,name+'.har');await writeJson(har,{log:{version:'1.2',creator:{name:'app2cli browser recorder; sensitive fields redacted at capture',version:'1'},entries}});
  const r=await runRea(['inspect-web-network-capture',har,'har'],resolve(evidence,name+'.json'));index.records.push({file:name+'.json',operation:r.operation,evidenceId:r.raw.evidence_id,sha256:r.sha256});await writeJson(resolve(evidence,'evidence.json'),index);
}
export async function discoverWebSources(session,evidence,index){
  const {browser,page}=await selectedPage(session);try{
    const paths=await page.locator('script[src]').evaluateAll(es=>es.map(e=>e.src).filter(u=>new URL(u).origin===location.origin));
    const sources=[],dir=resolve(evidence,'sources');await mkdir(dir,{recursive:true});
    for(const [i,url]of paths.slice(0,8).entries()){
      const r=await page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store',redirect:'error'});return {status:r.status,text:await r.text()};},url);
      if(r.status!==200||Buffer.byteLength(r.text)>5*1024*1024)continue;
      const name='script-'+i+'.js';await writeFile(resolve(dir,name),r.text,{mode:0o600});sources.push({path:name,url:safeUrl(url),sha256:hash(r.text),bytes:Buffer.byteLength(r.text)});
    }
    if(!sources.length)throw new AppError('NO_SOURCES','No same-origin application JavaScript source was retained');
    await writeJson(resolve(evidence,'source-index.json'),{producer:'app2cli source-byte acquisition, not REA',sources,scope:'Up to eight same-origin scripts, 5 MiB per source; other origins and unloaded modules remain unknown'});
    const selected=sources.slice(0,3);const r=await runRea(['analyze-javascript-application',dir,...selected.flatMap(s=>['--source-path',s.path]),'--max-semantic-nodes','2000','--max-semantic-nodes-per-file','1000','--analysis-timeout-ms','60000','--max-heap-mb','1024'],resolve(evidence,'source-analysis.json'));
    index.records.push({file:'source-analysis.json',operation:r.operation,evidenceId:r.raw.evidence_id,sha256:r.sha256});await writeJson(resolve(evidence,'evidence.json'),index);return sources;
  }finally{await browser.close();}
}
