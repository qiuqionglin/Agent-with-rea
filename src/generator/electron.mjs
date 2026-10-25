import {mkdir,readFile,readdir,realpath,writeFile,stat} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {identifyElectron,electronFrameworkBinary,exportApplicationSources,isSourceText} from '../drivers/electron/artifact.mjs';
import {runRea} from './rea.mjs';
import {AppError,hash,writeJson} from '../sdk.mjs';

// Inspection never launches, logs in to or enables debugging on an application.
export async function inspectElectron(target,flags){
  const identity=await identifyElectron(target),out=resolve(flags.out);
  await mkdir(dirname(out),{recursive:true});
  try{await mkdir(out,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw new AppError('OUTPUT_EXISTS','Use a new Electron inspection directory');throw e;}
  const index={schemaVersion:1,platform:'electron',producer:'app2cli static inspection index referencing unchanged REA output',records:[],limitations:[]};
  const record=async(args,name)=>{
    const r=await runRea(args,resolve(out,name+'.json'));
    index.records.push({file:name+'.json',sha256:r.sha256,operation:r.operation,evidenceId:r.raw.evidence_id});
    await writeJson(resolve(out,'evidence.json'),index);return r;
  };
  let fuses;
  try{const binary=await electronFrameworkBinary(identity.path);const r=await record(['inspect-electron-fuses',binary],'fuses');fuses=r.raw.normalized_result;}
  catch(e){index.limitations.push({stage:'fuses',code:e.code||'INSPECTION_FAILED',reason:'Framework fuse inspection was unavailable; no fuse-state claim is made'});}
  const sourcesRoot=resolve(out,'sources');let sourceIndex;
  if(identity.packageRoot){
    // Native launchers can keep small plaintext bootstrap files beside an ASAR.
    // Select those literal files, never reinterpret a nontext ASAR as JavaScript.
    const parent=dirname(identity.entrypoint.path),directory=resolve(identity.packageRoot,parent);
    if(!directory.startsWith(identity.packageRoot+'/')&&directory!==identity.packageRoot)throw new AppError('INVALID_ARTIFACT','Bootstrap directory escapes its resource package');
    let siblings=[];try{siblings=await readdir(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
    const candidates=['package.json',...siblings.filter(n=>/\.(c?js|mjs)$/.test(n)).sort().slice(0,8).map(n=>relative(identity.packageRoot,resolve(directory,n)))];
    const sources=[],excluded=[];let total=0;
    for(const path of candidates){
      const file=await realpath(resolve(identity.packageRoot,path));if(!file.startsWith(identity.path+'/'))throw new AppError('INVALID_ARTIFACT','Bootstrap file resolves outside the application');
      const metadata=await stat(file);if(!metadata.isFile()||metadata.size>2*1024*1024||total+metadata.size>4*1024*1024){excluded.push({path,reason:'Bounded bootstrap source limit'});continue;}
      const bytes=await readFile(file);
      if(!isSourceText(bytes)){excluded.push({path,reason:'Not UTF-8 source text'});continue;}
      const dest=resolve(sourcesRoot,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes,{mode:0o600});sources.push({path,bytes:bytes.length,sha256:hash(bytes)});total+=bytes.length;
    }
    sourceIndex={producer:'app2cli literal external bootstrap acquisition; not REA output',artifactSha256:identity.artifact.sha256,sources,excluded,scope:'Package metadata and at most eight nearby bootstrap modules; protected ASAR contents are not decoded'};
  }else sourceIndex=await exportApplicationSources(identity.artifact,sourcesRoot,{limit:8,maxBytes:4*1024*1024});
  await writeJson(resolve(out,'source-index.json'),sourceIndex);
  let analysis;
  const selected=sourceIndex.sources.filter(s=>/\.(c?js|mjs)$/.test(s.path)).slice(0,4).map(s=>s.path);
  if(selected.length){const r=await record(['analyze-javascript-application',sourcesRoot,...selected.flatMap(p=>['--source-path',p]),'--max-semantic-nodes','1200','--max-semantic-nodes-per-file','600','--analysis-timeout-ms','60000','--max-heap-mb','512'],'source-analysis');analysis=r.raw.normalized_result;}
  else index.limitations.push({stage:'sources',reason:'No bounded plaintext JavaScript source selected; no business API mapping was established'});
  const report={producer:'Static application inspection summary; not runtime or generation acceptance',name:identity.name,version:identity.version,archive:identity.asarRelativePath,artifactSha256:identity.artifact.sha256,entrypoint:identity.entrypoint,execution:identity.execution,sourceFiles:selected,analysis:analysis?{summary:analysis.summary,statistics:analysis.statistics}:null,fusesInspected:!!fuses,verifiedBusinessApis:0,cliGenerated:false,runtimeTested:false};
  await writeJson(resolve(out,'inspection.json'),report);await writeJson(resolve(out,'evidence.json'),index);
  return {ok:true,platform:'electron',name:identity.name,version:identity.version,packagingSupported:identity.execution.supported,blockers:identity.execution.blockers,verifiedBusinessApis:0,cliGenerated:false,runtimeTested:false,report:resolve(out,'inspection.json')};
}
