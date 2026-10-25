import {resolve,relative} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {hash,writeJson,AppError} from '../utils.mjs';
import {selectedPage} from '../drivers/web/session.mjs';
import {safeUrl} from '../drivers/web/observe.mjs';
import {runRea} from './rea.mjs';
export function projectWebCapture(capture){
  const projected=structuredClone(capture),excluded=[];
  for(const script of projected.scripts.items){
    const artifact=script.source?.artifact;if(!artifact)continue;
    const bytes=Buffer.byteLength(artifact.text,'utf8'),sha256=hash(artifact.text);
    if(bytes!==artifact.bytes||sha256!==artifact.sha256){
      excluded.push({url:script.url,reason:'Retained source bytes do not match REA artifact digest',reportedSha256:artifact.sha256,observedSha256:sha256,reportedBytes:artifact.bytes,observedBytes:bytes});
      script.source={included:false,reason:'app2cli quarantined a source whose retained bytes fail its reported hash/length'};
    }
  }
  if(excluded.length)projected.limitations.push('app2cli projection excluded '+excluded.length+' inconsistent script sources; original REA stdout remains unchanged.');
  return {projected,excluded};
}
export async function inspect(platform,target,flags){
  if(typeof flags.out!=='string')throw new AppError('INVALID_INPUT','--out is required');
  const out=resolve(flags.out);await mkdir(out,{recursive:true,mode:0o700});const records=[],derivations=[];
  const run=async(args,name)=>{console.error('REA '+args[0]);const r=await runRea(args,resolve(out,name+'.json'));records.push({file:relative(out,r.file),sha256:r.sha256,operation:r.operation,evidenceId:r.raw.evidence_id});return r.raw;};
  if(platform==='web'){
    const targets=await run(['list-browser-targets',target],'targets');
    const pages=targets.normalized_result.targets;const page=flags.target?pages.find(p=>p.target_id===flags.target):pages.length===1?pages[0]:null;
    if(!page)throw new AppError('TARGET_REQUIRED','Select one exact browser target with --target',{targets:pages.map(p=>({id:p.target_id,url:p.url}))});
    const capture=await run(['inspect-web-page',target,page.target_id,'--include-script-sources'],'capture');
    // REA accepts a typed native capture as well as an authenticated Evidence
    // document. Use that documented input form without rewriting Evidence IDs.
    // Some 6.7.0 browser records fail their own semantic-ID round trip. Raw
    // stdout stays untouched; this extraction is labeled and hash-linked.
    const projected=resolve(out,'capture.normalized.json'),projection=projectWebCapture(capture.normalized_result);await writeJson(projected,projection.projected);
    derivations.push({file:'capture.normalized.json',producer:'app2cli normalized_result projection with inconsistent artifacts quarantined; not a new REA Evidence record',source:'capture.json',sourceSha256:records.at(-1).sha256,sha256:hash(await readFile(projected)),sourceEvidenceIdAuthenticated:false,excluded:projection.excluded});
    await writeJson(resolve(out,'capture-projection.json'),derivations.at(-1));
    const exported=await run(['export-web-scripts',projected,resolve(out,'sources')],'export');
    const files=exported.normalized_result.scripts.filter(s=>{
      try{return s.content.state==='exported'&&s.url&&new URL(s.url).origin===new URL(page.url).origin&&!s.url.includes('/node_modules/');}catch{return false;}
    });
    if(!files.length)throw new AppError('NO_SOURCES','No retained application scripts');
    // Analyze a bounded application slice; retain every exported source for
    // the agent. Avoid spending the entire budget on framework/vendor bundles.
    const sorted=files.sort((a,b)=>Number(/(?:app\/|page-|main\.js|app\.js)/.test(b.url))-Number(/(?:app\/|page-|main\.js|app\.js)/.test(a.url)));
    const selected=[];let bytes=0;
    for(const file of sorted){const size=(await readFile(resolve(exported.normalized_result.analysis_input.input_path,file.content.relative_path))).length;if(selected.length<3&&bytes+size<=160000){selected.push(file);bytes+=size;}}
    if(!selected.length)throw new AppError('ANALYSIS_LIMIT','All retained scripts exceed the bounded static-analysis slice; select a smaller source in a manual inspect workflow',{},3);
    await writeJson(resolve(out,'analysis-scope.json'),{producer:'app2cli analysis selection; not whole-app coverage',available:files.length,selected:selected.map(s=>s.content.relative_path),reason:'Bounded application slice, all exports retained for agent inspection'});
    await run(['analyze-javascript-application',exported.normalized_result.analysis_input.input_path,...selected.flatMap(s=>['--source-path',s.content.relative_path]),'--max-semantic-nodes','2000','--max-semantic-nodes-per-file','1000','--max-semantic-unknowns','2000','--analysis-timeout-ms','60000','--max-heap-mb','768'],'analysis');
  }else if(platform==='android'){
    await run(['inspect-android-package',resolve(target)],'package');
    if(flags.class){await run(['inspect-android-class',resolve(target),flags.class],'class');if(flags.method)await run(['inspect-android-method',resolve(target),flags.class,flags.method],'method');}
  }else throw new AppError('UNSUPPORTED_PLATFORM','Currently supported: web, android');
  await writeJson(resolve(out,'evidence.json'),{schemaVersion:1,producer:'app2cli index referencing original REA stdout',platform,records,derivations});
  return {ok:true,platform,evidence:resolve(out,'evidence.json'),records:records.length,next:'Write or refine the semantic adapter, then build it against this evidence. Analysis alone does not prove a capability works.'};
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
