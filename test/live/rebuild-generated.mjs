// Rebuild an accepted adapter with this checkout's runtime, then repeat its
// original independent scenario. No model call or adapter modification.
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {build} from '../../src/generator/build.mjs';
import {loadAdapter} from '../../src/runtime/manifest.mjs';
import {testApplication,validateApplicationPlan} from '../../src/verify/application.mjs';
import {testGenerated,validatePlan} from '../../src/verify/resource.mjs';
import {main} from '../../src/runtime/cli.mjs';
import {AppError,readJson} from '../../src/utils.mjs';

await main(async()=>{
  const [directory,output]=process.argv.slice(2);
  if(!directory||!output)throw new AppError('INVALID_INPUT','Usage: node test/live/rebuild-generated.mjs <passed-run> <new-output>');
  const run=resolve(directory),out=resolve(output),result=await readJson(resolve(run,'result.json'));
  if(result.status!=='passed')throw new AppError('GENERATION_UNVERIFIED','Use an accepted generation');
  const source=resolve(run,'package/adapters',result.app),adapter=await loadAdapter(source);
  if(adapter.digest!==result.adapterDigest)throw new AppError('ADAPTER_CHANGED','Original accepted adapter digest changed');
  const plan=await readJson(resolve(run,'attempt-'+result.rounds,'test-plan.json')),session=await readJson(resolve(run,'session.json'));
  const application=plan.semantics==='application-journey';
  (application?validateApplicationPlan:validatePlan)(plan,adapter.manifest);
  await mkdir(out);const pkg=resolve(out,'package');
  await build(source,{evidence:resolve(run,'evidence'),out:pkg});
  const report=application?await testApplication(pkg,plan,session,out,{marker:result.marker}):await testGenerated(pkg,plan,session,out);
  if(report.status!=='passed')throw new AppError('VERIFICATION_FAILED','Rebuilt CLI did not pass its independent scenario',{report:resolve(out,'test-report.json'),error:report.error,cleanupError:report.cleanupError},5);
  return {ok:true,app:result.app,adapterDigest:adapter.digest,checks:report.checks.length,report:resolve(out,'test-report.json')};
});
