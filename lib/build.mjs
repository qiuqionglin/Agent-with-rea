import { resolve,dirname,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp,mkdir,readFile,writeFile,chmod } from 'node:fs/promises';
import { loadAdapter } from './manifest.mjs';
import { hash,readJson,writeJson,AppError } from './sdk.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function build(directory,flags){
  if(typeof flags.out!=='string'||typeof flags.evidence!=='string')throw new AppError('INVALID_INPUT','--out and --evidence are required');
  const adapter=await loadAdapter(directory),indexPath=resolve(flags.evidence,'evidence.json'),index=await readJson(indexPath);
  if(adapter.manifest.config.draft)throw new AppError('MAPPING_REQUIRED','Complete the draft semantic mapping before building');
  if(index.platform!==adapter.manifest.platform)throw new AppError('EVIDENCE_MISMATCH','Platform mismatch');
  const records=[];
  for(const record of index.records){
    const path=resolve(dirname(indexPath),record.file);if(!path.startsWith(dirname(indexPath)+'/'))throw new AppError('EVIDENCE_MISMATCH','Evidence path must be contained');
    const bytes=await readFile(path);if(hash(bytes)!==record.sha256)throw new AppError('EVIDENCE_MISMATCH','REA output hash mismatch');
    const raw=JSON.parse(bytes);if(raw.error||raw.operation!==record.operation)throw new AppError('EVIDENCE_MISMATCH','Unsuccessful or inconsistent REA output');
    records.push({...record,raw,text:bytes.toString('utf8')});
  }
  for(const claim of adapter.manifest.analysis.claims){
    const found=records.find(r=>r.operation===claim.operation&&(!claim.contains||r.text.includes(claim.contains))&&(!claim.sha256||r.text.includes(claim.sha256)));
    if(!found)throw new AppError('EVIDENCE_MISMATCH','A recipe claim is absent from REA output',{claim});
  }
  const out=resolve(flags.out);await mkdir(dirname(out),{recursive:true});
  try{await mkdir(out);}catch(e){if(e.code==='EEXIST')throw new AppError('OUTPUT_EXISTS','Choose a new output directory; builds do not overwrite');throw e;}
  await cp(resolve(root,'lib'),resolve(out,'lib'),{recursive:true});await cp(resolve(root,'schemas'),resolve(out,'schemas'),{recursive:true});
  const dest=resolve(out,'adapters',adapter.manifest.id);await mkdir(dest,{recursive:true});
  for(const file of ['adapter.json','adapter.mjs'])await cp(resolve(adapter.directory,file),resolve(dest,file));
  const launcher=`#!/usr/bin/env node\nimport {main,runAppCli} from './lib/app-cli.mjs';\nawait main(()=>runAppCli(new URL('./adapters/${adapter.manifest.id}/',import.meta.url),process.argv.slice(2),'${adapter.digest}'));\n`;
  await writeFile(resolve(out,'cli.mjs'),launcher);await chmod(resolve(out,'cli.mjs'),0o755);
  const core=await readJson(resolve(root,'package.json'));
  await writeJson(resolve(out,'package.json'),{name:`agent-with-rea-${adapter.manifest.id}`,version:'0.1.0',type:'module',license:'MIT',engines:core.engines,bin:{[adapter.manifest.id+'-cli']:'cli.mjs'},files:['cli.mjs','lib','schemas','adapters','provenance.json','LICENSE'],dependencies:core.dependencies});
  await cp(resolve(root,'LICENSE'),resolve(out,'LICENSE'));
  await writeJson(resolve(out,'provenance.json'),{schemaVersion:1,producer:'app2cli build; semantic mapping is agent-authored',adapterDigest:adapter.digest,evidence:records.map(({operation,evidenceId,sha256})=>({operation,evidenceId,sha256})),validatedClaims:adapter.manifest.analysis.claims,runtimeVerified:false});
  return {ok:true,app:adapter.manifest.id,output:out,executable:adapter.manifest.id+'-cli',adapterDigest:adapter.digest,runtimeVerified:false};
}
