import {connectApplication,applicationTargetKey,checkApplication,callApplication,workspacePath,browserRequest} from '../../lib/application-session.mjs';
import {AppError,hash,canonical} from '../../lib/sdk.mjs';

const fail=(code,message)=>{throw new AppError(code,message);};
const same=(a,b)=>canonical(a)===canonical(b);
const urlFor=key=>'https://example.com/?app2cli='+encodeURIComponent(key);
const searchPath=query=>'/bookmarks?q='+encodeURIComponent(query);
function keyCheck(namespace,key){if(typeof key!=='string'||key.length>180||!/^APP2CLI_[A-Za-z0-9_-]+$/.test(key)||!key.startsWith(namespace+'-'))fail('OWNERSHIP_REQUIRED','Use an immutable key within the runtime namespace.');}
function titleCheck(key,title){if(typeof title!=='string'||!title.startsWith(key))fail('INVALID_INPUT','Title must begin with the immutable ownership key.');}
function ownKey(namespace,url){try{const key=new URL(url).searchParams.get('app2cli');if(key&&key.startsWith(namespace+'-')&&/^APP2CLI_[A-Za-z0-9_-]+$/.test(key)&&url===urlFor(key))return key;}catch{}return null;}
const getHtml=(ctx,path)=>browserRequest(ctx,{path,format:'html'});

async function parseList(ctx,response,path){
  return ctx.page.evaluate(({html,path,origin})=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    if(doc.querySelector('#id_password'))throw Error('LOGIN_REQUIRED: retained browser login expired');
    if(!doc.querySelector('ld-bookmark-page')||!doc.querySelector('form.bookmark-actions'))throw Error('RESPONSE_SCHEMA_CHANGED: bookmark page missing');
    const base=new URL(path,origin),rows=[];
    for(const li of doc.querySelectorAll('ul.bookmark-list > li')){
      const input=li.querySelector('input[name="bookmark_id"]'),a=li.querySelector('.title > a');
      if(!input&&!a)continue;
      if(!input||!a||!a.hasAttribute('href')||!/^\d+$/.test(input.value))throw Error('RESPONSE_SCHEMA_CHANGED: bookmark row identity missing');
      const edit=Array.from(li.querySelectorAll('a[href]')).find(e=>/^\/bookmarks\/\d+\/edit(?:\?|$)/.test(e.getAttribute('href')||''));
      if(!edit)throw Error('RESPONSE_SCHEMA_CHANGED: edit link missing');
      const u=new URL(edit.getAttribute('href'),base);
      if(u.origin!==origin||u.pathname!=='/bookmarks/'+input.value+'/edit')throw Error('RESPONSE_SCHEMA_CHANGED: edit identity mismatch');
      // return_url varies with pagination and is not persisted bookmark state.
      rows.push({id:input.value,url:new URL(a.getAttribute('href'),base).href,title:(a.textContent||'').trim(),editPath:u.pathname});
    }
    const pages=Array.from(doc.querySelectorAll('.bookmark-pagination a[href]')).map(a=>{
      const u=new URL(a.getAttribute('href'),base);
      if(u.origin!==origin||u.pathname!=='/bookmarks'||u.hash)throw Error('RESPONSE_SCHEMA_CHANGED: pagination route changed');
      u.searchParams.sort();return u.pathname+u.search;
    });
    return {rows,pages};
  },{html:response.data,path,origin:ctx.config.origin});
}
async function scan(ctx,query){
  const initial=new URL(searchPath(query),ctx.config.origin);initial.searchParams.sort();
  const queue=[initial.pathname+initial.search],seen=new Set(),rows=new Map(),proofs=[];
  while(queue.length){
    const path=queue.shift();if(seen.has(path))continue;
    if(seen.size>=30)fail('OBSERVATION_LIMIT','Bookmark search exceeds the bounded pagination limit.');
    seen.add(path);
    const response=await getHtml(ctx,path),parsed=await parseList(ctx,response,path);proofs.push(response.proof);
    for(const row of parsed.rows){
      if(!ownKey(ctx.namespace,row.url))continue;
      if(rows.has(row.id)&&!same(rows.get(row.id),row))fail('CONCURRENT_CHANGE','Owned bookmark fields changed during pagination.');
      rows.set(row.id,row);
    }
    for(const next of parsed.pages){if(new URL(next,ctx.config.origin).searchParams.get('q')!==query)fail('RESPONSE_SCHEMA_CHANGED','Pagination lost its native search scope.');if(!seen.has(next))queue.push(next);}
  }
  return {rows:Array.from(rows.values()).sort((a,b)=>a.id.localeCompare(b.id)),proofs};
}
async function editForm(ctx,path){
  const response=await getHtml(ctx,path);
  const parsed=await ctx.page.evaluate(({html,path,origin})=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    if(doc.querySelector('#id_password'))throw Error('LOGIN_REQUIRED: retained browser login expired');
    const form=doc.querySelector('#id_url')?.closest('form'),base=new URL(path,origin);
    if(!form||form.method.toLowerCase()!=='post')throw Error('RESPONSE_SCHEMA_CHANGED: bookmark POST form missing');
    const action=new URL(form.getAttribute('action')||path,base);
    if(action.origin!==origin||action.pathname!==base.pathname||action.hash)throw Error('RESPONSE_SCHEMA_CHANGED: bookmark form action changed');
    for(const name of ['csrfmiddlewaretoken','auto_close','url','title','description','notes','unread'])if(!form.querySelector('[name="'+name+'"]'))throw Error('RESPONSE_SCHEMA_CHANGED: bookmark field missing');
    const component=form.querySelector('ld-tag-autocomplete[input-name="tag_string"]');
    if(!component)throw Error('RESPONSE_SCHEMA_CHANGED: tag field missing');
    const body={};
    for(const e of form.querySelectorAll('input[name],textarea[name],select[name]')){
      if(e.disabled||['submit','button','reset','file','password'].includes(e.type)||(['checkbox','radio'].includes(e.type)&&!e.checked))continue;
      const values=e.tagName==='SELECT'&&e.multiple?Array.from(e.selectedOptions).map(o=>o.value):[e.value];
      for(const value of values){if(body[e.name]===undefined)body[e.name]=value;else body[e.name]=[].concat(body[e.name],value);}
    }
    if(typeof body.csrfmiddlewaretoken!=='string'||!body.csrfmiddlewaretoken)throw Error('RESPONSE_SCHEMA_CHANGED: native CSRF field missing');
    const tagString=form.querySelector('[name="tag_string"]')?.value??component.getAttribute('input-value')??'';
    body.tag_string=tagString;
    const value=name=>form.querySelector('[name="'+name+'"]').value;
    return {action:action.pathname+action.search,body,bookmark:{url:value('url'),title:value('title'),description:value('description'),notes:value('notes'),unread:form.querySelector('[name="unread"]').checked,tagString}};
  },{html:response.data,path,origin:ctx.config.origin});
  return {...parsed,proof:response.proof};
}
function owned(key,bookmark){if(!bookmark||bookmark.url!==urlFor(key)||!bookmark.title.startsWith(key))fail('OWNERSHIP_REQUIRED','Resource ownership fields do not match its immutable key.');}
const others=(items,key)=>items.filter(item=>item.key!==key);
async function readState(ctx){
  const {command,input}=ctx.request;
  if(input.key!==undefined)keyCheck(ctx.namespace,input.key);
  const base=await scan(ctx,ctx.namespace),items=[],proofs=[...base.proofs];
  for(const row of base.rows){
    const key=ownKey(ctx.namespace,row.url);if(!key)continue;
    keyCheck(ctx.namespace,key);owned(key,row);
    if(items.some(item=>item.key===key))fail('AMBIGUOUS_RESOURCE','Duplicate immutable ownership URL.');
    if(items.length>=30)fail('OBSERVATION_LIMIT','Too many owned bookmarks for a complete snapshot.');
    const form=await editForm(ctx,row.editPath);owned(key,form.bookmark);proofs.push(form.proof);
    if(form.bookmark.title.trim()!==row.title)fail('CONCURRENT_CHANGE','List and persisted bookmark title disagree.');
    items.push({id:row.id,key,editPath:row.editPath,...form.bookmark});
  }
  items.sort((a,b)=>a.key.localeCompare(b.key));
  let searchItems=[];
  if(command==='bookmarks.search'){
    const search=await scan(ctx,input.query);proofs.push(...search.proofs);
    searchItems=search.rows.map(row=>{
      const item=items.find(item=>item.id===row.id&&item.url===row.url&&item.title.trim()===row.title);
      if(!item)fail('CONCURRENT_CHANGE','Search and persisted owned objects disagree.');return item;
    }).sort((a,b)=>a.key.localeCompare(b.key));
  }
  return {scopeKey:ctx.scope,data:{items,target:input.key?items.find(item=>item.key===input.key)??null:null,searchItems},proof:{transport:'browser-api',reads:proofs}};
}
async function post(ctx,path,body){
  const response=await browserRequest(ctx,{method:'POST',path,body,format:'form'});
  await ctx.page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    if(doc.querySelector('#id_password'))throw Error('LOGIN_REQUIRED: retained browser login expired');
    if(doc.querySelector('#id_url'))throw Error('FORM_REJECTED: server returned the bookmark edit form');
    if(!doc.querySelector('ld-bookmark-page'))throw Error('RESPONSE_SCHEMA_CHANGED: mutation did not return a bookmark page');
  },response.data);
  return {proof:response.proof};
}

export default {
  targetKey(env,config){return applicationTargetKey(env);},
  async connect(env,config){
    if(typeof env.APP2CLI_NAMESPACE!=='string'||!/^APP2CLI_[A-Za-z0-9_-]+$/.test(env.APP2CLI_NAMESPACE))fail('SESSION_REQUIRED','A marked runtime namespace is required.');
    const ctx=await connectApplication(env,config);
    ctx.scope='linkding:'+hash(applicationTargetKey(env)+'|'+(ctx.workspace||'')+'|'+ctx.namespace);return ctx;
  },
  async check(ctx,config){await checkApplication(ctx);if(ctx.request.input.key!==undefined)keyCheck(ctx.namespace,ctx.request.input.key);},
  async read(ctx){return readState(ctx);},
  async plan(command,input,before){
    const key=input.key,current=before.data.target;
    const plan={command,key,before:before.data.items,others:others(before.data.items,key),expected:null};
    if(command==='bookmarks.create'){
      titleCheck(key,input.title);if(current)fail('ALREADY_EXISTS','Owned bookmark already exists.');
      plan.expected={url:urlFor(key),title:input.title,description:input.description??'',notes:input.notes??'',unread:false,tagString:''};
    }else if(command==='bookmarks.update'){
      owned(key,current);titleCheck(key,input.title);plan.id=current.id;
      plan.expected={url:current.url,title:input.title,description:input.description,notes:input.notes,unread:current.unread,tagString:current.tagString};
    }else if(command==='bookmarks.delete'){
      if(current){owned(key,current);plan.id=current.id;}
    }else fail('UNKNOWN_COMMAND','Unsupported bookmark mutation.');
    return plan;
  },
  async dispatch(ctx,command,input,plan){
    keyCheck(ctx.namespace,input.key);
    const fresh=await readState(ctx);
    if(!same(fresh.data.items,plan.before))fail('CONCURRENT_CHANGE','Owned bookmarks changed after planning.');
    const current=fresh.data.target;
    if(command==='bookmarks.delete'){
      if(!current)return {alreadyAbsent:true};
      owned(input.key,current);
      const response=await getHtml(ctx,searchPath(input.key));
      const removal=await ctx.page.evaluate(({html,id,url,title,origin})=>{
        const doc=new DOMParser().parseFromString(html,'text/html');
        if(doc.querySelector('#id_password'))throw Error('LOGIN_REQUIRED: retained browser login expired');
        const li=Array.from(doc.querySelectorAll('ul.bookmark-list > li')).find(e=>e.querySelector('input[name="bookmark_id"]')?.value===id),a=li?.querySelector('.title > a');
        if(!a||new URL(a.getAttribute('href'),origin).href!==url||(a.textContent||'').trim()!==title.trim())throw Error('OWNERSHIP_REQUIRED: removal resource changed');
        const button=li.querySelector('button[name="remove"]'),form=button?.closest('form'),token=form?.querySelector('input[name="csrfmiddlewaretoken"]')?.value;
        const action=form?new URL(form.getAttribute('action'),origin):null;
        if(!button||button.value!==id||!token||form.method.toLowerCase()!=='post'||action.origin!==origin||action.pathname!=='/bookmarks/action'||action.hash)throw Error('RESPONSE_SCHEMA_CHANGED: removal form changed');
        return {path:action.pathname+action.search,body:{csrfmiddlewaretoken:token,remove:id}};
      },{html:response.data,id:current.id,url:current.url,title:current.title,origin:ctx.config.origin});
      return post(ctx,removal.path,removal.body);
    }
    if(!['bookmarks.create','bookmarks.update'].includes(command))fail('UNKNOWN_COMMAND','Unsupported bookmark mutation.');
    const form=await editForm(ctx,command==='bookmarks.create'?'/bookmarks/new':current.editPath);
    if(command==='bookmarks.update'){
      owned(input.key,form.bookmark);
      for(const field of ['url','title','description','notes','unread','tagString'])if(!same(form.bookmark[field],current[field]))fail('CONCURRENT_CHANGE','Bookmark fields changed before submission.');
    }
    const body={...form.body,url:plan.expected.url,title:plan.expected.title,description:plan.expected.description,notes:plan.expected.notes,tag_string:plan.expected.tagString};
    if(plan.expected.unread)body.unread=form.body.unread||'on';else delete body.unread;
    return post(ctx,form.action,body);
  },
  async matches(plan,snapshot){
    if(!same(others(snapshot.data.items,plan.key),plan.others))return false;
    const target=snapshot.data.target;
    if(plan.command==='bookmarks.delete')return target===null&&!snapshot.data.items.some(item=>item.key===plan.key);
    if(!target||target.key!==plan.key||(plan.id&&target.id!==plan.id))return false;
    return Object.entries(plan.expected).every(([field,value])=>same(target[field],value));
  },
  async refresh(ctx){await readState(ctx);},
  async result(command,input,snapshot){
    if(command==='bookmarks.list')return {items:snapshot.data.items};
    if(command==='bookmarks.search')return {items:snapshot.data.searchItems};
    if(command==='bookmarks.delete')return {key:input.key,deleted:snapshot.data.target===null};
    if(!snapshot.data.target)fail('NOT_FOUND','Owned active bookmark was not found.');
    return {bookmark:snapshot.data.target};
  },
  async close(ctx){await ctx.browser.close();}
};
