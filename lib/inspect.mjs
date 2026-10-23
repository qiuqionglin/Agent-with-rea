import { resolve,relative } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { runRea } from './rea.mjs';
import { writeJson,AppError } from './sdk.mjs';
export async function inspect(platform,target,flags){
  if(typeof flags.out!=='string')throw new AppError('INVALID_INPUT','--out is required');
  const out=resolve(flags.out);await mkdir(out,{recursive:true,mode:0o700});const records=[];
  const run=async(args,name)=>{console.error('REA '+args[0]);const r=await runRea(args,resolve(out,name+'.json'));records.push({file:relative(out,r.file),sha256:r.sha256,operation:r.operation,evidenceId:r.raw.evidence_id});return r.raw;};
  if(platform==='web'){
    const targets=await run(['list-browser-targets',target],'targets');
    const pages=targets.normalized_result.targets;const page=flags.target?pages.find(p=>p.target_id===flags.target):pages.length===1?pages[0]:null;
    if(!page)throw new AppError('TARGET_REQUIRED','Select one exact browser target with --target',{targets:pages.map(p=>({id:p.target_id,url:p.url}))});
    await run(['inspect-web-page',target,page.target_id,'--include-script-sources'],'capture');
    const exported=await run(['export-web-scripts',resolve(out,'capture.json'),resolve(out,'sources')],'export');
    const files=exported.normalized_result.scripts.filter(s=>s.content.state==='exported'&&s.content.layout==='url-path'&&!s.url.includes('/node_modules/'));
    if(!files.length)throw new AppError('NO_SOURCES','No retained application scripts');
    await run(['analyze-javascript-application',exported.normalized_result.analysis_input.input_path,...files.flatMap(s=>['--source-path',s.content.relative_path])],'analysis');
  }else if(platform==='android'){
    await run(['inspect-android-package',resolve(target)],'package');
    if(flags.class){await run(['inspect-android-class',resolve(target),flags.class],'class');if(flags.method)await run(['inspect-android-method',resolve(target),flags.class,flags.method],'method');}
  }else throw new AppError('UNSUPPORTED_PLATFORM','Currently supported: web, android');
  await writeJson(resolve(out,'evidence.json'),{schemaVersion:1,producer:'app2cli index referencing original REA stdout',platform,records});
  return {ok:true,platform,evidence:resolve(out,'evidence.json'),records:records.length,next:'Write or refine the semantic adapter, then build it against this evidence. Analysis alone does not prove a capability works.'};
}
