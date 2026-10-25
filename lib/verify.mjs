import { resolve,dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readJson,AppError } from './sdk.mjs';
import { loadAdapter } from './manifest.mjs';
import {validateApplicationPlan,testApplication} from './application-test.mjs';
import { validatePlan,testGenerated } from './generation-test.mjs';

export async function verifyGeneration(directory,flags){
  if(!directory||typeof flags.out!=='string')throw new AppError('INVALID_INPUT','verify <generation-dir> --out <new-report-dir>');
  const root=resolve(directory),result=await readJson(resolve(root,'result.json'));
  if(result.status!=='passed')throw new AppError('GENERATION_UNVERIFIED','No completed generation found');
  const session=await readJson(resolve(root,'session.json')),packageDir=resolve(root,'package');
  const plan=await readJson(resolve(root,'attempt-'+result.rounds,'test-plan.json'));
  const adapter=await loadAdapter(resolve(packageDir,'adapters',result.app));
  if(adapter.digest!==result.adapterDigest)throw new AppError('ADAPTER_CHANGED','Generated adapter differs from the recorded result');
  if(plan.semantics==='application-journey')validateApplicationPlan(plan,adapter.manifest);else validatePlan(plan,adapter.manifest);
  const out=resolve(flags.out);await mkdir(dirname(out),{recursive:true});
  try{await mkdir(out,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new AppError('OUTPUT_EXISTS','Choose a new report directory');throw error;}
  const report=plan.semantics==='application-journey'?await testApplication(packageDir,plan,session,out,{marker:result.marker}):await testGenerated(packageDir,plan,session,out);
  if(report.status!=='passed')throw new AppError('VERIFICATION_FAILED','Generated CLI did not pass again',{report:resolve(out,'test-report.json'),error:report.error},5);
  return {ok:true,app:result.app,adapterDigest:adapter.digest,checks:report.checks.length,report:resolve(out,'test-report.json')};
}
