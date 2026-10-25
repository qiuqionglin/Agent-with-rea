// Deliberate faulty copy, not model output. Leave generated adapter bytes intact.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {readJson,writeJson} from '../../src/sdk.mjs';
import {build} from '../../src/generator/build.mjs';
import {testApplication} from '../../src/verify/application.mjs';
const [runArg,outArg]=process.argv.slice(2);assert.ok(runArg&&outArg,'Usage: node test/live/negative-application-control.mjs <passed-run> <new-output>');
const run=resolve(runArg),out=resolve(outArg),result=await readJson(resolve(run,'result.json'));assert.equal(result.status,'passed');assert.equal(result.scenario,'application-journey');
const plan=await readJson(resolve(run,'attempt-'+result.rounds,'test-plan.json')),session=await readJson(resolve(run,'session.json'));
const mutations=plan.steps.filter(s=>!['read','navigation'].includes(s.effect)),target=mutations.find(s=>s.effect==='update')||mutations[0];assert.ok(target);
await mkdir(out);const adapterDir=resolve(out,'fault-adapter');await mkdir(adapterDir);
const sourceDir=resolve(run,'package/adapters',result.app),source=await readFile(resolve(sourceDir,'adapter.mjs'),'utf8');assert.equal((source.match(/export default /g)||[]).length,1);
await writeJson(resolve(adapterDir,'adapter.json'),await readJson(resolve(sourceDir,'adapter.json')));
const injected=source.replace('export default ','const original = ')+`\nlet injectedNoop=false;const realDispatch=original.dispatch,realMatches=original.matches;\noriginal.dispatch=async function(ctx,command,input,plan){const index=process.argv.indexOf('--request-id');injectedNoop=command===${JSON.stringify(target.command)}&&index>=0&&process.argv[index+1].startsWith('step-');if(injectedNoop)return {testOnly:'deliberate no-op acknowledgment'};return realDispatch.call(original,ctx,command,input,plan);};\noriginal.matches=function(plan,snapshot){return injectedNoop?true:realMatches.call(original,plan,snapshot);};\nexport default original;\n`;
await writeFile(resolve(adapterDir,'adapter.mjs'),injected,{mode:0o600});const packageDir=resolve(out,'package');await build(adapterDir,{evidence:resolve(run,'evidence'),out:packageDir});
const report=await testApplication(packageDir,plan,session,out,{marker:result.marker});assert.equal(report.status,'failed');assert.equal(report.error.code,'INDEPENDENT_WITNESS_FAILED');assert.equal(report.cleanupComplete,true);
const summary={ok:true,producer:'Deliberately faulty copy, never presented as generated code',faultCommand:target.command,fault:'Acknowledge an actual content mutation without performing it, and lie about matches',caughtBy:report.error.code,cleanupComplete:report.cleanupComplete};await writeJson(resolve(out,'negative-control.json'),summary);console.log(JSON.stringify(summary));
