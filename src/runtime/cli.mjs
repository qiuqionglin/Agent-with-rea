import { fileURLToPath } from 'node:url';
import { loadAdapter } from './manifest.mjs';
import { parseArgs,commandInput } from './arguments.mjs';
import { execute } from './execute.mjs';
import { AppError } from '../sdk.mjs';
import { readJson } from '../sdk.mjs';
import { resolve } from 'node:path';
export async function runAppCli(adapterDirectory,argv=process.argv.slice(2),expectedDigest){
  const adapter=await loadAdapter(adapterDirectory instanceof URL?fileURLToPath(adapterDirectory):adapterDirectory);
  if(expectedDigest&&adapter.digest!==expectedDigest)throw new AppError('ADAPTER_CHANGED','Generated adapter changed after compilation; rebuild against evidence',{},4);
  const {positional,flags}=parseArgs(argv);const name=positional.join('.');
  if(flags.capabilities){
    let acceptance;try{acceptance=await readJson(resolve(adapter.directory,'../../acceptance.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(acceptance&&acceptance.adapterDigest!==adapter.digest)throw new AppError('ADAPTER_CHANGED','Acceptance record does not match the adapter');
    return {ok:true,app:adapter.manifest.id,adapterDigest:adapter.digest,capabilities:adapter.manifest.capabilities||[],acceptance:acceptance||null,scope:'Capabilities are declared by the author. Only the concrete scenarios in acceptance were exercised; command availability does not prove every input or every app feature.'};
  }
  if(!name||flags.help||flags.schema){
    const contract=name?adapter.manifest.commands[name]:null;
    if(name&&!contract)throw new AppError('UNKNOWN_COMMAND','No such command',{command:name});
    return {ok:true,app:adapter.manifest.id,platform:adapter.manifest.platform,transport:adapter.manifest.transport||(adapter.manifest.platform==='android'?'native-ui':'browser-function'),fallbackReason:adapter.manifest.fallbackReason,description:adapter.manifest.description,
      ...(name?{command:name,...contract}:{commands:adapter.manifest.commands}),
      commonOptions:{'--input':'JSON object, alternative to named flags','--request-id':'Reuse exactly for mutation retries','--expected-revision':'Reject changed state','--dry-run':'Read and plan; do not dispatch','--schema':'Show machine-readable contract'},
      verification:adapter.manifest.verification,adapterDigest:adapter.digest};
  }
  const contract=adapter.manifest.commands[name];if(!contract)throw new AppError('UNKNOWN_COMMAND','No such command',{command:name});
  return execute(adapter,name,commandInput(contract,flags),{requestId:flags['request-id'],expectedRevision:flags['expected-revision'],dryRun:!!flags['dry-run']});
}
export async function main(fn){
  try{console.log(JSON.stringify(await fn()));}
  catch(error){console.log(JSON.stringify({ok:false,error:{code:error.code||'INTERNAL_ERROR',message:error.message,details:error.details||{}}}));process.exitCode=error.exitCode||1;}
}
