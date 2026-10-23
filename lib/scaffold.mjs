import { resolve } from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import { readJson,writeJson,hash,AppError } from './sdk.mjs';
export async function scaffold(flags){
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(flags.id||'')||typeof flags.evidence!=='string'||typeof flags.out!=='string')throw new AppError('INVALID_INPUT','Provide --id, --evidence and --out');
  const index=await readJson(resolve(flags.evidence,'evidence.json'));const candidates=[];
  for(const record of index.records){
    const raw=await readJson(resolve(flags.evidence,record.file)),n=raw.normalized_result;
    if(n?.class_name)candidates.push({kind:'android-class',name:n.class_name,methods:n.methods?.map(m=>({name:m.name,signature:m.reported_signature}))||[],evidenceId:raw.evidence_id});
    for(const node of (n?.semantic_graph?.nodes||[]).slice(0,200))candidates.push({kind:node.kind,identity:node.identity,evidenceId:raw.evidence_id});
  }
  const out=resolve(flags.out);await mkdir(out);
  await writeJson(resolve(out,'adapter.json'),{schemaVersion:1,id:flags.id,description:'Draft mapping: complete and verify before building',platform:index.platform,verification:index.platform==='web'?'reload-persisted':'native-ui-readback',config:{draft:true},analysis:{recipe:'Agent must interpret REA findings and add exact source/version claims',claims:[{operation:index.records.at(-1).operation}]},commands:{state:{description:'Draft state reader; implementation required',readOnly:true,inputSchema:{type:'object',properties:{},additionalProperties:false}}}});
  await writeJson(resolve(out,'candidates.json'),{producer:'app2cli projection; candidates are not verified executable capabilities',candidates});
  await writeFile(resolve(out,'adapter.mjs'),`// Implement this trusted local adapter using docs/adapter-contract.md.\nconst missing=()=>{throw Object.assign(new Error('Semantic mapping is required'),{code:'MAPPING_REQUIRED'});};\nexport default {targetKey:missing,connect:missing,check:missing,read:missing,plan:missing,dispatch:missing,matches:missing,refresh:missing,result:missing,close:async()=>{}};\n`);
  return {ok:true,draft:true,output:out,candidates:candidates.length,next:'Implement the native adapter, define real postconditions, remove config.draft, and build against the same evidence. The compiler rejects drafts.'};
}
