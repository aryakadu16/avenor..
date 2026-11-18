import * as G from './google.js';import {dec} from './crypto.js';import {HttpError} from '../middleware.js';
async function accessToken(svc,conn){try{return(await G.refresh(dec(conn.refresh_token_enc))).access_token}catch(e){
 if(e.code==='GMAIL_REVOKED')await svc.from('gmail_connections').update({status:'revoked',last_error:'Access was revoked. Reconnect Gmail.'}).eq('user_id',conn.user_id);throw e}}
export async function runSync({svc,db,userId,full=false,max=200}){
 const conn=(await svc.from('gmail_connections').select('*').eq('user_id',userId).maybeSingle()).data;
 if(!conn||conn.status!=='connected')throw new HttpError(409,conn&&conn.status==='revoked'?'Gmail access was revoked. Please reconnect.':'Gmail is not connected','GMAIL_NOT_CONNECTED');
 const at=await accessToken(svc,conn);let ids=[],hid=conn.history_id,mode='incremental';
 if(!full&&hid){try{let pt;do{const h=await G.history(at,hid,pt);(h.history||[]).forEach(x=>(x.messagesAdded||[]).forEach(m=>ids.push(m.message.id)));hid=h.historyId||hid;pt=h.nextPageToken}while(pt)}
  catch(e){if(e.code==='HISTORY_EXPIRED'){full=true;ids=[]}else throw e}}
 if(full||!conn.history_id){mode='full';hid=(await G.profile(at)).historyId;ids=[];let pt;do{const l=await G.listIds(at,pt);(l.messages||[]).forEach(m=>ids.push(m.id));pt=l.nextPageToken}while(pt&&ids.length<max);ids=ids.slice(0,max)}
 ids=[...new Set(ids)];const have=new Set();
 for(let i=0;i<ids.length;i+=100){const r=await db.from('emails').select('gmail_message_id').in('gmail_message_id',ids.slice(i,i+100));if(r.error)throw new HttpError(500,'Database error');r.data.forEach(x=>have.add(x.gmail_message_id))}
 const fresh=ids.filter(i=>!have.has(i)),rows=[];
 for(let i=0;i<fresh.length;i+=5){const part=await Promise.all(fresh.slice(i,i+5).map(id=>G.getMsg(at,id).then(m=>G.parseMessage(m),e=>e.code==='MSG_GONE'?null:Promise.reject(e))));part.forEach(p=>p&&rows.push({...p,user_id:userId}))}
 if(rows.length){const r=await db.from('emails').upsert(rows,{onConflict:'user_id,gmail_message_id',ignoreDuplicates:true});if(r.error){console.error('[sync-db]',r.error.code);throw new HttpError(500,'Database error')}}
 await svc.from('gmail_connections').update({history_id:hid,last_synced_at:new Date().toISOString(),last_error:null}).eq('user_id',userId);
 return{mode,imported:rows.length,skipped:ids.length-rows.length}}
