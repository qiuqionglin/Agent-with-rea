import {resolve} from 'node:path';
import {AppError,canonical,readJson,writeJson} from '../utils.mjs';
import {connectHttp,requestHttp} from '../drivers/http/index.mjs';
import {jsonField} from '../verify/http.mjs';
import {runRea} from './rea.mjs';
export async function prepareHttp(target,evidence,out,flags){
  if(!flags.capture||!flags['api-case'])throw new AppError('API_EVIDENCE_REQUIRED','HTTP generation requires --capture <HAR> and --api-case <owned-resource contract>');
  const targetUrl=new URL(target);
  if(targetUrl.pathname!=='/'||targetUrl.search||targetUrl.hash)throw new AppError('INVALID_API_CASE','Use only the backend origin; keep resource paths in the API case and credentials in environment variables');
  const apiCase=await readJson(resolve(flags['api-case']));
  if(apiCase.schemaVersion!==1||new URL(target).origin!==apiCase.config?.baseUrl||apiCase.config?.operations?.observe?.method!=='GET'||!Object.keys(apiCase.owner||{}).length)throw new AppError('INVALID_API_CASE','Provide an origin-matching GET observer and resource ownership assertions');
  jsonField({},apiCase.field);
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(apiCase.field)||Object.keys(apiCase.owner).some(k=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(k))||Object.hasOwn(apiCase.owner,apiCase.field))throw new AppError('INVALID_API_CASE','Generated resource adapters currently require a top-level string field and separate top-level ownership assertions');
  for(const path of Object.keys(apiCase.owner))jsonField({},path);
  const ctx=connectHttp(process.env,apiCase.config),before=await requestHttp(ctx,'observe');
  for(const [path,value]of Object.entries(apiCase.owner))if(canonical(jsonField(before.data,path))!==canonical(value))throw new AppError('RESOURCE_NOT_OWNED','Server resource does not match the caller-owned fixture',{path},4);
  if(typeof jsonField(before.data,apiCase.field)!=='string')throw new AppError('INVALID_API_CASE','API replace test currently requires a string field');
  const rea=await runRea(['inspect-web-network-capture',resolve(flags.capture),'har'],resolve(evidence,'network.json'));
  await writeJson(resolve(evidence,'evidence.json'),{schemaVersion:1,platform:'api',producer:'app2cli index of actual REA network-capture inspection',records:[{file:'network.json',sha256:rea.sha256,operation:rea.operation,evidenceId:rea.raw.evidence_id}],derivations:[]});
  // Resource IDs are configuration; credentials stay in the caller environment.
  const environment=Object.fromEntries(Object.values(apiCase.config.parameters||{}).map(name=>[name,process.env[name]]));
  const session={platform:'api',url:target,api:apiCase,environment};
  await writeJson(resolve(out,'session.json'),session);await writeJson(resolve(out,'api-case.json'),apiCase);return session;
}
