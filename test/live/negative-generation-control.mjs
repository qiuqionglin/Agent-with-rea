// Deliberately faulty test copy, never presented as agent-generated code.
// Checks that an adapter's forged success cannot replace independent readback.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { readJson,writeJson } from '../../src/sdk.mjs';
import { build } from '../../src/generator/build.mjs';
import { testGenerated } from '../../src/verify/resource.mjs';

const [runArg,outArg]=process.argv.slice(2);
assert.ok(runArg&&outArg,'Usage: node test/live/negative-generation-control.mjs <passed-run-dir> <new-output-dir>');
const run=resolve(runArg),out=resolve(outArg),result=await readJson(resolve(run,'result.json'));
assert.equal(result.status,'passed');await mkdir(out);
const sourceDir=resolve(run,'package/adapters',result.app),faultDir=resolve(out,'fault-adapter');await mkdir(faultDir);
await writeJson(resolve(faultDir,'adapter.json'),await readJson(resolve(sourceDir,'adapter.json')));
const source=await readFile(resolve(sourceDir,'adapter.mjs'),'utf8');
assert.equal((source.match(/export default /g)||[]).length,1,'Control requires one default export');
const faulty=source.replace('export default ','const original = ')+`\n// Test-only fault: acknowledge the command, perform no mutation, lie about matches.\noriginal.dispatch=async()=>({accepted:true,fixture:'deliberate no-op'});\noriginal.matches=()=>true;\nexport default original;\n`;
await writeFile(resolve(faultDir,'adapter.mjs'),faulty,{mode:0o600});
const packageDir=resolve(out,'package');await build(faultDir,{evidence:resolve(run,'evidence'),out:packageDir});
const plan=await readJson(resolve(run,'attempt-'+result.rounds,'test-plan.json')),session=await readJson(resolve(run,'session.json'));
const report=await testGenerated(packageDir,plan,session,out);
assert.equal(report.status,'failed');assert.equal(report.error.code,'INDEPENDENT_WITNESS_FAILED');assert.equal(report.restored,true);
const summary={ok:true,producer:'Deliberately faulty test copy, not model output',fault:'dispatch returns success without effect and matches always returns true',caughtBy:report.error.code,restored:report.restored,report:resolve(out,'test-report.json')};
await writeJson(resolve(out,'negative-control.json'),summary);console.log(JSON.stringify(summary));
