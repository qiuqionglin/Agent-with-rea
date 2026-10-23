import { AppError } from './sdk.mjs';
export function parseArgs(argv){
  const positional=[],flags={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];if(!arg.startsWith('--')){positional.push(arg);continue;}
    const eq=arg.indexOf('=');const name=arg.slice(2,eq<0?undefined:eq);
    if(Object.hasOwn(flags,name))throw new AppError('INVALID_INPUT','Duplicate option: '+name);
    const boolean=new Set(['help','schema','json','dry-run','version','headed','install','resume','codex-ignore-config']);
    flags[name]=eq>=0?arg.slice(eq+1):!boolean.has(name)&&argv[i+1]!==undefined&&!argv[i+1].startsWith('--')?argv[++i]:true;
  }
  return {positional,flags};
}
export function commandInput(contract,flags){
  const input=flags.input===undefined?{}:JSON.parse(flags.input);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('INVALID_INPUT','--input must be a JSON object');
  const reserved=new Set(['help','schema','json','request-id','expected-revision','dry-run','input']);
  for(const [key,value] of Object.entries(flags)){
    if(reserved.has(key))continue;
    const schema=contract.inputSchema.properties?.[key];if(!schema)throw new AppError('INVALID_INPUT','Unknown option: '+key);
    if(Object.hasOwn(input,key))throw new AppError('INVALID_INPUT','Input provided twice: '+key);
    if(schema.type==='integer'||schema.type==='number')input[key]=typeof value==='boolean'?NaN:Number(value);
    else if(schema.type==='boolean'){if(![true,false,'true','false'].includes(value))throw new AppError('INVALID_INPUT','Expected boolean: '+key);input[key]=value===true||value==='true';}
    else if(['object','array'].includes(schema.type))input[key]=JSON.parse(value);
    else{if(typeof value!=='string')throw new AppError('INVALID_INPUT','Missing value: '+key);input[key]=value;}
  }
  return input;
}
