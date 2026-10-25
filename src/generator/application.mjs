import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {prepareApplication} from './session.mjs';
import {selectedPage,workspacePath} from '../drivers/application.mjs';
import {identifyElectron,exportApplicationSources} from '../drivers/electron/artifact.mjs';
import {recordApplicationNetwork,observeApplication} from '../drivers/web/observe.mjs';
import {retainNetwork,discoverWebSources} from './discover.mjs';
import {runRea} from './rea.mjs';
import {codexAgent} from './agent.mjs';
import {applicationPrompt as prompt} from './prompts.mjs';
import {build} from './build.mjs';
import {loadAdapter} from '../runtime/manifest.mjs';
import {testApplication,validateApplicationPlan,resolveApplicationValue,observeApplicationWitness} from '../verify/application.mjs';
import {runProcess} from '../utils.mjs';
import {writeJson,readJson,hash,canonical,AppError,sleep} from '../sdk.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const outputSchema={type:'object',additionalProperties:false,required:['decision','reason','manifest','module','testPlan','probe'],properties:{decision:{type:'string',enum:['probe','candidate','blocked']},reason:{type:'string'},manifest:{type:'string'},module:{type:'string'},testPlan:{type:'string'},probe:{type:'string'}}};
async function reaRecord(args,evidence,index,name){const r=await runRea(args,resolve(evidence,name+'.json'));index.records.push({file:name+'.json',sha256:r.sha256,operation:r.operation,evidenceId:r.raw.evidence_id});await writeJson(resolve(evidence,'evidence.json'),index);return r;}
async function doProbe(p,session,out,evidence,index,round){
  if(!p||!['actions','evaluate','fixture','source'].includes(p.kind))throw new AppError('INVALID_PROBE','Unknown application probe');
  if(p.kind==='fixture'){
    if(!Array.isArray(p.files)||p.files.length>6)throw new AppError('INVALID_PROBE','Use at most six new input fixtures');
    const files=[];for(const file of p.files){const dest=workspacePath({workspace:session.environment.APP2CLI_WORKSPACE},file.path);if(!dest.startsWith(resolve(session.environment.APP2CLI_WORKSPACE)+'/')||typeof file.content!=='string'||file.content.length>100000)throw new AppError('INVALID_PROBE','Fixture must be a bounded owned workspace file');await mkdir(dirname(dest),{recursive:true});await writeFile(dest,file.content,{flag:'wx',mode:0o600});files.push({path:file.path,sha256:hash(file.content)});}return {producer:'Runner-created test INPUT, not application output',files};
  }
  if(p.kind==='source'){
    if(session.platform!=='electron'||!Array.isArray(p.paths)||p.paths.length<1||p.paths.length>4)throw new AppError('INVALID_PROBE','Select 1-4 Electron source members');
    const a=await identifyElectron(session.artifact.path);for(const path of p.paths){const dest=resolve(evidence,'sources',path);if(!dest.startsWith(resolve(evidence,'sources')+'/'))throw new AppError('INVALID_PROBE','Source path escapes output');const bytes=await a.artifact.read(path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes,{mode:0o600});}
    await reaRecord(['analyze-javascript-application',a.asar,'--integrity-policy','record-and-continue',...p.paths.flatMap(path=>['--source-path',path]),'--max-semantic-nodes','2000','--max-semantic-nodes-per-file','1000','--analysis-timeout-ms','60000'],evidence,index,'source-probe-'+round);return {paths:p.paths};
  }
  const {browser,page}=await selectedPage(session),entries=[];const stop=await recordApplicationNetwork(page,entries);let result;
  try{
    if(p.kind==='evaluate'){
      if(typeof p.expression!=='string'||p.expression.length>12000)throw new AppError('INVALID_PROBE','Bounded function expression required');result=await page.evaluate('('+p.expression+')()');if(result===undefined)result={value:null,note:'Probe returned undefined'};if(JSON.stringify(result)?.length>100000)throw new AppError('PROBE_LIMIT','Return a bounded runtime projection');
    }else{
      if(!Array.isArray(p.actions)||p.actions.length>12)throw new AppError('INVALID_PROBE','Use at most 12 observed actions');
      for(const a of p.actions){if(a.type==='click')await page.locator(a.selector).click({timeout:7000});else if(a.type==='fill')await page.locator(a.selector).fill(String(a.value),{timeout:7000});else if(a.type==='wait')await sleep(Math.min(Math.max(Number(a.ms)||500,0),3000));else if(a.type==='navigate'){const u=new URL(a.path,session.url);if(session.platform!=='web'||u.origin!==new URL(session.url).origin)throw new AppError('INVALID_PROBE','Navigation must stay on the supplied website');await page.goto(u.href,{waitUntil:'domcontentloaded'});}else throw new AppError('INVALID_PROBE','Unsupported discovery action');}
      await sleep(400);result={url:page.url(),actions:p.actions.length};
    }
  }finally{await stop();await browser.close();await retainNetwork(entries,evidence,index,'network-probe-'+round);}
  return result;
}
export async function generateApplication(target,flags,dependencies={}){
  if(!target)throw new AppError('INVALID_INPUT','generate <url|app> [--out <new-directory>]');
  if(/^https?:\/\//.test(target)){const u=new URL(target);if(u.username||u.password)throw new AppError('INVALID_INPUT','Do not embed credentials in the target URL');}
  if(flags.resume&&typeof flags.out!=='string')throw new AppError('INVALID_INPUT','Resume needs the existing --out directory');
  if(flags.out===undefined)flags={...flags,out:resolve('.local/generate','application-'+Date.now()+'-'+randomUUID().slice(0,8))};
  if(typeof flags.out!=='string')throw new AppError('INVALID_INPUT','--out must be a directory path');
  const out=resolve(flags.out),evidence=resolve(out,'evidence'),id=flags.id||(/^https?:/.test(target)?new URL(target).hostname.replace(/^www\./,''):basename(target,'.app')).toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,49);
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(id))throw new AppError('INVALID_INPUT','Supply a valid app ID');
  const rounds=Number(flags['max-rounds']||12);if(!Number.isInteger(rounds)||rounds<1||rounds>24)throw new AppError('INVALID_INPUT','Use 1-24 rounds');
  let previous;
  if(flags.resume){
    previous=await readJson(resolve(out,'generation.json'));
    if(!['failed','prepared'].includes(previous.status)||previous.target!==target||previous.id!==id)throw new AppError('RESUME_REJECTED','Resume requires a matching stopped run without cleanup uncertainty');
  }else{
    try{await mkdir(out,{recursive:false,mode:0o700});}catch(e){if(e.code==='EEXIST')throw new AppError('OUTPUT_EXISTS','Choose a new run directory');if(e.code==='ENOENT'){await mkdir(dirname(out),{recursive:true});await mkdir(out,{mode:0o700});}else throw e;}
  }
  const marker=previous?.marker||'APP2CLI_'+randomUUID().replaceAll('-',''),history=previous?.history||[],startedAt=previous?.startedAt||new Date().toISOString();let session,index,objective=previous?.history?.some(h=>h.report)?previous.objective:undefined;
  if(previous){
    session=await readJson(resolve(out,'session.json'));index=await readJson(resolve(evidence,'evidence.json'));
    for(const r of index.records){const p=resolve(evidence,r.file);if(!p.startsWith(evidence+'/')||hash(await readFile(p))!==r.sha256)throw new AppError('EVIDENCE_MISMATCH','Retained analysis changed before resume');}
    if(session.platform==='electron'&&(await identifyElectron(target)).artifact.sha256!==session.artifact.sha256)throw new AppError('VERSION_DRIFT','Application artifact changed before resume');
    if(previous.error?.code==='RESTORATION_FAILED'){
      const failed=history.filter(h=>h.report).at(-1);if(!failed)throw new AppError('RESUME_REJECTED','No cleanup contract to verify');
      const plan=await readJson(resolve(out,'attempt-'+failed.round,'test-plan.json')),report=await readJson(failed.report),context={marker,workspace:session.environment.APP2CLI_WORKSPACE,steps:report.bindings||{}};
      if(!plan.cleanup.length)throw new AppError('RESUME_REJECTED','Missing cleanup witnesses');const observations=[];
      for(const step of plan.cleanup)observations.push(await observeApplicationWitness(session,resolveApplicationValue(step.witness,context)));
      await writeJson(resolve(out,'cleanup-confirmed-before-resume-'+Date.now()+'.json'),{producer:'Independent read-only confirmation after a stopped cleanup failure; prior failure unchanged',observations});
    }
  }
  const save=extra=>writeJson(resolve(out,'generation.json'),{schemaVersion:3,producer:'Application generation orchestrator; not model-native output',target,id,marker,startedAt,history,objective,...extra});
  try{
    await save({status:'preparing'});if(!session){session=await prepareApplication(target,out,flags);await writeJson(resolve(out,'session.json'),session);
    index={schemaVersion:1,platform:session.platform,records:[],derivations:[]};await mkdir(evidence,{recursive:true});
    if(session.platform==='web'){
      const {browser,page}=await selectedPage(session),entries=[];const stop=await recordApplicationNetwork(page,entries);try{await page.reload({waitUntil:'domcontentloaded'});await sleep(1000);}finally{await stop();await browser.close();}
      await retainNetwork(entries,evidence,index,'initial-network');await discoverWebSources(session,evidence,index);
      await reaRecord(['inspect-web-page',session.environment.APP2CLI_CDP,session.environment.APP2CLI_TARGET],evidence,index,'page');
    }else{
      const a=await identifyElectron(target),sources=await exportApplicationSources(a.artifact,resolve(evidence,'sources'));
      await writeJson(resolve(evidence,'source-index.json'),{...sources,inventory:a.artifact.entries.filter(x=>!x.path.startsWith('node_modules/')&&/\.(js|html|json)$/.test(x.path)).map(x=>({path:x.path,bytes:x.size}))});
      const selected=sources.sources.filter(s=>s.path==='package.json'||/\/(?:main|preload)\//.test(s.path)).slice(0,4).map(s=>s.path);
      await reaRecord(['analyze-javascript-application',a.asar,'--integrity-policy','record-and-continue',...selected.flatMap(path=>['--source-path',path]),'--max-semantic-nodes','2400','--max-semantic-nodes-per-file','1200','--analysis-timeout-ms','60000'],evidence,index,'source-analysis');
      await reaRecord(['inspect-electron-fuses',a.path],evidence,index,'fuses');
      try{await reaRecord(['inspect-electron-page',session.environment.APP2CLI_CDP,session.environment.APP2CLI_TARGET],evidence,index,'page');}catch(error){
        const failed=await readJson(resolve(evidence,'page.json'));if(failed.error?.details?.reason!=='target_not_allowed')throw error;
        index.runtimeLimitations=[{operation:'inspect_electron_page',rawFile:'page.json',sha256:hash(await readFile(resolve(evidence,'page.json'))),reason:'REA excluded this renderer URL. Runtime observations use the separate owned-session observer; no REA runtime success is claimed.'}];await writeJson(resolve(evidence,'evidence.json'),index);
      }
    }
    }
    session.environment.APP2CLI_NAMESPACE=marker;await writeJson(resolve(out,'session.json'),session);
    const kit=resolve(out,'kit');await mkdir(kit,{recursive:true});for(const [file,name] of [['src/runtime/execute.mjs','runtime.mjs'],['src/drivers/application.mjs','application-session.mjs'],['src/verify/application.mjs','application-test.mjs'],['src/utils.mjs','sdk.mjs'],['schemas/adapter.schema.json','adapter.schema.json']])await cp(resolve(root,file),resolve(kit,name));
    if(flags['prepare-only']){await observeApplication(session,out);await save({status:'prepared'});return {ok:true,status:'prepared',platform:session.platform,evidence,scope:'Discovery preparation only; no CLI or runtime acceptance yet'};}
    for(let round=history.length+1;round<=rounds;round++){
      const attempt=resolve(out,'attempt-'+round);await mkdir(attempt);await cp(resolve(root,'src/runtime/execute.mjs'),resolve(kit,'runtime.mjs'));await observeApplication(session,out);
      const summary=[];for(const record of index.records){const raw=JSON.parse(await readFile(resolve(evidence,record.file),'utf8'));const d=raw.data||raw,n=d.normalized_result||{};summary.push({file:record.file,operation:record.operation,summary:n.summary,statistics:n.statistics,limitations:n.limitations||d.limitations,integrityContradictions:n.integrity_contradictions});}await writeJson(resolve(evidence,'agent-summary.json'),{producer:'Compact projection of actual REA output',records:summary});
      const discoveries=[];for(const h of history){if(!h.result)continue;try{discoveries.push({round:h.round,reason:h.reason,result:await readJson(h.result)});}catch{discoveries.push({round:h.round,error:'Unusable prior probe output; original retained'});}}await writeJson(resolve(out,'discovery.json'),{producer:'Current-run probe consolidation; not new REA output',observations:discoveries});
      console.error('Application agent round '+round+'/'+rounds);await save({status:'authoring',round});let candidate;
      try{
        candidate=await (dependencies.agent||codexAgent)(prompt({id,session,out,marker,history,goal:flags.goal}),attempt,{model:flags['agent-model'],effort:flags['agent-effort'],ignoreUserConfig:!!flags['codex-ignore-config'],timeout:Number(flags['agent-timeout']||600000),outputSchema});
        if(candidate.decision==='blocked')throw new AppError('MAPPING_BLOCKED',candidate.reason);
        if(candidate.decision==='probe'){
          const result=await doProbe(JSON.parse(candidate.probe),session,out,evidence,index,round);await writeJson(resolve(attempt,'probe-result.json'),result);history.push({round,decision:'probe',reason:candidate.reason,result:resolve(attempt,'probe-result.json')});continue;
        }
        const manifest=JSON.parse(candidate.manifest),plan=JSON.parse(candidate.testPlan);
        if(manifest.id!==id||manifest.platform!==session.platform||manifest.transport!==(session.platform==='web'?'browser-api':'electron-api'))throw new AppError('INVALID_ADAPTER','Preserve the supplied application and API transport');
        if(session.platform==='electron'&&manifest.config.artifactSha256!==session.artifact.sha256||session.platform==='web'&&manifest.config.origin!==new URL(target).origin)throw new AppError('INVALID_ADAPTER','Preserve exact artifact/origin identity',{expected:session.platform==='electron'?{artifactSha256:session.artifact.sha256}:{origin:new URL(target).origin},actual:session.platform==='electron'?{artifactSha256:manifest.config.artifactSha256}:{origin:manifest.config.origin}});
        if(!manifest.capabilities?.length||Object.keys(manifest.commands).length<4)throw new AppError('INVALID_ADAPTER','Provide multi-function commands and a capability inventory');
        validateApplicationPlan(plan,manifest);
        const proposed=plan.steps.map(s=>({name:s.name,command:s.command,effect:s.effect,input:s.input,expected:s.witness.expected,comparison:s.witness.comparison,expect:s.expect}));
        if(objective&&canonical(objective)!==canonical(proposed))throw new AppError('TEST_WEAKENED','Keep the first actually tested business steps, inputs and expected values across repairs',{objective});
        if(!JSON.stringify(plan).includes('${marker}'))throw new AppError('INVALID_PLAN','Use the immutable marker for owned test data');
        if(candidate.module.includes(marker)||candidate.manifest.includes(marker))throw new AppError('INVALID_ADAPTER','Runtime namespace must come from ctx.namespace, not a compiled test marker');
        if(/(?:from\s*|import\s*\()\s*['"](?:node:)?(?:fs|child_process|vm|net)\b/.test(candidate.module))throw new AppError('INVALID_ADAPTER','Generated code must operate through application interfaces, not filesystem/process writes');
        if(/\.(?:click|fill|press|dispatchEvent)\s*\(/.test(candidate.module))throw new AppError('INVALID_ADAPTER','Generated API commands cannot execute UI actions');
        const adapterDir=resolve(attempt,'adapter');await mkdir(adapterDir);await writeJson(resolve(adapterDir,'adapter.json'),manifest);await writeFile(resolve(adapterDir,'adapter.mjs'),candidate.module,{mode:0o600});await writeJson(resolve(attempt,'test-plan.json'),plan);
        const syntax=await runProcess(process.execPath,['--check',resolve(adapterDir,'adapter.mjs')]);if(syntax.code!==0)throw new AppError('SYNTAX_ERROR',syntax.stderr);
        const loaded=await loadAdapter(adapterDir),packageDir=resolve(attempt,'package');await build(adapterDir,{evidence,out:packageDir});objective=proposed;await writeJson(resolve(out,'frozen-test-plan.json'),plan);
        console.error('Testing application CLI with independent observers');await save({status:'testing',round});const report=await testApplication(packageDir,plan,session,attempt,{marker});history.push({round,decision:'candidate',status:report.status,adapterDigest:loaded.digest,error:report.error,cleanupError:report.cleanupError,report:resolve(attempt,'test-report.json')});
        if(report.status==='passed'){
          const final=resolve(out,'package');await cp(packageDir,final,{recursive:true});await writeJson(resolve(final,'acceptance.json'),{producer:'Independent application journey acceptance',adapterDigest:loaded.digest,status:'passed',checks:report.checks,scenarios:report.steps.map(s=>({name:s.name,command:s.command,effect:s.effect,passed:s.passed})),verifiedAt:report.finishedAt});
          const result={ok:true,status:'passed',app:id,platform:session.platform,transport:manifest.transport,output:final,cli:resolve(final,'cli.mjs'),rounds:round,checks:report.checks.length,adapterDigest:loaded.digest,environment:session.environment,report:resolve(attempt,'test-report.json'),marker,scenario:'application-journey'};await writeJson(resolve(out,'result.json'),result);await save({status:'passed',result,finishedAt:new Date().toISOString()});return result;
        }
        if(report.cleanupError)throw new AppError('RESTORATION_FAILED','Cleanup could not be confirmed; inspect the owned resources before continuing',report.cleanupError,6);
      }catch(e){if(!history.some(x=>x.round===round))history.push({round,decision:candidate?.decision||'authoring',status:'failed',error:{code:e.code,message:e.message,details:e.details}});if(['MAPPING_BLOCKED','RESTORATION_FAILED','AGENT_FAILED'].includes(e.code))throw e;}
    }
    throw new AppError('GENERATION_EXHAUSTED','Application discovery/generation reached its bounded round limit');
  }catch(e){await save({status:'failed',finishedAt:new Date().toISOString(),error:{code:e.code,message:e.message,details:e.details}});throw e;}
}
