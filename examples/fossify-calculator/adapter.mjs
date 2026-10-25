import { androidTargetKey,connectAndroid,checkAndroid,hierarchy,nodeById,tap } from '../../lib/android.mjs';
import { hash,AppError,sleep } from '../../lib/sdk.mjs';
const operations={add:{button:'btn_plus',compute:(a,b)=>a+b},subtract:{button:'btn_minus',compute:(a,b)=>a-b},multiply:{button:'btn_multiply',compute:(a,b)=>a*b},divide:{button:'btn_divide',compute:(a,b)=>a/b}};
export default {
  targetKey:androidTargetKey,connect:connectAndroid,check:checkAndroid,
  async read(ctx){
    const tree=await hierarchy(ctx),prefix=ctx.config.package+':id/';
    const result=nodeById(tree,prefix+'result').text,formula=nodeById(tree,prefix+'formula').text;
    return {scopeKey:hash(ctx.serial+ctx.config.package),data:{result,formula},proof:{kind:'android-uiautomator',xmlSha256:tree.sha256}};
  },
  plan(command,input){
    if(command==='clear')return {expected:0};
    if(input.operator==='divide'&&input.b===0)throw new AppError('INVALID_INPUT','Division by zero is outside this sample contract');
    return {expected:operations[input.operator].compute(input.a,input.b)};
  },
  async dispatch(ctx,command,input){
    const tree=await hierarchy(ctx),prefix=ctx.config.package+':id/';
    await tap(ctx,nodeById(tree,prefix+'btn_clear'),true);
    if(command==='clear')return {nativeUIActions:1};
    const buttons=[...String(input.a)].map(x=>'btn_'+x).concat([operations[input.operator].button],[...String(input.b)].map(x=>'btn_'+x),['btn_equals']);
    for(const key of buttons)await tap(ctx,nodeById(tree,prefix+key));
    return {nativeUIActions:buttons.length+1};
  },
  matches(plan,s){
    const text=s.data.result.replaceAll(',','').replaceAll('\u00a0','').replaceAll('−','-').trim();
    return text.length>0&&Number.isFinite(Number(text))&&Math.abs(Number(text)-plan.expected)<=Math.max(1,Math.abs(plan.expected))*1e-8;
  },
  // A second fresh hierarchy is an independent UI observation, not a claim
  // about persistence across process restart or an offline server response.
  async refresh(){await sleep(250);},
  result(command,input,state){return state.data;},
  async close(){},
};
