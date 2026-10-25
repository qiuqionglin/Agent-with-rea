import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import {existsSync} from 'node:fs';
import { runAppCli } from './runtime/cli.mjs';
import { parseArgs } from './runtime/arguments.mjs';
import { readJson,AppError } from './sdk.mjs';
import { inspect } from './generator/discover.mjs';
import { build,scaffold } from './generator/build.mjs';
import {generate} from './generator/index.mjs';
import { verifyGeneration } from './verify/index.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const legacyExamples={
  "adapters/todomvc": "examples/todomvc",
  "adapters/fossify-calculator": "examples/fossify-calculator",
  "examples/booker-api-generated": "examples/booker-api",
  "examples/dillinger-generated": "examples/dillinger",
  "examples/douyin-browser-api": "examples/douyin-web",
  "examples/douyin-generated": "examples/douyin-android",
  "examples/editor-generated": "examples/editor",
  "examples/linkding-generated": "examples/linkding",
  "examples/marktext-generated": "examples/marktext"
};
function adapterDirectory(value){
  const path=resolve(value),relative=path.startsWith(root)?path.slice(root.length):null;
  if(existsSync(path))return path;
  const name=legacyExamples[relative]||legacyExamples[value]||value;
  const bundled=resolve(root,name);
  return name.startsWith('examples/')&&bundled.startsWith(resolve(root,'examples')+'/')&&existsSync(bundled)?bundled:path;
}
export async function run(argv){
  const {positional:p,flags}=parseArgs(argv);
  if(p[0]==='run')return runAppCli(adapterDirectory(argv[1]),argv.slice(2));
  if(!p.length||flags.help)return {ok:true,name:'app2cli',version:'0.1.0',commands:{list:'List bundled adapter recipes',verify:'verify <completed-run-dir> --out <new-report-dir>',generate:'generate <url|app|apk> [--out <new-run-dir>] [--scenario application --max-rounds 12] [--prepare-only] [--id name] [--goal text] [--transport http --capture requests.har --api-case owned.json | --allow-ui-fallback] [--max-attempts 4] [--resume] [--scenario android-journey] [--seed passed-run] [--require-step command] [--reviewed-plan file] [--analysis-evidence dir] [--navigation-probes file] [--agent-model model --agent-effort high] [--codex-ignore-config] [--cdp url --target id | --serial id --install]',inspect:'inspect web <cdp-url> --target <id> --out <evidence-dir> | inspect android <apk> --class <class> --method <method> --out <dir>',scaffold:'scaffold --id <name> --evidence <dir> --out <new-adapter-dir>',build:'build <adapter-dir> --evidence <dir> --out <package-dir>',run:'run <adapter-dir> <command> [--input JSON | named flags]'},support:{electron:'macOS .app discovery, source-pinned client/IPC bridge, native renderer and file verification',application:'URL or .app without supplied HAR/API case; multi-command discovery and repair',http:'REA network capture plus agent-generated HTTP adapters and independent server GET',web:'REA plus agent-generated browser adapters',android:'REA APK analysis plus agent-generated native UI adapters'},scope:'Bounded generate/test/repair loop; success requires real independent readback. Not every app admits a supported reversible scenario.'};
  if(p[0]==='list'){const apps=[];for(const entry of await readdir(resolve(root,'examples'),{withFileTypes:true})){if(!entry.isDirectory())continue;const m=await readJson(resolve(root,'examples',entry.name,'adapter.json'));apps.push({id:m.id,directory:'examples/'+entry.name,platform:m.platform,commands:Object.keys(m.commands),description:m.description});}return {ok:true,apps};}
  if(p[0]==='inspect')return inspect(p[1],p[2],flags);
  if(p[0]==='scaffold')return scaffold(flags);
  if(p[0]==='generate')return generate(p[1],flags);
  if(p[0]==='verify')return verifyGeneration(p[1],flags);
  if(p[0]==='build')return build(adapterDirectory(p[1]),flags);
  throw new AppError('UNKNOWN_COMMAND','Use app2cli --help');
}
