#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { main,runAppCli } from '../lib/app-cli.mjs';
import { parseArgs } from '../lib/arguments.mjs';
import { readJson,AppError } from '../lib/sdk.mjs';
import { inspect } from '../lib/inspect.mjs';
import { build } from '../lib/build.mjs';
import { scaffold } from '../lib/scaffold.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
await main(async()=>{
  const argv=process.argv.slice(2),{positional:p,flags}=parseArgs(argv);
  if(p[0]==='run')return runAppCli(resolve(argv[1]),argv.slice(2));
  if(!p.length||flags.help)return {ok:true,name:'app2cli',version:'0.1.0',commands:{list:'List bundled adapter recipes',inspect:'inspect web <cdp-url> --target <id> --out <evidence-dir> | inspect android <apk> --class <class> --method <method> --out <dir>',scaffold:'scaffold --id <name> --evidence <dir> --out <new-adapter-dir>',build:'build <adapter-dir> --evidence <dir> --out <package-dir>',run:'run <adapter-dir> <command> [--input JSON | named flags]'},support:{web:'native browser function adapter',android:'APK analysis plus native UI adapter'},scope:'REA evidence and authored semantic mappings compile to per-app CLIs; no claim of automatic arbitrary-app support'};
  if(p[0]==='list'){const apps=[];for(const id of await readdir(resolve(root,'adapters'))){const m=await readJson(resolve(root,'adapters',id,'adapter.json'));apps.push({id:m.id,platform:m.platform,commands:Object.keys(m.commands),description:m.description});}return {ok:true,apps};}
  if(p[0]==='inspect')return inspect(p[1],p[2],flags);
  if(p[0]==='scaffold')return scaffold(flags);
  if(p[0]==='build')return build(p[1],flags);
  throw new AppError('UNKNOWN_COMMAND','Use app2cli --help');
});
