import { browserTargetKey,connectBrowser,checkBrowser } from '../../lib/web.mjs';
import { canonical,hash,AppError } from '../../lib/sdk.mjs';
const semantic=items=>items.map(({title,completed})=>({title,completed}));
function snapshot(){
  const vm=ko.dataFor(document.body);if(vm.showMode()!=='all')throw Error('Select the All view');
  const normalize=(t,i)=>({id:String(i),title:t.title,completed:!!t.completed});
  return {items:vm.todos().map((t,i)=>normalize({title:t.title(),completed:t.completed()},i)),rendered:[...document.querySelectorAll('.todo-list li')].map(li=>({title:li.querySelector('label').textContent,completed:li.querySelector('.toggle').checked})),persisted:JSON.parse(localStorage.getItem('todos-knockoutjs')||'[]').map(normalize)};
}
export default {
  targetKey:browserTargetKey,connect:connectBrowser,check:checkBrowser,
  async read(ctx){const data=await ctx.page.evaluate(snapshot);return {scopeKey:hash(ctx.origin+ctx.targetId),data,proof:{kind:'native-model-dom-storage',modelSha256:hash(canonical(data.items)),storageSha256:hash(canonical(data.persisted))}};},
  plan(command,input,before){
    const expected=semantic(before.data.items);const index=before.data.items.findIndex(x=>x.id===input.id);
    if(command!=='todos.create'&&index<0)throw new AppError('NOT_FOUND','No such todo in the current snapshot');
    if(command==='todos.create')expected.push({title:input.title.trim(),completed:false});
    if(command==='todos.rename')expected[index].title=input.title.trim();
    if(command==='todos.set_completed')expected[index].completed=input.completed;
    if(command==='todos.delete')expected.splice(index,1);
    return {expected};
  },
  async dispatch(ctx,command,input){
    return ctx.page.evaluate(({command,input})=>{
      const vm=ko.dataFor(document.body),item=vm.todos()[Number(input.id)];
      if(command==='todos.create'){vm.current(input.title);vm.add();}
      else if(command==='todos.rename'){vm.editItem(item);item.title(input.title);vm.saveEditing(item);}
      else if(command==='todos.set_completed')item.completed(input.completed);
      else if(command==='todos.delete')vm.remove(item);
      return {nativeFunctionCalled:true};
    },{command,input});
  },
  matches(plan,s){return canonical(plan.expected)===canonical(semantic(s.data.items))&&canonical(s.data.items)===canonical(s.data.persisted)&&canonical(plan.expected)===canonical(s.data.rendered);},
  async refresh(ctx){await ctx.page.reload({waitUntil:'load'});},
  result(command,input,state){
    if(command==='todos.list')return state.data.items;
    if(command==='todos.delete')return {deleted:true};
    if(command==='todos.create')return state.data.items.at(-1);
    const item=state.data.items.find(x=>x.id===input.id);if(!item)throw new AppError('NOT_FOUND','No such todo');return item;
  },
  close:ctx=>ctx.browser.close(),
};
