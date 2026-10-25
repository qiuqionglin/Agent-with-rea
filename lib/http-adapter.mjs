import {connectHttp,httpTargetKey,requestHttp} from './http.mjs';
import {AppError,canonical} from './sdk.mjs';

// Bounded declarative contract: one owned JSON resource and one top-level string.
// Endpoint semantics still come from REA evidence, never inferred by this factory.
export function createHttpResourceAdapter(){
  function validate(config){
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(config.field)||['constructor','prototype','__proto__'].includes(config.field)||!['field-patch','full-resource'].includes(config.updateMode)||!Object.keys(config.owner||{}).length||Object.hasOwn(config.owner,config.field)||config.operations?.observe?.method!=='GET'||!['PUT','PATCH'].includes(config.operations?.update?.method))throw new AppError('INVALID_ADAPTER','Declare a GET observer, PUT/PATCH update, owner assertions, plain string field and updateMode');
  }
  function owned(ctx,data){
    if(!data||typeof data!=='object'||Array.isArray(data)||typeof data[ctx.config.field]!=='string')throw new AppError('RESPONSE_SCHEMA_CHANGED','Expected an owned JSON resource with the declared string field',{},4);
    for(const [field,value]of Object.entries(ctx.config.owner))if(canonical(data[field])!==canonical(value))throw new AppError('RESOURCE_NOT_OWNED','Resource does not match the declared ownership assertions',{field},4);
  }
  return {
    targetKey:httpTargetKey,
    connect(env,config){validate(config);return connectHttp(env,config);},
    async check(ctx){owned(ctx,(await requestHttp(ctx,'observe')).data);},
    async read(ctx){const r=await requestHttp(ctx,'observe');owned(ctx,r.data);return {scopeKey:ctx.scopeKey,resourceField:ctx.config.field,data:r.data,proof:r.proof};},
    plan(command,input,before){
      if(command!=='resource.set'||typeof input.value!=='string')throw new AppError('INVALID_INPUT','Use resource.set with a string value');
      return {before:before.data,field:before.resourceField,value:input.value};
    },
    async dispatch(ctx,command,input,plan){
      const field=ctx.config.field,expected={...plan.before,[field]:plan.value};
      // Recheck ownership and baseline just before dispatch. This is still not
      // a server-side compare-and-swap unless the actual API provides one.
      const fresh=(await requestHttp(ctx,'observe')).data;owned(ctx,fresh);
      if(canonical(fresh)!==canonical(plan.before))throw new AppError('STALE_STATE','Resource changed before API dispatch',{},4);
      return requestHttp(ctx,'update',{body:ctx.config.updateMode==='field-patch'?{[field]:plan.value}:expected});
    },
    matches(plan,after){
      // plan carries the field through the snapshot config-free data boundary.
      return canonical(after.data)===canonical({...plan.before,[plan.field]:plan.value});
    },
    async refresh(){},
    result(command,input,snapshot){return snapshot.data;},
    async close(){}
  };
}
