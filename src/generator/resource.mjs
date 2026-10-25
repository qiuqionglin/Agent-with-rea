import { resolve,dirname,relative,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir,cp,readFile,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inspect } from './discover.mjs';
import { build } from './build.mjs';
import { loadAdapter } from '../runtime/manifest.mjs';
import { runRea,reaEvidence } from './rea.mjs';
import { runProcess } from '../utils.mjs';
import { prepareWeb,prepareAndroid,snapshot,selectedPage } from './session.mjs';
import { testGenerated,validatePlan } from '../verify/resource.mjs';
import { AppError,hash,readJson,writeJson,canonical } from '../sdk.mjs';
import { tapSelector,touchSelector,inputText,validateSelector } from '../drivers/android/ui.mjs';
import { shell } from '../drivers/android/index.mjs';
import {prepareHttp} from './http.mjs';
import {apiSnapshot} from '../verify/http.mjs';
import {codexAgent} from './agent.mjs';
import {resourcePrompt as promptFor} from './prompts.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const errorData=error=>({code:error.code||'GENERATION_FAILED',message:error.message,details:error.details});

async function probe(request,session,evidence,attempt){
  if(session.platform==='android'&&request.kind==='android-observe'){
    await writeJson(resolve(attempt,'probe.json'),await snapshot(session));return;
  }
  if(session.platform==='android'&&request.kind==='android-navigate'){
    const action=JSON.parse(request.selector);
    // Exploration has a caller-owned allowlist, separate from agent output.
    if(!session.navigationProbes?.some(allowed=>canonical(allowed)===canonical(action)))throw new AppError('PROBE_NOT_AUTHORIZED','Navigation probe is not in the caller-supplied exploration allowlist');
    if(action.action==='tap')await tapSelector(session.android,action.selector);
    else if(action.action==='touch')await touchSelector(session.android,action.selector);
    else if(action.action==='text')await inputText(session.android,action.selector,action.text);
    else if(action.action==='back')await shell(session.android,['input','keyevent','KEYCODE_BACK']);
    else throw new AppError('INVALID_PROBE','Only caller-declared tap/text/back exploration is supported');
    await writeJson(resolve(attempt,'probe.json'),await snapshot(session));return;
  }
  if(session.platform==='android'&&request.kind==='android-search'){
    if(!request.className||request.className.length>200)throw new AppError('INVALID_PROBE','Provide a bounded class-name substring');
    const result=await runRea(['search-android-classes',session.apk,request.className],resolve(evidence,'search-'+randomUUID()+'.json'));
    const index=await readJson(resolve(evidence,'evidence.json'));
    index.records.push({file:relative(evidence,result.file),sha256:result.sha256,operation:result.operation,evidenceId:result.raw.evidence_id});await writeJson(resolve(evidence,'evidence.json'),index);
    await writeJson(resolve(attempt,'probe.json'),{evidence:result.file});return;
  }
  if(request.kind==='web-selector'&&session.platform==='web'){
    const {browser,page}=await selectedPage(session);
    try{const locator=page.locator(request.selector);const result={producer:'app2cli read-only DOM probe',selector:request.selector,count:await locator.count(),elements:await locator.evaluateAll(es=>es.slice(0,20).map(e=>({html:e.outerHTML.slice(0,20000),text:(e.textContent||'').slice(0,5000)})))};await writeJson(resolve(attempt,'probe.json'),result);}
    finally{await browser.close();}return;
  }
  if(session.platform!=='android'||!['android-class','android-method'].includes(request.kind)||!/^[\w.$]+$/.test(request.className))throw new AppError('INVALID_PROBE','Only bounded read-only REA/DOM probes are supported');
  const args=[request.kind==='android-class'?'inspect-android-class':'inspect-android-method',session.apk,request.className];
  if(request.kind==='android-method'){if(!/^[\w$<>]+$/.test(request.methodName))throw new AppError('INVALID_PROBE','Invalid method');args.push(request.methodName);}
  const result=await runRea(args,resolve(evidence,'probe-'+randomUUID()+'.json'));const index=await readJson(resolve(evidence,'evidence.json'));
  index.records.push({file:relative(evidence,result.file),sha256:result.sha256,operation:result.operation,evidenceId:result.raw.evidence_id});await writeJson(resolve(evidence,'evidence.json'),index);
  await writeJson(resolve(attempt,'probe.json'),{evidence:result.file});
}

export async function generate(target,flags,dependencies={}){
  if(typeof target!=='string'||typeof flags.out!=='string')throw new AppError('INVALID_INPUT','generate <url|apk> --out <new-run-directory>');
  const transport=flags.transport||(flags.capture&&flags['api-case']?'http':'auto');
  if(!['auto','http','browser-api','browser-function','native-ui'].includes(transport))throw new AppError('INVALID_INPUT','Unknown execution transport');
  if(transport==='browser-api')throw new AppError('API_MAPPING_REQUIRED','The read-only browser API driver supports reviewed adapters; automatic browser API write generation needs an independent signed-request observer and is not enabled yet');
  const platform=/^https?:\/\//.test(target)?(transport==='http'?'api':'web'):target.endsWith('.apk')?'android':null;
  if(transport==='http'&&platform!=='api')throw new AppError('API_EVIDENCE_REQUIRED','Direct HTTP generation needs the observed backend URL plus HAR/API case; APK analysis alone does not supply a replayable API contract');
  if(!platform)throw new AppError('INVALID_INPUT','Input must be an HTTP(S) URL or .apk path');
  if(platform!=='android'){const url=new URL(target);if(url.username||url.password)throw new AppError('INVALID_INPUT','Do not put credentials in URLs');target=url.href;}else target=resolve(target);
  const derived=(platform!=='android'?new URL(target).hostname.replace(/^www\./,''):basename(target,'.apk')).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const id=flags.id||((/^[a-z]/.test(derived)?derived:'app-'+derived).slice(0,49));
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(id))throw new AppError('INVALID_INPUT','Supply a valid --id');
  const maxAllowed=flags.scenario==='android-journey'?16:8;
  const maxAttempts=Number(flags['max-attempts']||4),agentTimeout=Number(flags['agent-timeout']||600000);
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>maxAllowed||!Number.isFinite(agentTimeout)||agentTimeout<1000||agentTimeout>1800000)throw new AppError('INVALID_INPUT','Use 1-'+maxAllowed+' attempts and a 1-1800 second agent timeout (in milliseconds)');
  if(flags['agent-model']!==undefined&&(typeof flags['agent-model']!=='string'||!/^[\w.-]+$/.test(flags['agent-model'])))throw new AppError('INVALID_INPUT','Invalid agent model');
  if(flags['agent-effort']!==undefined&&!['low','medium','high','xhigh','max','ultra'].includes(flags['agent-effort']))throw new AppError('INVALID_INPUT','Invalid reasoning effort');
  const scenario=flags.scenario||'replace-value';
  if(!['replace-value','android-journey'].includes(scenario)||(scenario==='android-journey'&&platform!=='android'))throw new AppError('INVALID_INPUT','--scenario supports replace-value or android-journey');
  const requiredStep=flags['require-step'];
  if(requiredStep&&(scenario!=='android-journey'||typeof requiredStep!=='string'||!/^[a-z][a-z0-9_.]*$/.test(requiredStep)))throw new AppError('INVALID_INPUT','--require-step needs an Android journey command ID');
  const out=resolve(flags.out),evidence=resolve(out,'evidence');await mkdir(dirname(out),{recursive:true});
  const reviewedPlan=flags['reviewed-plan']?await readJson(resolve(flags['reviewed-plan'])):undefined;
  if(reviewedPlan&&scenario!=='android-journey')throw new AppError('INVALID_INPUT','Reviewed plans currently require Android journeys');
  let startedAt=new Date().toISOString(),marker='APP2CLI_'+randomUUID().replaceAll('-',''),history=[],session,objective;
  if(flags.resume){
    const previous=await readJson(resolve(out,'generation.json'));
    if(previous.request?.reviewedPlanSha256&&previous.request.reviewedPlanSha256!==hash(canonical(reviewedPlan||null)))throw new AppError('RESUME_REJECTED','Retain the same explicitly reviewed plan on subsequent resumes');
    if(previous.status!=='failed'||previous.id!==id||previous.platform!==platform||previous.error?.code==='RESTORATION_FAILED'||previous.attempts.some(a=>a.cleanupError))throw new AppError('RESUME_REJECTED','Only a stopped, matching run with no restoration uncertainty may resume',{},6);
    session=await readJson(resolve(out,'session.json'));
    if((previous.request?.target||(platform==='web'?session.url:session.apk))!==target||(previous.request?.scenario||'replace-value')!==scenario||previous.request?.requiredStep!==requiredStep||(previous.request?.seed||null)!==(flags.seed?resolve(flags.seed):null))throw new AppError('RESUME_REJECTED','Target, scenario, seed or required step differs from the prior run');
    const index=await readJson(resolve(evidence,'evidence.json'));
    for(const record of index.records){const path=resolve(evidence,record.file);if(!path.startsWith(evidence+'/')||hash(await readFile(path))!==record.sha256)throw new AppError('EVIDENCE_MISMATCH','Prior evidence changed');}
    history=previous.attempts;startedAt=previous.startedAt;marker=previous.marker;objective=previous.objective;
    if(history.length>=maxAttempts)throw new AppError('GENERATION_EXHAUSTED','Increase --max-attempts to resume within the '+maxAllowed+'-round limit');
  }else{
    try{await mkdir(out,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw new AppError('OUTPUT_EXISTS','Use a new run directory, or --resume for a stopped run');throw e;}
  }
  const save=async extra=>writeJson(resolve(out,'generation.json'),{schemaVersion:1,producer:'app2cli generation orchestration, not REA or model-native output',id,platform,startedAt,marker,objective,request:{target,goal:flags.goal,transport,allowUiFallback:!!session?.allowUiFallback,scenario,requiredStep,seed:flags.seed?resolve(flags.seed):null,...(reviewedPlan?{reviewedPlanSha256:hash(canonical(reviewedPlan))}:{})},attempts:history,...extra});
  try{
    if(reviewedPlan){
      if(objective)await writeJson(resolve(out,'superseded-objective-'+Date.now()+'.json'),{producer:'explicit caller-reviewed oracle revision, not automatic repair',previous:objective,nextPlanSha256:hash(canonical(reviewedPlan)),priorAttemptCount:history.length});
      await writeJson(resolve(out,'reviewed-test-plan.json'),reviewedPlan);objective=undefined;
    }
    if(flags.seed){
      if(platform!=='android')throw new AppError('INVALID_INPUT','Seed extension currently requires an APK');
      const prior=await readJson(resolve(flags.seed,'result.json'));
      const seed=await loadAdapter(resolve(flags.seed,'package/adapters',id));
      if(prior.status!=='passed'||prior.app!==id||prior.platform!==platform||prior.adapterDigest!==seed.digest||seed.manifest.config.apkSha256!==hash(await readFile(target)))throw new AppError('SEED_MISMATCH','Seed must be a passed unchanged adapter for this exact APK');
      await cp(seed.directory,resolve(out,'seed-adapter'),{recursive:true});
      await writeJson(resolve(out,'seed-provenance.json'),{producer:'app2cli prior-adapter extension input',adapterDigest:seed.digest,sourceRun:resolve(flags.seed),status:prior.status});
    }
    console.error('Preparing '+platform+' target');
    if(session){console.error('Resuming prior REA evidence and application session');}
    else if(dependencies.prepare){session=await dependencies.prepare({target,platform,out,evidence,flags});}
    else if(platform==='api'){session=await prepareHttp(target,evidence,out,flags);}
    else if(platform==='web'){
      session=await prepareWeb(target,out,flags);await inspect('web',session.environment.APP2CLI_CDP,{out:evidence,target:session.environment.APP2CLI_TARGET});
    }else{
      if(flags['analysis-evidence']){
        const source=resolve(flags['analysis-evidence']),index=await readJson(resolve(source,'evidence.json')),apkHash=hash(await readFile(target));
        if(index.platform!=='android'||!index.records?.length)throw new AppError('EVIDENCE_MISMATCH','Android evidence is required');
        for(const record of index.records){
          const file=resolve(source,record.file);if(!file.startsWith(source+'/'))throw new AppError('EVIDENCE_MISMATCH','Evidence path escapes its directory');
          const bytes=await readFile(file),raw=reaEvidence(JSON.parse(bytes));
          if(hash(bytes)!==record.sha256||raw.subject?.digest?.sha256!==apkHash||raw.operation!==record.operation||raw.error)throw new AppError('EVIDENCE_MISMATCH','Cached REA evidence does not match the exact input APK');
        }
        await cp(source,evidence,{recursive:true});
        console.error('Reusing hash-verified REA analysis of this exact APK');
      }else await inspect('android',target,{out:evidence});
      session=await prepareAndroid(target,evidence,out,flags);
    }
    if(flags['navigation-probes']){
      const previousProbes=session.navigationProbes;
      session.navigationProbes=await readJson(resolve(flags['navigation-probes']));
      if(!Array.isArray(session.navigationProbes)||session.navigationProbes.length>32)throw new AppError('INVALID_INPUT','Navigation probes must be an array of at most 32 permitted tap/back actions');
      for(const action of session.navigationProbes){
        if(['tap','touch'].includes(action?.action)&&Object.keys(action).length===2)validateSelector(action.selector);
        else if(action?.action==='text'&&Object.keys(action).length===3&&typeof action.text==='string'&&action.text.length<=200)validateSelector(action.selector);
        else if(action?.action!=='back'||Object.keys(action).length!==1)throw new AppError('INVALID_INPUT','Probes allow exact tap selectors, fixed text in a non-password field, or back');
      }
      if(previousProbes&&canonical(previousProbes)!==canonical(session.navigationProbes))await writeJson(resolve(out,'probe-allowlist-update-'+Date.now()+'.json'),{producer:'caller-provided exploration allowlist update on resume',previous:previousProbes,next:session.navigationProbes});
      await writeJson(resolve(out,'session.json'),session);
    }
    session.allowUiFallback=!!flags['allow-ui-fallback']||['native-ui','browser-function'].includes(transport);
    await writeJson(resolve(out,'session.json'),session);
    const kit=resolve(out,'kit');await mkdir(kit,{recursive:true});
    for(const [file,name] of [['docs/adapter-contract.md','adapter-contract.md'],['schemas/adapter.schema.json','adapter.schema.json'],['src/runtime/execute.mjs','runtime.mjs'],['src/drivers/web/index.mjs','web.mjs'],['src/drivers/http/index.mjs','http.mjs'],['src/drivers/http/resource.mjs','http-adapter.mjs'],['src/drivers/android/index.mjs','android.mjs'],['src/drivers/android/ui.mjs','android-ui.mjs'],['src/drivers/android/text.py','android-text.py'],['src/verify/android.mjs','generation-journey.mjs'],['src/utils.mjs','sdk.mjs']])await cp(resolve(root,file),resolve(kit,name));
    const observe=dependencies.snapshot||(platform==='api'?apiSnapshot:snapshot);
    const index=await readJson(resolve(evidence,'evidence.json')),summary=[];
    for(const record of index.records){
      const raw=reaEvidence(await readJson(resolve(evidence,record.file))),n=raw.normalized_result||{};
      summary.push({file:record.file,operation:raw.operation,evidenceId:raw.evidence_id,limitations:raw.limitations,
        ...(n.scripts&&Array.isArray(n.scripts)?{sources:n.scripts.map(s=>({url:s.url,content:s.content}))}:{}),
        ...(n.summary?{summary:n.summary}:{}),...(n.statistics?{statistics:n.statistics}:{}),...(n.package_name?{package:n.package_name,version:n.version_name}:{}),
        ...(n.semantic_graph?{semanticNodeCount:n.semantic_graph.nodes?.length,semanticKinds:[...new Set(n.semantic_graph.nodes?.map(x=>x.kind)||[])]}:{}),
      });
    }
    await writeJson(resolve(evidence,'agent-summary.json'),{producer:'app2cli compact projection, not raw REA',records:summary});
    await writeJson(resolve(out,'observation.json'),await observe(session));
    await save({status:'analyzed'});
    const agent=dependencies.agent||codexAgent;
    for(let n=history.length+1;n<=maxAttempts;n++){
      const attempt=resolve(out,'attempt-'+n);await mkdir(attempt,{mode:0o700});console.error('Agent generation round '+n+'/'+maxAttempts);
      await save({status:'generating',currentRound:n});
      let candidate,plan;
      try{
        candidate=await agent(promptFor({id,session,evidence,out,marker,goal:flags.goal,history,scenario,seed:!!flags.seed,requiredStep,reviewedPlan}),attempt,{timeout:agentTimeout,model:flags['agent-model'],effort:flags['agent-effort'],ignoreUserConfig:!!flags['codex-ignore-config']});
        if(candidate.decision==='blocked')throw new AppError('MAPPING_BLOCKED',candidate.reason,{},3);
        if(candidate.decision==='probe'){
          await (dependencies.probe||probe)(candidate.probe,session,evidence,attempt);
          await writeJson(resolve(out,'observation.json'),await observe(session));
          history.push({round:n,decision:'probe',reason:candidate.reason,output:resolve(attempt,'probe.json')});await save({status:'probing'});continue;
        }
        if(candidate.decision!=='candidate')throw new AppError('INVALID_AGENT_OUTPUT','Unknown decision');
        const manifest=JSON.parse(candidate.manifest);plan=JSON.parse(candidate.testPlan);
        if(manifest.id!==id||manifest.platform!==platform)throw new AppError('INVALID_ADAPTER','Agent changed application identity');
        if(manifest.verification!==(platform==='api'?'server-confirmed':platform==='web'?'reload-persisted':'native-ui-readback'))throw new AppError('INVALID_ADAPTER','Verification level exceeds the available independent observer');
        const actualTransport=manifest.transport||(platform==='android'?'native-ui':'browser-function');
        if(['http','browser-api'].includes(actualTransport)&&!index.records.some(record=>record.operation==='inspect_web_network_capture'))throw new AppError('API_EVIDENCE_REQUIRED','An API transport claim requires REA-inspected network evidence; client functions alone do not establish an API transport');
        if(['native-ui','browser-function'].includes(actualTransport)&&!session.allowUiFallback)throw new AppError('API_MAPPING_REQUIRED','API-first generation refuses an implicit UI/native-function fallback; provide network evidence or explicitly allow fallback');
        if(['native-ui','browser-function'].includes(actualTransport)&&!manifest.fallbackReason)throw new AppError('INVALID_ADAPTER','Fallback adapters must explain the missing API evidence');
        if(transport!=='auto'&&actualTransport!==transport)throw new AppError('TRANSPORT_MISMATCH','Generated transport differs from the caller-selected transport');
        if(platform==='api'){
          if(canonical(manifest.config.auth||null)!==canonical(session.api.config.auth||null)||canonical(manifest.config.parameters||{})!==canonical(session.api.config.parameters||{})||manifest.config.baseUrl!==session.api.config.baseUrl)throw new AppError('INVALID_ADAPTER','HTTP adapter changed pinned origin, authentication metadata or resource binding');
          if(manifest.config.operations?.observe?.method!=='GET'||manifest.config.operations?.observe?.path!==session.api.config.operations.observe.path)throw new AppError('INVALID_ADAPTER','HTTP adapter changed the pinned GET endpoint');
          if(manifest.config.field!==session.api.field||canonical(manifest.config.owner)!==canonical(session.api.owner))throw new AppError('INVALID_ADAPTER','HTTP resource field and ownership assertions must remain pinned');
          if(plan.witness?.selector!==session.api.field||plan.valuePath!==session.api.field||plan.witness?.comparison!=='equals')throw new AppError('INVALID_TEST_PLAN','API case field and exact observer cannot change');
        }
        validatePlan(plan,manifest);
        if(reviewedPlan&&canonical(plan)!==canonical(reviewedPlan))throw new AppError('REVIEWED_PLAN_CHANGED','Candidate must preserve the explicitly reviewed test plan');
        if(plan.semantics!==scenario)throw new AppError('INVALID_TEST_PLAN','Candidate changed the requested scenario type');
        if(requiredStep&&!plan.steps.some(step=>step.command===requiredStep))throw new AppError('REQUIRED_STEP_MISSING','The requested operation must be exercised by the native journey',{command:requiredStep});
        if(platform!=='android'&&(plan.testValue!==marker||plan.witness.expected!==marker))throw new AppError('INVALID_TEST_PLAN','Agent changed the immutable challenge');
        const proposed=plan.semantics==='android-journey'?{semantics:plan.semantics,steps:plan.steps.map(({name,input,witness,readback})=>({name,input,witness,readback})),start:plan.start.witness,cleanup:plan.cleanup.witness}:{testValue:plan.testValue,witness:{kind:plan.witness.kind,expected:plan.witness.expected,comparison:plan.witness.comparison}};
        if(objective&&JSON.stringify(objective)!==JSON.stringify(proposed))throw new AppError('TEST_WEAKENED','Repair must preserve the test objective');objective=proposed;
        const adapterDir=resolve(attempt,'adapter');await mkdir(adapterDir);await writeJson(resolve(adapterDir,'adapter.json'),manifest);
        if(typeof candidate.module!=='string'||candidate.module.length>250000)throw new AppError('INVALID_AGENT_OUTPUT','Invalid adapter source');
        await writeFile(resolve(adapterDir,'adapter.mjs'),candidate.module,{mode:0o600});await writeJson(resolve(attempt,'test-plan.json'),plan);
        const checked=await runProcess(process.execPath,['--check',resolve(adapterDir,'adapter.mjs')]);
        if(checked.code!==0)throw new AppError('SYNTAX_ERROR',checked.stderr);
        const loaded=await loadAdapter(adapterDir);const packageDir=resolve(attempt,'package');
        await build(adapterDir,{evidence,out:packageDir});console.error('Testing generated CLI against the real application');
        await save({status:'testing',currentRound:n});
        const report=await (dependencies.test||testGenerated)(packageDir,plan,session,attempt);
        history.push({round:n,decision:'candidate',adapterDigest:loaded.digest,status:report.status,reason:candidate.reason,report:resolve(attempt,'test-report.json'),error:report.error,cleanupError:report.cleanupError});
        if(report.status==='passed'){
          const finalDir=resolve(out,'package');await cp(packageDir,finalDir,{recursive:true});
          await writeJson(resolve(finalDir,'acceptance.json'),{producer:'app2cli actual independent test runner',adapterDigest:loaded.digest,status:report.status,semantics:plan.semantics,checks:report.checks.map(({name,passed})=>({name,passed})),scenarios:report.steps||[],restorationScope:report.restorationScope||'tested value restored',verifiedAt:report.finishedAt});
          const result={ok:true,status:'passed',app:id,platform,transport:actualTransport,output:finalDir,cli:resolve(finalDir,'cli.mjs'),adapterDigest:loaded.digest,rounds:n,repairs:history.filter(h=>h.status==='failed'&&h.decision==='candidate').length,failedRounds:history.filter(h=>h.status==='failed').length,checks:report.checks.length,environment:{...session.environment,APP2CLI_HOME:resolve(out,'state')},evidence,report:resolve(attempt,'test-report.json'),verification:loaded.manifest.verification};
          await writeJson(resolve(out,'result.json'),result);await save({status:'passed',finishedAt:new Date().toISOString(),result});return result;
        }
        // Never continue mutations when baseline restoration could not be confirmed.
        if(report.cleanupError)throw new AppError('RESTORATION_FAILED','Inspect the actual application before continuing; automatic repair stopped',report.cleanupError,6);
      }catch(error){
        if(!history.some(h=>h.round===n))history.push({round:n,decision:candidate?.decision||'authoring',status:'failed',error:errorData(error),candidate:resolve(attempt,'agent-response.json')});
        if(['MAPPING_BLOCKED','AGENT_FAILED','RESTORATION_FAILED'].includes(error.code))throw error;
      }
      await writeJson(resolve(out,'observation.json'),await observe(session));await save({status:'repairing'});
    }
    throw new AppError('GENERATION_EXHAUSTED','No candidate passed the bounded real-application tests',{attempts:maxAttempts,report:resolve(out,'generation.json')},5);
  }catch(error){await save({status:'failed',finishedAt:new Date().toISOString(),error:errorData(error),session:session?resolve(out,'session.json'):null});throw error;}
}
