const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceUpsert } = require('../../lib/supabase');
const { runKnowledgeBaseSync, readItems, KB_SETTINGS_KEY } = require('../../services/quickbaseSync');
function sendJson(res,s,b){res.statusCode=s;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(b));}
function isSuperAdmin(p){const r=String(p&&p.role||'').toUpperCase().replace(/\s+/g,'_');return r==='SUPER_ADMIN'||r==='SA'||r==='SUPERADMIN';}
async function loadSettings(){const o=await serviceSelect('mums_documents',`select=key,value&key=eq.${encodeURIComponent(KB_SETTINGS_KEY)}&limit=1`);if(!o.ok)return{};const row=Array.isArray(o.json)&&o.json[0]?o.json[0]:null;return row&&row.value&&typeof row.value==='object'?row.value:{};}
module.exports=async(req,res)=>{try{res.setHeader('Cache-Control','no-store');const auth=req.headers.authorization||'';const jwt=auth.toLowerCase().startsWith('bearer ')?auth.slice(7):'';const user=await getUserFromJwt(jwt);if(!user)return sendJson(res,401,{ok:false,error:'unauthorized'});const profile=await getProfileForUserId(user.id);const m=String(req.method||'GET').toUpperCase();
if(m==='GET'){
  // Support optional ?table= filter for per-table view
  const tableFilter=String((req.query&&req.query.table)||'').trim();
  const out=await readItems();
  if(!out.ok)return sendJson(res,500,{ok:false,error:'read_failed'});
  let items=out.items||[];
  if(tableFilter) items=items.filter(it=>String(it.table_id||it.table_name||'').toLowerCase().includes(tableFilter.toLowerCase()));
  return sendJson(res,200,{ok:true,items,count:items.length,tables:out.tables||[],syncedAt:out.syncedAt||null});
}
if(m==='POST'){
  if(!isSuperAdmin(profile))return sendJson(res,403,{ok:false,error:'forbidden'});
  const syncOut=await runKnowledgeBaseSync({actorName:profile&&(profile.name||profile.username)||'system'});
  const cur=await loadSettings();
  await serviceUpsert('mums_documents',[{key:KB_SETTINGS_KEY,value:{...cur,lastSyncedAt:syncOut.syncedAt},updated_at:new Date().toISOString(),updated_by_name:profile&&(profile.name||profile.username)||null,updated_by_user_id:String(user.id||'')}],'key').catch(()=>{});
  return sendJson(res,200,{ok:true,count:syncOut.count,tables:syncOut.tables||[],syncedAt:syncOut.syncedAt});
}
return sendJson(res,405,{ok:false,error:'method_not_allowed'});}catch(err){console.error('[studio/kb_sync]',err);return sendJson(res,500,{ok:false,error:'sync_failed',message:String(err&&err.message||err)});}};
