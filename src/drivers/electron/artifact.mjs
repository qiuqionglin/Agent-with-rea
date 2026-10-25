import {readFile,mkdir,writeFile,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
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
  const asar=resolve(path,'Contents/Resources/app.asar');await stat(asar);
  const artifact=await readAsar(asar),pkg=JSON.parse(await artifact.read('package.json'));
  return {path,asar,artifact,name:pkg.productName||pkg.name,version:pkg.version,main:pkg.main,package:pkg};
}
export async function exportApplicationSources(artifact,out,{limit=24,maxBytes=24*1024*1024}={}){
  await mkdir(out,{recursive:true});const sources=[];let total=0;
  const candidates=artifact.entries.filter(e=>/\.(c?js|mjs|json|html)$/.test(e.path)&&!e.path.startsWith('node_modules/')&&!e.link&&e.size<=maxBytes).sort((a,b)=>Number(/(?:main|preload|package\.json|(?:^|\/)index(?:[-.]|$)|\.html$)/i.test(b.path))-Number(/(?:main|preload|package\.json|(?:^|\/)index(?:[-.]|$)|\.html$)/i.test(a.path)));
  for(const e of candidates){if(sources.length>=limit||total+e.size>maxBytes)continue;const bytes=await artifact.read(e.path),dest=resolve(out,e.path);if(!dest.startsWith(resolve(out)+'/'))throw new AppError('INVALID_ARTIFACT','Source escapes output');await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes,{mode:0o600});sources.push({path:e.path,bytes:bytes.length,sha256:hash(bytes)});total+=bytes.length;}
  const index={producer:'app2cli literal ASAR member extraction, not REA analysis',artifactSha256:artifact.sha256,sources,omitted:candidates.length-sources.length,scope:'Selected non-dependency JS/HTML/manifests; not complete application coverage'};await writeJson(join(out,'source-index.json'),index);return index;
}
