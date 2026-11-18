import {cfg} from '../config.js';import {HttpError} from '../middleware.js';
async function call(url,opt={}){let r;try{r=await fetch(url,{...opt,signal:AbortSignal.timeout(20000)})}catch{throw new HttpError(502,'Could not reach Google','GOOGLE_UNREACHABLE')}return{r,j:await r.json().catch(()=>({}))}}
const form=o=>({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(o)});
export const authUrl=state=>cfg.g.authBase+'?'+new URLSearchParams({client_id:cfg.g.id,redirect_uri:cfg.g.redirect,response_type:'code',scope:'https://www.googleapis.com/auth/gmail.readonly',access_type:'offline',prompt:'consent',include_granted_scopes:'true',state});
export async function exchange(code){const{r,j}=await call(cfg.g.tokenUrl,form({code,client_id:cfg.g.id,client_secret:cfg.g.secret,redirect_uri:cfg.g.redirect,grant_type:'authorization_code'}));if(!r.ok||!j.access_token)throw new HttpError(502,'Google rejected the authorization code','GOOGLE_EXCHANGE');return j}
export async function refresh(rt){const{r,j}=await call(cfg.g.tokenUrl,form({refresh_token:rt,client_id:cfg.g.id,client_secret:cfg.g.secret,grant_type:'refresh_token'}));if(j.error==='invalid_grant')throw new HttpError(409,'Gmail access was revoked. Please reconnect.','GMAIL_REVOKED');if(!r.ok||!j.access_token)throw new HttpError(502,'Could not refresh Gmail access','GOOGLE_REFRESH');return j}
export const revoke=t=>call(cfg.g.revokeUrl,form({token:t})).catch(()=>{});
async function gm(path,at){const{r,j}=await call(cfg.g.apiBase+path,{headers:{Authorization:'Bearer '+at}});
 if(r.status===404)throw new HttpError(404,'Not found',path.includes('/history')?'HISTORY_EXPIRED':'MSG_GONE');
 if(r.status===401||r.status===403)throw new HttpError(409,'Gmail access was revoked or lacks permission. Please reconnect.','GMAIL_REVOKED');
 if(r.status===429)throw new HttpError(429,'Gmail rate limit reached. Try again shortly.','GMAIL_RATE_LIMIT');
 if(!r.ok)throw new HttpError(502,'Gmail API error ('+r.status+')','GMAIL_API');return j}
const e=encodeURIComponent;
export const profile=at=>gm('/users/me/profile',at);
export const listIds=(at,pt)=>gm('/users/me/messages?labelIds=INBOX&maxResults=100'+(pt?'&pageToken='+e(pt):''),at);
export const getMsg=(at,id)=>gm('/users/me/messages/'+e(id)+'?format=full',at);
export const history=(at,h,pt)=>gm('/users/me/history?historyTypes=messageAdded&labelId=INBOX&startHistoryId='+e(h)+(pt?'&pageToken='+e(pt):''),at);
const b64=s=>Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');
// HTML is converted to plain text server-side; raw HTML is never stored or rendered.
const h2t=h=>h.replace(/<(script|style)[\s\S]*?<\/\1>/gi,' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();
export function parseMessage(m){const hd=n=>((m.payload.headers||[]).find(h=>h.name.toLowerCase()===n)||{}).value||'';let plain='',html='';const atts=[];
 (function walk(p){if(!p)return;if(p.filename&&p.body&&p.body.attachmentId)atts.push({filename:p.filename.slice(0,200),mime:p.mimeType,size:p.body.size||0});
  else if(p.mimeType==='text/plain'&&p.body&&p.body.data&&!plain)plain=b64(p.body.data);else if(p.mimeType==='text/html'&&p.body&&p.body.data&&!html)html=b64(p.body.data);(p.parts||[]).forEach(walk)})(m.payload);
 const from=hd('from'),mm=from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/),cl=s=>s.replace(/\u0000/g,'');
 return{gmail_message_id:m.id,gmail_thread_id:m.threadId,sender_name:cl((mm?mm[1].trim():'')||from).slice(0,200)||'Unknown',sender_email:cl(mm?mm[2].trim():from).slice(0,320),recipient:cl(hd('to')).slice(0,500),
  subject:cl(hd('subject')||'(no subject)').slice(0,500),body:cl((plain||h2t(html)||m.snippet||'').slice(0,100000)),received_at:new Date(+m.internalDate||Date.parse(hd('date'))||Date.now()).toISOString(),
  is_read:!(m.labelIds||[]).includes('UNREAD'),has_attachment:atts.length>0,labels:m.labelIds||[],metadata:{attachments:atts}}}
