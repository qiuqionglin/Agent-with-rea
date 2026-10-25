import {resolve,dirname} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {AppError,readJson,writeJson,runProcess} from '../utils.mjs';
const agentOutputSchema={type:'object',additionalProperties:false,required:['decision','reason','manifest','module','testPlan','probe'],properties:{
  decision:{type:'string',enum:['candidate','probe','blocked']},reason:{type:'string'},manifest:{type:'string'},module:{type:'string'},testPlan:{type:'string'},
  probe:{type:'object',additionalProperties:false,required:['kind','className','methodName','selector'],properties:{kind:{type:'string',enum:['none','android-class','android-method','android-search','android-observe','android-navigate','web-selector']},className:{type:'string'},methodName:{type:'string'},selector:{type:'string'}}}
}};
export async function codexAgent(prompt,attempt,{command=process.env.APP2CLI_CODEX||'codex',timeout=600000,model,effort,ignoreUserConfig=false,outputSchema=agentOutputSchema}={}){
  const schema=resolve(attempt,'output-schema.json'),answer=resolve(attempt,'agent-response.json');
  await writeJson(schema,outputSchema);await writeFile(resolve(attempt,'prompt.txt'),prompt,{mode:0o600});
  const options=[...(ignoreUserConfig?['--ignore-user-config']:[]),...(model?['--model',model]:[]),...(effort?['-c','model_reasoning_effort='+JSON.stringify(effort)]:[])];
  await writeJson(resolve(attempt,'agent-launch.json'),{producer:'app2cli agent invocation metadata',command,model:model||'configured default',effort:effort||'configured default',ignoreUserConfig});
  const result=await runProcess(command,['-a','never','exec',...options,'--sandbox','read-only','--skip-git-repo-check','--ephemeral','--json','--color','never','-C',dirname(attempt),'--output-schema',schema,'--output-last-message',answer,'-'],{input:prompt,timeout,log:resolve(attempt,'agent'),maxBytes:32*1024*1024});
  if(result.code!==0)throw new AppError('AGENT_FAILED','Codex did not finish successfully',{exitCode:result.code,log:resolve(attempt,'agent.stderr')},3);
  return readJson(answer);
}
