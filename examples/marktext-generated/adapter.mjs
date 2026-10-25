import {connectApplication,applicationTargetKey,checkApplication,callApplication,workspacePath} from '../../lib/application-session.mjs';
import {AppError,hash,canonical} from '../../lib/sdk.mjs';
const PIN='e2e3811dcb295a51a8c01421a75f7d66951c4c69bd13f4b9117f0b4f9db8f14f';
const COMMANDS=new Set(['document.open','document.read','document.edit','document.save','document.reopen','document.restore']);
const NAME=/^APP2CLI_[A-Za-z0-9_-]+\.md$/;
function fail(code,message){throw new AppError(code,message);}
function owned(name,namespace){return typeof name==='string'&&name.length<=160&&NAME.test(name)&&name.startsWith(namespace+'-');}
function targetKey(env){if(!env.APP2CLI_WORKSPACE)fail('WORKSPACE_REQUIRED','Use the owned workspace');return 'marktext:'+applicationTargetKey(env)+'|workspace:'+hash(env.APP2CLI_WORKSPACE);}
async function connect(env,config){const ctx=await connectApplication(env,config);ctx.scopeKey=hash(targetKey(env)+'|namespace:'+String(ctx.namespace));return ctx;}
async function check(ctx,config){
  if(config.artifactSha256!==PIN)fail('VERSION_DRIFT','Unexpected artifact identity');
  await checkApplication(ctx);
  if(typeof ctx.namespace!=='string'||!/^APP2CLI_[A-Za-z0-9_-]+$/.test(ctx.namespace))fail('OWNERSHIP_REQUIRED','Runtime namespace is required');
  const {command,input}=ctx.request;
  if(!COMMANDS.has(command)||!owned(input.path,ctx.namespace))fail('INVALID_INPUT','Use a Markdown filename belonging to this namespace');
  workspacePath(ctx,input.path);
  if(['document.edit','document.restore'].includes(command)){
    if(typeof input.content!=='string'||input.content.length>65536||!input.content.includes(ctx.namespace)||/[\r\0]/.test(input.content))fail('INVALID_INPUT','Use bounded LF Markdown retaining the runtime namespace');
  }
  const valid=await ctx.page.evaluate(()=>{
    const stores=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s;
    const editor=stores?.get('editor');
    return !!editor&&Array.isArray(editor.tabs)&&['loadChange','FILE_SAVE','FORCE_CLOSE_TAB','SWITCH_TAB_BY_FILEPATH'].every(k=>typeof editor[k]==='function')&&['readFile','readdir','stat'].every(k=>typeof window.fileUtils?.[k]==='function')&&typeof window.electron?.ipcRenderer?.send==='function'&&stores.get('preferences')?.autoSave===false&&document.querySelectorAll('[contenteditable=true]').length===1;
  });
  if(!valid)fail('API_SCHEMA_CHANGED','Required document APIs, editor, or manual-save mode are unavailable');
}
async function read(ctx){
  const entries=await callApplication(ctx,'fileUtils.readdir',[ctx.workspace]);
  if(!Array.isArray(entries)||entries.some(x=>typeof x!=='string'))fail('RESPONSE_SCHEMA_CHANGED','Expected native directory names');
  const names=entries.filter(x=>owned(x,ctx.namespace)).sort();
  if(names.length>32)fail('OBSERVATION_LIMIT','Too many owned documents');
  if(!names.includes(ctx.request.input.path))fail('NOT_FOUND','The owned fixture document does not exist');
  const files=[],mapping=[];
  for(const path of names){
    const absolute=workspacePath(ctx,path);
    const stat=await callApplication(ctx,'fileUtils.stat',[absolute]);
    if(!stat||stat.isFile!==true||typeof stat.size!=='number'||stat.size>262144)fail('UNSUPPORTED_DOCUMENT','Use small regular Markdown files');
    const content=await callApplication(ctx,'fileUtils.readFile',[absolute,'utf8']);
    if(typeof content!=='string'||content.length>65536)fail('OBSERVATION_LIMIT','Native text exceeds its schema');
    files.push({path,content});mapping.push({path,absolute});
  }
  const native=await ctx.page.evaluate(mapping=>{
    const editor=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor');
    const names=new Map(mapping.map(x=>[x.absolute,x.path]));
    const tabs=editor.tabs.filter(t=>names.has(t.pathname)).map(t=>({path:names.get(t.pathname),markdown:t.markdown,encoding:JSON.parse(JSON.stringify(t.encoding)),lineEnding:t.lineEnding,adjustLineEndingOnSave:t.adjustLineEndingOnSave,trimTrailingNewline:t.trimTrailingNewline})).sort((a,b)=>a.path.localeCompare(b.path));
    const activePath=names.get(editor.currentFile?.pathname)||null;
    const elements=document.querySelectorAll('[contenteditable=true]');
    return {tabs,activePath,rendererCount:elements.length,rendererText:activePath&&elements.length===1?elements[0].innerText:null};
  },mapping);
  if(native.tabs.some(t=>typeof t.markdown!=='string'||t.markdown.length>65536)||new Set(native.tabs.map(t=>t.path)).size!==native.tabs.length||native.rendererText!==null&&(typeof native.rendererText!=='string'||native.rendererText.length>131072))fail('RESPONSE_SCHEMA_CHANGED','Unexpected editor document schema');
  return {scopeKey:ctx.scopeKey,data:{namespace:ctx.namespace,files,...native},proof:{transport:'electron-api',artifactSha256:PIN,files:files.map(f=>({path:f.path,sha256:hash(f.content)})),rendererSelector:'[contenteditable=true]',editorSha256:hash(canonical(native))}};
}
function selected(snapshot,path){const file=snapshot.data.files.find(f=>f.path===path);if(!file)fail('NOT_FOUND','Owned document is missing');return {file,tab:snapshot.data.tabs.find(t=>t.path===path)};}
function requireFormat(tab){if(!tab||!['utf8','utf-8'].includes(String(tab.encoding?.encoding).toLowerCase())||tab.encoding?.isBom||tab.lineEnding!=='lf')fail('UNSUPPORTED_FORMAT','Saving and editing require UTF-8 without BOM and LF line endings');}
function plan(command,input,before){
  const {file,tab}=selected(before,input.path);
  if(['document.edit','document.save'].includes(command)){
    if(before.data.activePath!==input.path)fail('DOCUMENT_NOT_ACTIVE','Open the target before editing or saving');
    requireFormat(tab);
  }
  if(command==='document.reopen'&&tab&&tab.markdown!==file.content)fail('UNSAVED_CHANGES','Save the target before reopening');
  const markdown=['document.edit','document.restore'].includes(command)?input.content:command==='document.reopen'?file.content:tab?.markdown??file.content;
  const persist=['document.save','document.restore'].includes(command);
  const anchors=markdown.split('\n').filter(line=>line.length>0&&/^[A-Za-z0-9_ .,!?():;-]+$/.test(line));
  return {command,path:input.path,markdown,content:persist?markdown:file.content,namespace:before.data.namespace,anchors,fileNames:before.data.files.map(f=>f.path),otherFiles:before.data.files.filter(f=>f.path!==input.path),otherTabs:before.data.tabs.filter(t=>t.path!==input.path),expectedChanges:{activeDocument:input.path,buffer:markdown,persist,preserveUnrelatedOwnedDocuments:true}};
}
async function ensureOpen(ctx,path){
  const absolute=workspacePath(ctx,path);
  const found=await ctx.page.evaluate(p=>{
    const editor=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor');
    if(!editor.tabs.some(t=>t.pathname===p))return false;
    editor.SWITCH_TAB_BY_FILEPATH(p);return true;
  },absolute);
  if(!found)await callApplication(ctx,'electron.ipcRenderer.send',['mt::open-file',absolute,{}]);
  await ctx.page.waitForFunction(p=>document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('editor')?.currentFile?.pathname===p,absolute,{timeout:8000});
  await ctx.page.waitForTimeout(80);
}
async function replaceContent(ctx,path,content){
  await ctx.page.evaluate(({absolute,content})=>{
    const editor=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor');
    const file=editor.currentFile;
    if(!file||file.pathname!==absolute)throw Error('Target document is not active');
    if(!['utf8','utf-8'].includes(String(file.encoding?.encoding).toLowerCase())||file.encoding?.isBom||file.lineEnding!=='lf')throw Error('Unsupported document format');
    const data=JSON.parse(JSON.stringify({filename:file.filename,encoding:file.encoding,lineEnding:file.lineEnding,adjustLineEndingOnSave:file.adjustLineEndingOnSave,trimTrailingNewline:file.trimTrailingNewline}));
    editor.loadChange({pathname:absolute,data:{...data,markdown:content,isMixedLineEndings:false}});
  },{absolute:workspacePath(ctx,path),content});
  await ctx.page.waitForTimeout(80);
  await ctx.page.waitForFunction(({absolute,content})=>{
    const file=document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('editor')?.currentFile;
    return file?.pathname===absolute&&file.markdown===content;
  },{absolute:workspacePath(ctx,path),content},{timeout:8000});
}
async function saveDocument(ctx,path){
  await ctx.page.evaluate(absolute=>{
    const editor=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor');
    const file=editor.currentFile;
    if(!file||file.pathname!==absolute)throw Error('Target document is not active');
    if(!['utf8','utf-8'].includes(String(file.encoding?.encoding).toLowerCase())||file.encoding?.isBom||file.lineEnding!=='lf')throw Error('Unsupported document format');
    editor.FILE_SAVE();
  },workspacePath(ctx,path));
}
async function dispatch(ctx,command,input,p){
  if(command!==p.command||input.path!==p.path)fail('INVALID_PLAN','Request and plan differ');
  if(command==='document.reopen'){
    await ctx.page.evaluate(absolute=>{
      const editor=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('editor');
      const tab=editor.tabs.find(t=>t.pathname===absolute);
      if(tab)editor.FORCE_CLOSE_TAB(tab);
    },workspacePath(ctx,p.path));
  }
  if(['document.open','document.reopen','document.restore'].includes(command))await ensureOpen(ctx,p.path);
  if(['document.edit','document.restore'].includes(command))await replaceContent(ctx,p.path,input.content);
  if(['document.save','document.restore'].includes(command))await saveDocument(ctx,p.path);
  return {transport:'electron-api',path:p.path,operation:command};
}
function matches(p,snapshot){
  const d=snapshot.data,file=d.files.find(f=>f.path===p.path),tab=d.tabs.find(t=>t.path===p.path);
  if(!file||!tab||file.content!==p.content||tab.markdown!==p.markdown||d.activePath!==p.path||d.rendererCount!==1||typeof d.rendererText!=='string')return false;
  if(p.markdown.trim()&&!d.rendererText.trim())return false;
  if(p.markdown.includes(p.namespace)&&!d.rendererText.includes(p.namespace))return false;
  if(!p.anchors.every(text=>d.rendererText.includes(text)))return false;
  return canonical(d.files.map(f=>f.path))===canonical(p.fileNames)&&canonical(d.files.filter(f=>f.path!==p.path))===canonical(p.otherFiles)&&canonical(d.tabs.filter(t=>t.path!==p.path))===canonical(p.otherTabs);
}
async function refresh(ctx){
  const content=await callApplication(ctx,'fileUtils.readFile',[workspacePath(ctx,ctx.request.input.path),'utf8']);
  if(typeof content!=='string')fail('RESPONSE_SCHEMA_CHANGED','Fresh native file read failed');
}
function result(command,input,snapshot){
  const {file,tab}=selected(snapshot,input.path);
  return {path:file.path,content:file.content,markdown:tab?.markdown??null,open:!!tab,active:snapshot.data.activePath===file.path,editorText:snapshot.data.activePath===file.path?snapshot.data.rendererText:null,bufferMatchesFile:tab?tab.markdown===file.content:null};
}
async function close(ctx){await ctx.browser.close();}
export default {targetKey,connect,check,read,plan,dispatch,matches,refresh,result,close};
