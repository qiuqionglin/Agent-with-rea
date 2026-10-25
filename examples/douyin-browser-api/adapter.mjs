import {connectBrowserApi,browserTargetKey,checkBrowserApi,callBrowserApi} from '../../lib/browser-api.mjs';
import {AppError,hash,canonical} from '../../lib/sdk.mjs';
export default {
  targetKey:browserTargetKey,
  async connect(env,config){
    if(!/^[a-f0-9]{64}$/.test(env.APP2CLI_ACCOUNT_HASH||''))throw new AppError('SESSION_REQUIRED','Set the previously verified account hash; do not supply account credentials');
    const ctx=await connectBrowserApi(env,config);ctx.accountHash=env.APP2CLI_ACCOUNT_HASH;return ctx;
  },
  check:checkBrowserApi,
  async read(ctx){
    const profile=await callBrowserApi(ctx,'profile');
    const uid=profile.data.user?.uid;
    if(!uid||hash('douyin:'+uid)!==ctx.accountHash)throw new AppError('ACCOUNT_CHANGED','Client session does not match the caller-pinned account',{},4);
    const list=await callBrowserApi(ctx,'collections',[{cursor:0,offset:12}]);
    if(list.data.has_more)throw new AppError('PAGINATION_REQUIRED','This bounded reader does not yet support collection pagination',{},3);
    const items=(list.data.collects_list||[]).map(x=>({id:x.collects_id_str,name:x.collects_name,visibility:x.status,videoCount:x.total_number??0}));
    const mapped=(list.clientResult?.data||[]).map(x=>({id:x.collectionFolderId,name:x.collectionFolderName,visibility:x.status,videoCount:x.videoTotal??0}));
    if(list.clientResult?.statusCode!==0||canonical(items)!==canonical(mapped))throw new AppError('RESPONSE_SCHEMA_CHANGED','Native client mapping differs from the observed backend response',{},4);
    return {scopeKey:'douyin:'+ctx.accountHash,data:{authenticated:true,items},proof:{transport:'browser-api',requiresBrowser:true,uiActions:0,responses:[profile.proof,list.proof]}};
  },
  plan(){throw new AppError('READ_ONLY','This example only declares backend reads');},
  dispatch(){throw new AppError('READ_ONLY','This example only declares backend reads');},
  matches(){return false;},
  async refresh(){},
  result(command,input,snapshot){return command==='profile.status'?{authenticated:snapshot.data.authenticated}:snapshot.data;},
  async close(ctx){await ctx.browser.close();}
};
