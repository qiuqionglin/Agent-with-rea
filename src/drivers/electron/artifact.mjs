import {readFile,mkdir,writeFile,realpath,stat,readdir} from 'node:fs/promises';
import {resolve,dirname,join,relative} from 'node:path';
import {AppError,hash,writeJson} from '../../sdk.mjs';

export async function readAsar(path){
  const bytes=await readFile(path);if(bytes.length<16||bytes.length>512*1024*1024)throw new AppError('INVALID_ARTIFACT','ASAR size is outside the supported bound');
  const headerSize=bytes.readUInt32LE(4),textSize=bytes.readUInt32LE(12),dataOffset=8+headerSize;
  if(textSize>headerSize-8||16+textSize>bytes.length||dataOffset>bytes.length)throw new AppError('INVALID_ARTIFACT','Malformed ASAR header');
  let header;try{header=JSON.parse(bytes.subarray(16,16+textSize));}catch{throw new AppError('INVALID_ARTIFACT','ASAR header is not JSON');}
  const entries=[];
  function visit(files,prefix=''){for(const [name,entry]of Object.entries(files||{})){
    if(!name||name==='.'||name==='..'||/[\\/\0]/.test(name))throw new AppError('INVALID_ARTIFACT','Unsafe ASAR member name');
    const path=prefix+name;if(entry.files)visit(entry.files,path+'/');else entries.push({path,...entry});
  }}visit(header.files);
  async function read(member){
    const e=entries.find(x=>x.path===member);if(!e||e.link)throw new AppError('INVALID_ARTIFACT','Missing or linked ASAR member',{member});
    if(!Number.isSafeInteger(e.size)||e.size<0||e.size>24*1024*1024)throw new AppError('SOURCE_LIMIT','Source member exceeds 24 MiB',{member});
    if(e.unpacked){const root=await realpath(path+'.unpacked'),p=await realpath(resolve(root,member));if(!p.startsWith(root+'/'))throw new AppError('INVALID_ARTIFACT','Unpacked member escapes its companion root');return readFile(p);}
    const offset=Number(e.offset);if(!Number.isSafeInteger(offset)||offset<0||dataOffset+offset+e.size>bytes.length)throw new AppError('INVALID_ARTIFACT','ASAR member range is invalid');
    return bytes.subarray(dataOffset+offset,dataOffset+offset+e.size);
  }
  return {path,sha256:hash(bytes),entries,read};
}
export async function identifyElectron(target){
  const path=await realpath(resolve(target));
  if(!path.endsWith('.app'))throw new AppError('UNSUPPORTED_PLATFORM','This first desktop driver accepts a macOS Electron .app bundle');
  let asar=resolve(path,'Contents/Resources/app.asar'),pkg,packageRoot=null,main;
  try{await stat(asar);}catch(error){
    if(error.code!=='ENOENT')throw error;
    try{packageRoot=await realpath(resolve(path,'Contents/Resources/app'));if(!packageRoot.startsWith(path+'/'))throw new AppError('INVALID_ARTIFACT','Resource package resolves outside its bundle');const manifest=await realpath(resolve(packageRoot,'package.json'));if(!manifest.startsWith(path+'/'))throw new AppError('INVALID_ARTIFACT','Resource manifest resolves outside its bundle');pkg=JSON.parse(await readFile(manifest,'utf8'));}
    catch(e){if(e.code==='ENOENT')throw new AppError('UNSUPPORTED_ARTIFACT_LAYOUT','No standard ASAR or resource package manifest was found');throw e;}
    const match=/^(.+?\.asar)\/(.+)$/.exec(String(pkg.main||'').replace(/^\.\//,''));
    if(!match||match[1].split('/').some(p=>!p||p==='..')||match[2].split('/').some(p=>!p||p==='..'))throw new AppError('INVALID_ARTIFACT','Resource package main must identify an in-bundle ASAR member');
    asar=resolve(packageRoot,match[1]);main=match[2];
  }
  asar=await realpath(asar);if(!asar.startsWith(path+'/'))throw new AppError('INVALID_ARTIFACT','Application archive resolves outside its bundle');
  const artifact=await readAsar(asar);pkg||=JSON.parse(await artifact.read('package.json'));main||=String(pkg.main||'index.js').replace(/^\.\//,'');
  const member=[main,main+'.js',main+'/index.js'].map(name=>artifact.entries.find(e=>e.path===name&&!e.link)).find(Boolean);
  if(member)main=member.path;
  const bytes=member?await artifact.read(main):null;
  const entrypoint={path:main,available:!!bytes,readable:!!bytes&&isSourceText(bytes),...(bytes?{bytes:bytes.length,sha256:hash(bytes)}:{})};
  const asarRelativePath=relative(path,asar),blockers=[];
  if(asarRelativePath!=='Contents/Resources/app.asar')blockers.push('nonstandard-resource-layout');
  if(!entrypoint.readable)blockers.push(entrypoint.available?'nontext-entrypoint':'missing-entrypoint');
  return {path,asar,asarRelativePath,artifact,packageRoot,name:pkg.productName||pkg.name,version:pkg.version,main:pkg.main,package:pkg,entrypoint,execution:{supported:blockers.length===0,blockers}};
}
export function isSourceText(bytes){
  // Minified JavaScript may contain literal control characters in strings or
  // regular expressions. Decoding is a byte gate; REA still checks its syntax.
  try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);return true;}catch{return false;}
}
export async function electronFrameworkBinary(target){
  const root=await realpath(resolve(target)),frameworks=resolve(root,'Contents/Frameworks');
  const names=(await readdir(frameworks)).filter(n=>n.endsWith('.framework')).sort((a,b)=>Number(b==='Electron Framework.framework')-Number(a==='Electron Framework.framework'));
  for(const name of names){
    const candidate=resolve(frameworks,name,name.slice(0,-10));
    let file;try{file=await realpath(candidate);}catch(e){if(e.code==='ENOENT')continue;throw e;}
    if(!file.startsWith(root+'/'))throw new AppError('INVALID_ARTIFACT','Framework binary resolves outside the application');
    if((await stat(file)).isFile())return file;
  }
  throw new AppError('UNSUPPORTED_ARTIFACT_LAYOUT','No in-bundle framework executable was identified');
}
export async function exportApplicationSources(artifact,out,{limit=24,maxBytes=24*1024*1024}={}){
  await mkdir(out,{recursive:true});const sources=[],excluded=[];let total=0;
  const candidates=artifact.entries.filter(e=>/\.(c?js|mjs|json|html)$/.test(e.path)&&!e.path.startsWith('node_modules/')&&!e.link&&e.size<=maxBytes).sort((a,b)=>Number(/(?:main|preload|package\.json|(?:^|\/)index(?:[-.]|$)|\.html$)/i.test(b.path))-Number(/(?:main|preload|package\.json|(?:^|\/)index(?:[-.]|$)|\.html$)/i.test(a.path)));
  for(const e of candidates){if(sources.length>=limit||total+e.size>maxBytes)continue;const bytes=await artifact.read(e.path);if(!isSourceText(bytes)){excluded.push({path:e.path,reason:'Member is not UTF-8 source text',sha256:hash(bytes)});continue;}const dest=resolve(out,e.path);if(!dest.startsWith(resolve(out)+'/'))throw new AppError('INVALID_ARTIFACT','Source escapes output');await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes,{mode:0o600});sources.push({path:e.path,bytes:bytes.length,sha256:hash(bytes)});total+=bytes.length;}
  const index={producer:'app2cli literal ASAR member extraction, not REA analysis',artifactSha256:artifact.sha256,sources,excluded,omitted:candidates.length-sources.length,scope:'Selected UTF-8 non-dependency JS/HTML/manifests; nontext resources excluded; not complete application coverage'};await writeJson(join(out,'source-index.json'),index);return index;
}
