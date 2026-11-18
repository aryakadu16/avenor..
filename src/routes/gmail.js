import {Router} from 'express';import rateLimit from 'express-rate-limit';import crypto from 'node:crypto';import {z} from 'zod';
import {cfg} from '../config.js';import {HttpError,wrap,validate} from '../middleware.js';import {enc,dec} from '../services/crypto.js';import * as G from '../services/google.js';
import {runSync} from '../services/sync.js';import {processPending} from '../services/processing.js';import {getSvc} from '../services/svc.js';
export const pub=Router(),priv=Router();const ok=(s,d)=>s.json({data:d});
const missing=()=>[['GOOGLE_CLIENT_ID',cfg.g.id],['GOOGLE_CLIENT_SECRET',cfg.g.secret],['GOOGLE_REDIRECT_URI',cfg.g.redirect],['TOKEN_ENC_KEY',cfg.encKey],['SUPABASE_SERVICE_ROLE_KEY',cfg.sbSvc],['FRONTEND_URL',cfg.frontendUrl]].filter(x=>!x[1]).map(x=>x[0]);
const needG=(q,s,n)=>missing().length?n(new HttpError(503,'Gmail integration is not configured on the server (missing: '+missing().join(', ')+')','NOT_CONFIGURED')):n();
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const back=(s,h)=>s.redirect(302,cfg.frontendUrl.replace(/#.*$/,'')+'#'+h);
const lim=(n)=>rateLimit({windowMs:60000,limit:n,standardHeaders:true,legacyHeaders:false,message:{error:{message:'Too many requests',code:'RATE_LIMIT'}}});
// Public: Google redirects the browser here (no bearer token). Identity comes from the single-use, expiring, hashed `state` created for an authenticated user.
pub.get('/callback',wrap(async(q,s)=>{if(missing().length)return s.status(503).send('Gmail integration is not configured');
 const{code,state,error}=q.query;if(typeof state!=='string'||!/^[A-Za-z0-9_-]{20,100}$/.test(state))return back(s,'gmail-error');
 const svc=getSvc(),h=sha(state),st=(await svc.from('oauth_states').select('*').eq('state_hash',h).maybeSingle()).data;
 if(!st)return back(s,'gmail-error');await svc.from('oauth_states').delete().eq('state_hash',h);if(new Date(st.expires_at)<new Date())return back(s,'gmail-error');
 if(error)return back(s,error==='access_denied'?'gmail-denied':'gmail-error');if(typeof code!=='string'||code.length>2000)return back(s,'gmail-error');
 try{const t=await G.exchange(code),prof=await G.profile(t.access_token),ex=(await svc.from('gmail_connections').select('refresh_token_enc').eq('user_id',st.user_id).maybeSingle()).data;
  const rt=t.refresh_token?enc(t.refresh_token):ex&&ex.refresh_token_enc;if(!rt)return back(s,'gmail-error');
  const r=await svc.from('gmail_connections').upsert({user_id:st.user_id,google_email:prof.emailAddress,refresh_token_enc:rt,scopes:t.scope||'',status:'connected',history_id:null,last_synced_at:null,last_error:null},{onConflict:'user_id'});if(r.error)throw new Error('db');
  back(s,'gmail-connected')}catch(e){console.error('[gmail-callback]',e.code||e.name);back(s,'gmail-error')}}));
priv.get('/gmail/status',wrap(async(q,s)=>{const m=missing();let c=null;if(!m.length)c=(await getSvc().from('gmail_connections').select('google_email,status,last_synced_at,last_error').eq('user_id',q.user.id).maybeSingle()).data;
 ok(s,{configured:!m.length,missing:m,connected:!!c&&c.status==='connected',status:c?c.status:'not_connected',googleEmail:c?c.google_email:null,lastSyncedAt:c?c.last_synced_at:null,lastError:c?c.last_error:null})}));
priv.post('/gmail/connect',lim(10),needG,wrap(async(q,s)=>{const svc=getSvc(),state=crypto.randomBytes(32).toString('base64url');
 await svc.from('oauth_states').delete().lt('expires_at',new Date().toISOString());
 const r=await svc.from('oauth_states').insert({state_hash:sha(state),user_id:q.user.id,expires_at:new Date(Date.now()+10*60000).toISOString()});if(r.error)throw new HttpError(500,'Database error');ok(s,{url:G.authUrl(state).toString()})}));
priv.post('/gmail/sync',lim(6),needG,validate(z.object({full:z.boolean().optional()}).strict()),wrap(async(q,s)=>{
 const r=await runSync({svc:getSvc(),db:q.db,userId:q.user.id,full:!!q.valid.body.full});
 await q.db.from('activity_history').insert({user_id:q.user.id,type:'sync',description:`Gmail sync (${r.mode}): ${r.imported} new emails`});ok(s,r)}));
priv.delete('/gmail/connection',needG,wrap(async(q,s)=>{const svc=getSvc(),c=(await svc.from('gmail_connections').select('refresh_token_enc').eq('user_id',q.user.id).maybeSingle()).data;
 if(c){try{await G.revoke(dec(c.refresh_token_enc))}catch(e){}await svc.from('gmail_connections').delete().eq('user_id',q.user.id)}
 if(q.query.purge==='1')await q.db.from('emails').delete().not('gmail_message_id','is',null);
 await q.db.from('activity_history').insert({user_id:q.user.id,type:'gmail',description:'Disconnected Gmail'});ok(s,{disconnected:true})}));
priv.post('/ai/process-pending',lim(20),validate(z.object({limit:z.number().int().min(1).max(25).optional()}).strict()),wrap(async(q,s)=>ok(s,await processPending(q.db,q.user.id,q.valid.body.limit||10))));
