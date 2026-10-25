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
import {generateApplication} from '../lib/application-generate.mjs';
import { generate } from '../lib/generate.mjs';
import { verifyGeneration } from '../lib/verify.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
await main(async()=>{
  const argv=process.argv.slice(2),{positional:p,flags}=parseArgs(argv);
  if(p[0]==='run')return runAppCli(resolve(argv[1]),argv.slice(2));
  if(!p.length||flags.help)return {ok:true,name:'app2cli',version:'0.1.0',commands:{list:'List bundled adapter recipes',verify:'verify <completed-run-dir> --out <new-report-dir>',generate:'generate <url|app|apk> [--out <new-run-dir>] [--scenario application --max-rounds 12] [--prepare-only] [--id name] [--goal text] [--transport http --capture requests.har --api-case owned.json | --allow-ui-fallback] [--max-attempts 4] [--resume] [--scenario android-journey] [--seed passed-run] [--require-step command] [--reviewed-plan file] [--analysis-evidence dir] [--navigation-probes file] [--agent-model model --agent-effort high] [--codex-ignore-config] [--cdp url --target id | --serial id --install]',inspect:'inspect web <cdp-url> --target <id> --out <evidence-dir> | inspect android <apk> --class <class> --method <method> --out <dir>',scaffold:'scaffold --id <name> --evidence <dir> --out <new-adapter-dir>',build:'build <adapter-dir> --evidence <dir> --out <package-dir>',run:'run <adapter-dir> <command> [--input JSON | named flags]'},support:{electron:'macOS .app discovery, source-pinned client/IPC bridge, native renderer and file verification',application:'URL or .app without supplied HAR/API case; multi-command discovery and repair',http:'REA network capture plus agent-generated HTTP adapters and independent server GET',web:'REA plus agent-generated browser adapters',android:'REA APK analysis plus agent-generated native UI adapters'},scope:'Bounded generate/test/repair loop; success requires real independent readback. Not every app admits a supported reversible scenario.'};
  if(p[0]==='list'){const apps=[];for(const id of await readdir(resolve(root,'adapters'))){const m=await readJson(resolve(root,'adapters',id,'adapter.json'));apps.push({id:m.id,platform:m.platform,commands:Object.keys(m.commands),description:m.description});}return {ok:true,apps};}
  if(p[0]==='inspect')return inspect(p[1],p[2],flags);
  if(p[0]==='scaffold')return scaffold(flags);
  if(p[0]==='generate')return flags.scenario==='application'||p[1]?.endsWith('.app')||(/^https?:\/\//.test(p[1]||'')&&!flags.scenario&&!flags.capture&&!flags['api-case']&&(!flags.transport||['auto','browser-api'].includes(flags.transport))&&!flags['allow-ui-fallback'])?generateApplication(p[1],flags):generate(p[1],flags);
  if(p[0]==='verify')return verifyGeneration(p[1],flags);
  if(p[0]==='build')return build(p[1],flags);
  throw new AppError('UNKNOWN_COMMAND','Use app2cli --help');
});
