import assert from 'node:assert/strict';
import { readdir,readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const roots=['bin','src','lib','schemas','examples','docs','scripts','test','.github'];let count=0;
async function visit(path){
  for(const entry of await readdir(path,{withFileTypes:true})){
    const name=path+'/'+entry.name;if(entry.isDirectory()){await visit(name);continue;}
    assert.ok(!/\.(apk|jar|tgz)$/.test(name),'Downloaded artifacts must not ship');
    if(!/\.(mjs|py|json|md|ya?ml|txt)$/.test(name))continue;
    const text=await readFile(name,'utf8');assert.ok(!/\/Users\/[^/\s]+\//.test(text),'Machine-specific path in '+name);
    assert.ok(!/Bearer\s+[a-f0-9]{32,}/i.test(text),'Literal token in '+name);
    if(name.endsWith('.mjs'))execFileSync(process.execPath,['--check',name],{stdio:'pipe'});
    if(name.endsWith('.py'))execFileSync('python3',['-c','import ast,sys; ast.parse(open(sys.argv[1]).read())',name],{stdio:'pipe'});count++;
  }
}
for(const root of roots)await visit(root);
const i=process.argv.indexOf('--tarball');let packed=0;
if(i>=0){const files=execFileSync('tar',['-tzf',resolve(process.argv[i+1])],{encoding:'utf8'}).trim().split('\n');for(const file of files){assert.ok(!/(^|\/)\.(local|runtime|git|env)(\/|$)/.test(file),file);assert.ok(!/(^|\/)(node_modules|browser-profile|evidence|__pycache__)(\/|$)/.test(file),file);assert.ok(!/\.(apk|jar|pyc)$/.test(file),file);}packed=files.length;}
console.log(JSON.stringify({ok:true,sourceFilesChecked:count,packedFilesChecked:packed,privateRuntimeFilesExcluded:true}));
