import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hash } from '../src/sdk.mjs';
const directory=resolve('.local/android');await mkdir(directory,{recursive:true});
const assets=[
  {name:'calculator.apk',url:'https://github.com/FossifyOrg/Calculator/releases/download/1.4.0/calculator-10-foss-release.apk',sha256:'7c5443c22d6d62c67dfe80df33ea9161ff0fa440f92590bcb45d7008b57613ed'},
  {name:'jadx.jar',url:'https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar',sha256:'6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75'},
];
for(const asset of assets){const path=resolve(directory,asset.name);let bytes;try{bytes=await readFile(path);}catch{}
  if(!bytes||hash(bytes)!==asset.sha256){console.error('Downloading '+asset.name);const r=await fetch(asset.url,{signal:AbortSignal.timeout(300000)});if(!r.ok)throw Error('Download failed: '+r.status);bytes=Buffer.from(await r.arrayBuffer());if(hash(bytes)!==asset.sha256)throw Error('Digest mismatch: '+asset.name);await writeFile(path,bytes);}
  console.log(JSON.stringify({file:path,sha256:asset.sha256,verified:true}));
}
