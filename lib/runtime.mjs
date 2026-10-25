import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AppError,canonical,hash,readJson,writeJson,sleep } from './sdk.mjs';
import { withLock } from './lock.mjs';
import { validateInput } from './manifest.mjs';

export async function execute(adapter,commandName,input,options={}){
  const {manifest,directory,digest}=adapter,command=manifest.commands[commandName];
  if(!command)throw new AppError('UNKNOWN_COMMAND','No such command',{command:commandName});
  validateInput(command,input);
  const requestId=options.requestId||randomUUID();
  if(!/^[A-Za-z0-9._:-]{1,100}$/.test(requestId))throw new AppError('INVALID_REQUEST_ID','Use 1-100 letters, digits, dots, colons, underscores or hyphens');
  const stateRoot=resolve(options.stateRoot||process.env.APP2CLI_HOME||resolve(homedir(),'.local/share/app2cli'));
  const {default:plugin}=await import(pathToFileURL(resolve(directory,'adapter.mjs')));
  const target=plugin.targetKey(process.env,manifest.config);
  // Lock the execution surface, including across different app adapters that
  // share one Android device or one selected browser target.
  const sessionKey=hash(target);
  return withLock(resolve(stateRoot,'locks',sessionKey),async()=>{
    let ctx,auditPath;
    const revision=snapshot=>hash(canonical({adapter:digest,scope:snapshot.scopeKey,data:snapshot.data}));
    try{
      ctx=await plugin.connect(process.env,manifest.config);
      ctx.request={command:commandName,input};
      await plugin.check(ctx,manifest.config);
      const before=await plugin.read(ctx);const currentRevision=revision(before);
      if(!before.scopeKey)throw new AppError('MISSING_SCOPE','Adapter must identify the current session',{},4);
      auditPath=resolve(stateRoot,'audits',manifest.id,hash(before.scopeKey),requestId+'.json');
      if(command.readOnly)return {ok:true,app:manifest.id,command:commandName,data:await plugin.result(commandName,input,before),revision:currentRevision,verification:{level:'readback',proof:before.proof}};
      const key=hash(manifest.id+'\n'+before.scopeKey+'\n'+requestId);
      const ledgerPath=resolve(stateRoot,'journal',key+'.json');const payloadHash=hash(canonical({adapter:digest,commandName,input,expectedRevision:options.expectedRevision??null}));
      let prior;try{prior=await readJson(ledgerPath);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(prior){
        if(prior.payloadHash!==payloadHash)throw new AppError('IDEMPOTENCY_CONFLICT','Request ID has a different payload',{},4);
        if(prior.status==='verified')return {...prior.response,replayed:true};
        throw new AppError('OUTCOME_UNCERTAIN','Previously dispatched request has no verified outcome; inspect audit before retrying',{audit:prior.audit},6);
      }
      if(options.expectedRevision&&options.expectedRevision!==currentRevision)throw new AppError('STALE_STATE','State changed since the supplied revision',{},4);
      const plan=await plugin.plan(commandName,input,before);
      if(options.dryRun)return {ok:true,dryRun:true,app:manifest.id,command:commandName,input,revision:currentRevision,plan};
      const audit={producer:'app2cli execution audit, not REA output',requestId,adapterDigest:digest,command:commandName,input,before,stages:[],startedAt:new Date().toISOString()};
      await writeJson(ledgerPath,{status:'dispatched',payloadHash,audit:auditPath});
      await writeJson(auditPath,audit);
      try{
        audit.dispatch=await plugin.dispatch(ctx,commandName,input,plan);audit.stages.push('dispatched');
        const deadline=Date.now()+10000;let after;
        do{after=await plugin.read(ctx);if(after.scopeKey===before.scopeKey&&await plugin.matches(plan,after))break;await sleep(150);}while(Date.now()<deadline);
        if(after.scopeKey!==before.scopeKey||!await plugin.matches(plan,after))throw new AppError('VERIFICATION_FAILED','Native application did not reach the required state',{},5);
        audit.after=after;audit.stages.push('readback_verified');
        await plugin.refresh(ctx);await plugin.check(ctx,manifest.config);const confirmed=await plugin.read(ctx);
        if(confirmed.scopeKey!==before.scopeKey||!await plugin.matches(plan,confirmed))throw new AppError('CONFIRMATION_FAILED','Fresh application readback did not confirm the operation',{},5);
        audit.confirmed=confirmed;audit.stages.push('fresh_readback_verified');audit.ok=true;audit.finishedAt=new Date().toISOString();
        const response={ok:true,app:manifest.id,command:commandName,requestId,data:await plugin.result(commandName,input,confirmed),revision:revision(confirmed),verification:{level:manifest.verification,stages:audit.stages},audit:auditPath,replayed:false};
        await writeJson(auditPath,audit);await writeJson(ledgerPath,{status:'verified',payloadHash,audit:auditPath,response});return response;
      }catch(e){audit.ok=false;audit.error={code:e.code||'DISPATCH_FAILED',message:e.message};audit.finishedAt=new Date().toISOString();await writeJson(auditPath,audit);throw e;}
    }finally{if(ctx)await plugin.close(ctx);}
  });
}
