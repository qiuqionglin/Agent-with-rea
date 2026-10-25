import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp,mkdir,readFile,writeFile,chmod } from 'node:fs/promises';
import { loadAdapter } from '../runtime/manifest.mjs';
import { hash,readJson,writeJson,AppError } from '../sdk.mjs';
import { reaEvidence } from './rea.mjs';
import {runtimeBundle} from './bundle.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function build(directory,flags){
  if(typeof flags.out!=='string'||typeof flags.evidence!=='string')throw new AppError('INVALID_INPUT','--out and --evidence are required');
  const adapter=await loadAdapter(directory),indexPath=resolve(flags.evidence,'evidence.json'),index=await readJson(indexPath);
  if(adapter.manifest.config.draft)throw new AppError('MAPPING_REQUIRED','Complete the draft semantic mapping before building');
  if(index.platform!==adapter.manifest.platform)throw new AppError('EVIDENCE_MISMATCH','Platform mismatch');
  const records=[];
  for(const record of index.records){
    const path=resolve(dirname(indexPath),record.file);if(!path.startsWith(dirname(indexPath)+'/'))throw new AppError('EVIDENCE_MISMATCH','Evidence path must be contained');
    const bytes=await readFile(path);if(hash(bytes)!==record.sha256)throw new AppError('EVIDENCE_MISMATCH','REA output hash mismatch');
    const raw=reaEvidence(JSON.parse(bytes));if(raw.error||raw.operation!==record.operation)throw new AppError('EVIDENCE_MISMATCH','Unsuccessful or inconsistent REA output');
    records.push({...record,raw,text:bytes.toString('utf8')});
  }
  for(const claim of adapter.manifest.analysis.claims){
    const found=records.find(r=>r.operation===claim.operation&&(!claim.contains||r.text.includes(claim.contains))&&(!claim.sha256||r.text.includes(claim.sha256)));
    if(!found)throw new AppError('EVIDENCE_MISMATCH','A recipe claim is absent from REA output',{claim,expectedShape:{operation:'exact operation from evidence.json, e.g. analyze_javascript_application',contains:'optional literal substring in that output',sha256:'optional source digest occurring in that output'},operations:records.map(r=>r.operation)});
  }
  const bundle=await runtimeBundle(adapter);
  const out=resolve(flags.out);await mkdir(dirname(out),{recursive:true});
  try{await mkdir(out);}catch(e){if(e.code==='EEXIST')throw new AppError('OUTPUT_EXISTS','Choose a new output directory; builds do not overwrite');throw e;}
  for(const file of bundle.files){await mkdir(dirname(resolve(out,file)),{recursive:true});await cp(resolve(root,file),resolve(out,file));}
  const dest=resolve(out,'adapters',adapter.manifest.id);await mkdir(dest,{recursive:true});
  for(const file of ['adapter.json','adapter.mjs'])await cp(resolve(adapter.directory,file),resolve(dest,file));
  const launcher=`#!/usr/bin/env node\nimport {main,runAppCli} from './src/runtime/cli.mjs';\nawait main(()=>runAppCli(new URL('./adapters/${adapter.manifest.id}/',import.meta.url),process.argv.slice(2),'${adapter.digest}'));\n`;
  await writeFile(resolve(out,'cli.mjs'),launcher);await chmod(resolve(out,'cli.mjs'),0o755);
  const core=await readJson(resolve(root,'package.json'));
  await writeJson(resolve(out,'package.json'),{name:`agent-with-rea-${adapter.manifest.id}`,version:'0.1.0',type:'module',license:'MIT',engines:core.engines,bin:{[adapter.manifest.id+'-cli']:'cli.mjs'},files:['cli.mjs','src','lib','schemas','adapters','provenance.json','acceptance.json','LICENSE'],imports:bundle.imports,dependencies:bundle.dependencies});
  await cp(resolve(root,'LICENSE'),resolve(out,'LICENSE'));
  await writeJson(resolve(out,'provenance.json'),{schemaVersion:1,producer:'app2cli build; semantic mapping is agent-authored',adapterDigest:adapter.digest,evidence:records.map(({operation,evidenceId,sha256})=>({operation,evidenceId,sha256})),validatedClaims:adapter.manifest.analysis.claims,runtimeFiles:bundle.files,runtimeVerified:false});
  return {ok:true,app:adapter.manifest.id,output:out,executable:adapter.manifest.id+'-cli',adapterDigest:adapter.digest,runtimeVerified:false};
}

export async function scaffold(flags){
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(flags.id||'')||typeof flags.evidence!=='string'||typeof flags.out!=='string')throw new AppError('INVALID_INPUT','Provide --id, --evidence and --out');
  const index=await readJson(resolve(flags.evidence,'evidence.json'));const candidates=[];
  for(const record of index.records){
    const raw=reaEvidence(await readJson(resolve(flags.evidence,record.file))),n=raw.normalized_result;
    if(n?.class_name)candidates.push({kind:'android-class',name:n.class_name,methods:n.methods?.map(m=>({name:m.name,signature:m.reported_signature}))||[],evidenceId:raw.evidence_id});
    for(const node of (n?.semantic_graph?.nodes||[]).slice(0,200))candidates.push({kind:node.kind,identity:node.identity,evidenceId:raw.evidence_id});
  }
  const out=resolve(flags.out);await mkdir(out);
  await writeJson(resolve(out,'adapter.json'),{schemaVersion:1,id:flags.id,description:'Draft mapping: complete and verify before building',platform:index.platform,verification:index.platform==='web'?'reload-persisted':'native-ui-readback',config:{draft:true},analysis:{recipe:'Agent must interpret REA findings and add exact source/version claims',claims:[{operation:index.records.at(-1).operation}]},commands:{state:{description:'Draft state reader; implementation required',readOnly:true,inputSchema:{type:'object',properties:{},additionalProperties:false}}}});
  await writeJson(resolve(out,'candidates.json'),{producer:'app2cli projection; candidates are not verified executable capabilities',candidates});
  await writeFile(resolve(out,'adapter.mjs'),`// Implement this trusted local adapter using docs/adapter-contract.md.\nconst missing=()=>{throw Object.assign(new Error('Semantic mapping is required'),{code:'MAPPING_REQUIRED'});};\nexport default {targetKey:missing,connect:missing,check:missing,read:missing,plan:missing,dispatch:missing,matches:missing,refresh:missing,result:missing,close:async()=>{}};\n`);
  return {ok:true,draft:true,output:out,candidates:candidates.length,next:'Implement the native adapter, define real postconditions, remove config.draft, and build against the same evidence. The compiler rejects drafts.'};
}
