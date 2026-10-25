import Ajv from 'ajv';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readJson,canonical,hash,AppError } from '../sdk.mjs';
const schema=await readJson(fileURLToPath(new URL('../../schemas/adapter.schema.json',import.meta.url)));
const ajv=new Ajv({allErrors:true,strict:true});const validate=ajv.compile(schema);
export async function loadAdapter(directory){
  directory=resolve(directory);const manifest=await readJson(resolve(directory,'adapter.json'));
  if(!validate(manifest))throw new AppError('INVALID_ADAPTER','Adapter manifest is invalid',validate.errors);
  if(manifest.platform==='api'&&manifest.transport!=='http')throw new AppError('INVALID_ADAPTER','API platform requires an explicit HTTP transport');
  for(const command of Object.values(manifest.commands)){
    ajv.compile(command.inputSchema);
    if(command.transport&&command.transport!==manifest.transport)throw new AppError('INVALID_ADAPTER','Command transport must match the adapter transport');
  }
  const ids=new Set();
  for(const capability of manifest.capabilities||[]){
    if(ids.has(capability.id)||capability.commands.some(name=>!manifest.commands[name]))throw new AppError('INVALID_ADAPTER','Capability IDs must be unique and refer to declared commands');
    ids.add(capability.id);
    if(capability.status==='implemented-unverified'&&!capability.commands.length)throw new AppError('INVALID_ADAPTER','Implemented capabilities need a callable command');
  }
  const source=await readFile(resolve(directory,'adapter.mjs'));
  return {directory,manifest,digest:hash(canonical(manifest)+'\n'+source.toString('utf8')),source};
}
export function validateInput(command,input){
  const v=ajv.compile(command.inputSchema);if(!v(input))throw new AppError('INVALID_INPUT','Command input is invalid',v.errors);
}
