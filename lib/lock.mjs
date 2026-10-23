import { mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AppError } from './sdk.mjs';
export async function withLock(path,fn){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  try{await mkdir(path,{mode:0o700});}catch(e){
    if(e.code!=='EEXIST')throw e;
    throw new AppError('SESSION_BUSY','Another command owns this session; retry later. A stale lock requires inspection.',{lock:path},3);
  }
  try{await writeFile(path+'/owner.json',JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{mode:0o600});return await fn();}
  finally{await rm(path,{recursive:true,force:true});}
}
