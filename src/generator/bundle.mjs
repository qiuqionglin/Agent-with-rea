import {isBuiltin} from 'node:module';
import {dirname,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {init,parse} from 'es-module-lexer';
import {AppError,readJson} from '../utils.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
// Non-module resources used by the runtime. Keep them with their owning driver.
const assets={
  'src/runtime/manifest.mjs':['schemas/adapter.schema.json'],
  'src/drivers/android/index.mjs':['src/drivers/android/text.py']
};
const nameOf=file=>relative(root,file).split(sep).join('/');
const runtimeFile=name=>name==='src/sdk.mjs'||name==='src/utils.mjs'||name==='schemas/adapter.schema.json'||name.startsWith('src/runtime/')||name.startsWith('src/drivers/')||name.startsWith('lib/');

// Read import syntax without evaluating an adapter. A virtual adapters/<id>
// location preserves the relative SDK imports used by accepted older outputs.
export async function runtimeBundle(adapter){
  await init;
  const core=await readJson(resolve(root,'package.json'));
  const files=new Set(),dependencies={},imports={};

  async function dependency(specifier,importer){
    if(isBuiltin(specifier))return;
    if(specifier.startsWith('#')){
      const target=core.imports?.[specifier];
      if(typeof target!=='string')throw new AppError('UNSUPPORTED_ADAPTER_IMPORT','Unknown SDK import',{specifier});
      imports[specifier]=target;return visit(resolve(root,target));
    }
    if(specifier.startsWith('.'))return visit(resolve(dirname(importer),specifier));
    const name=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
    if(!core.dependencies[name])throw new AppError('UNSUPPORTED_ADAPTER_IMPORT','Adapters may use the SDK and declared dependencies',{specifier});
    dependencies[name]=core.dependencies[name];
  }

  async function scan(source,importer,{adapterSource=false}={}){
    let requests;
    try{[requests]=parse(source,nameOf(importer));}
    catch{throw new AppError('INVALID_ADAPTER','Adapter or runtime module has invalid import syntax');}
    for(const request of requests){
      if(request.d===-2)continue; // import.meta is not an import request.
      if(request.n===undefined){
        // The kernel imports the selected, digest-checked adapter at runtime.
        if(!adapterSource&&nameOf(importer)==='src/runtime/execute.mjs')continue;
        throw new AppError('UNSUPPORTED_ADAPTER_IMPORT','Use literal module imports so the CLI can be packaged independently');
      }
      await dependency(request.n,importer);
    }
  }

  async function visit(file){
    const name=nameOf(file);
    if(!runtimeFile(name))throw new AppError('UNSUPPORTED_ADAPTER_IMPORT','Generated CLIs cannot depend on generation or verification code',{module:name});
    if(files.has(name))return;
    files.add(name);
    const source=await readFile(file,'utf8');
    if(file.endsWith('.mjs'))await scan(source,file);
    for(const asset of assets[name]||[])await visit(resolve(root,asset));
  }

  await visit(resolve(root,'src/runtime/cli.mjs'));
  await scan(adapter.source.toString('utf8'),resolve(root,'adapters',adapter.manifest.id,'adapter.mjs'),{adapterSource:true});
  return {files:[...files].sort(),dependencies,imports};
}
