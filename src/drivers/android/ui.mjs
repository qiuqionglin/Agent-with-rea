// Native selectors shared by generated adapters and the independent observer.
// These describe observations; no application-specific selectors live here.
import { AppError } from '../../sdk.mjs';
import { hierarchy,shell,tap,nativeHelper } from './index.mjs';

const attributes=new Set(['resource-id','text','content-desc','package','class','clickable','long-clickable','enabled','focused','selected','checked','checkable','scrollable','password']);
export function validateSelector(selector){
  if(!selector||Array.isArray(selector)||typeof selector!=='object'||!Object.keys(selector).length||Object.keys(selector).length>12)throw new AppError('INVALID_SELECTOR','Provide a nonempty native attribute selector');
  for(const [key,value]of Object.entries(selector)){
    if(!attributes.has(key)||typeof value!=='string'||!value||value.length>4096)throw new AppError('INVALID_SELECTOR','Use exact nonempty native attributes',{attribute:key});
  }
}
export function selectNodes(tree,selector){validateSelector(selector);return tree.nodes.filter(node=>Object.entries(selector).every(([k,v])=>node[k]===v));}
export function selectNode(tree,selector){const nodes=selectNodes(tree,selector);if(nodes.length!==1)throw new AppError('UI_CHANGED','Native selector must match exactly one element',{selector,count:nodes.length},4);return nodes[0];}
export function actionableNode(tree,node){
  const seen=new Set();
  while(node&&!seen.has(node.nodeIndex)){
    if(node.password==='true')throw new AppError('USER_INPUT_REQUIRED','Credential fields require native user interaction',{},3);
    if(node.clickable==='true'&&node.enabled==='true')return node;
    seen.add(node.nodeIndex);node=tree.nodes.find(n=>n.nodeIndex===node.parentIndex);
  }
  throw new AppError('UI_CHANGED','No enabled clickable ancestor',{},4);
}
export async function tapSelector(ctx,selector,{longPress=false}={}){
  const tree=await hierarchy(ctx),node=selectNode(tree,{...selector,package:ctx.config.package});
  await tap(ctx,actionableNode(tree,node),longPress);
}
export async function touchSelector(ctx,selector){
  // Some apps handle touch in an ancestor without exporting clickable=true.
  // This explicit operation uses the freshly observed element's own bounds.
  const node=selectNode(await hierarchy(ctx),{...selector,package:ctx.config.package});
  const b=node.bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
  if(node.enabled!=='true'||node.password==='true'||!b||b[2]<=b[0]||b[3]<=b[1])throw new AppError('UI_CHANGED','Observed touch target is not enabled or has no usable bounds',{},4);
  await shell(ctx,['input','tap',Math.floor((b[0]+b[2])/2),Math.floor((b[1]+b[3])/2)]);
}
export function validateNativeState(witness){
  if(witness?.kind!=='android-state'||!Array.isArray(witness.all)||!witness.all.length||witness.all.length>16||!Array.isArray(witness.none||[])||(witness.none||[]).length>16)throw new AppError('INVALID_TEST_PLAN','An Android state needs 1-16 positive native selectors');
  for(const selector of [...witness.all,...(witness.none||[])])validateSelector(selector);
}
export function nativeStateMatches(tree,witness){
  validateNativeState(witness);
  return witness.all.every(selector=>selectNodes(tree,selector).length>0)&&(witness.none||[]).every(selector=>selectNodes(tree,selector).length===0);
}
export async function swipeSelector(ctx,selector,direction){
  if(!['up','down','left','right'].includes(direction))throw new AppError('INVALID_INPUT','Unknown swipe direction');
  const node=selectNode(await hierarchy(ctx),{...selector,package:ctx.config.package});
  const b=node.bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
  if(!b||b[2]-b[0]<80||b[3]-b[1]<80)throw new AppError('UI_CHANGED','Swipe target is too small',{},4);
  const [l,t,r,bottom]=b,x=Math.floor((l+r)/2),y=Math.floor((t+bottom)/2),dx=Math.floor((r-l)*0.3),dy=Math.floor((bottom-t)*0.3);
  const points={up:[x,y+dy,x,y-dy],down:[x,y-dy,x,y+dy],left:[x+dx,y,x-dx,y],right:[x-dx,y,x+dx,y]};
  await shell(ctx,['input','swipe',...points[direction],350]);
}
export async function inputText(ctx,selector,text){
  if(typeof text!=='string'||text.length>8192)throw new AppError('INVALID_INPUT','Text must be at most 8192 characters');
  if(Object.hasOwn(selector,'text'))throw new AppError('INVALID_SELECTOR','Use a stable resource-id/class/content-desc selector for text replacement');
  const node=selectNode(await hierarchy(ctx),{...selector,package:ctx.config.package});
  if(node.class!=='android.widget.EditText'||node.password==='true'||node.enabled!=='true')throw new AppError('USER_INPUT_REQUIRED','Only an enabled non-password EditText may be edited',{},3);
  await nativeHelper(ctx,{mode:'text',selector,text});
  // The helper reports dispatch only; always confirm from a new native dump.
  const after=selectNode(await hierarchy(ctx),{...selector,package:ctx.config.package});
  if(after.text!==text)throw new AppError('VERIFICATION_FAILED','Native EditText did not expose the requested text',{},5);
}
