import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {prepareWeb} from '../drivers/web/launch.mjs';
import {prepareElectron} from '../drivers/electron/launch.mjs';
export {prepareWeb};
export {selectedPage} from '../drivers/web/session.mjs';
export {prepareAndroid} from './android.mjs';
export {snapshot} from '../verify/snapshot.mjs';

export async function prepareApplication(target,out,flags={}){
  const workspace=resolve(out,'workspace');await mkdir(workspace,{recursive:true,mode:0o700});
  if(/^https?:\/\//.test(target)){const session=await prepareWeb(target,out,flags);session.environment.APP2CLI_WORKSPACE=workspace;return session;}
  return prepareElectron(target,out,{...flags,workspace});
}
