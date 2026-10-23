import http from 'node:http';
import { mkdir,readFile,writeFile,stat } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { hash,writeJson,sleep } from '../lib/sdk.mjs';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),store=resolve(root,'.local/web');await mkdir(store,{recursive:true});
const base='https://raw.githubusercontent.com/tastejs/todomvc/ff43b02e59dfa604386bb382034b2cd07c2bcd8a/';
const assets=[['index.html','examples/knockoutjs/index.html','6f152959d63c670e9d926a68e977f5bf4865d95fc40765f8072158dd6be56dbb'],['js/app.js','examples/knockoutjs/js/app.js','fc01edc03a90a4e7569755bc3b8ab7b5015768980cdfebfaa4251f55c894a698'],['license.md','license.md','32238c5c6759b589ea768661b6eb0fcb42449b74d57cdf09928743f2e1eb748d']];
for(const [file,upstream,digest] of assets){const path=resolve(store,'source',file);let bytes;try{bytes=await readFile(path);}catch{}if(!bytes||hash(bytes)!==digest){const r=await fetch(base+upstream);if(!r.ok)throw Error('Upstream download failed');bytes=Buffer.from(await r.arrayBuffer());if(hash(bytes)!==digest)throw Error('Upstream source changed');await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://127.0.0.1').pathname;let file;
  if(path.startsWith('/node_modules/')){const [pkg,...rest]=path.slice(14).split('/');if(!['director','knockout','todomvc-common','todomvc-app-css'].includes(pkg))throw Error();const dir=dirname(require.resolve(pkg+'/package.json'));file=resolve(dir,rest.join('/'));if(!file.startsWith(dir+'/'))throw Error();}
  else{const dir=resolve(store,'source');file=resolve(dir,path==='/'?'index.html':path.slice(1));if(!file.startsWith(dir+'/'))throw Error();}
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime['.'+file.split('.').at(-1)]||'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404);res.end('Not found');}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4317,'127.0.0.1',resolve);});
const context=await chromium.launchPersistentContext(resolve(store,'profile'),{...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:!process.env.HEADED,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,args:['--remote-debugging-port=9377','--remote-debugging-address=127.0.0.1','--no-first-run']});
const page=context.pages()[0]||await context.newPage();await page.goto('http://127.0.0.1:4317/');await page.waitForFunction('Boolean(window.ko && ko.dataFor(document.body))');
const cdp=await context.newCDPSession(page);const {targetInfo}=await cdp.send('Target.getTargetInfo');await cdp.detach();await writeJson(resolve(store,'session.json'),{pid:process.pid,url:page.url(),cdp:'http://127.0.0.1:9377',target:targetInfo.targetId});
console.log('READY http://127.0.0.1:4317/ | APP2CLI_CDP=http://127.0.0.1:9377');
let closing=false;async function close(){if(closing)return;closing=true;await sleep(6000);await context.close();server.close();process.exit(0);}process.on('SIGTERM',close);process.on('SIGINT',close);
