// MOCK of the Supabase endpoints AVENOR uses (GoTrue + one PostgREST table). For tests only: NOT real Supabase.
import http from 'node:http';import {randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
export function startMock(port=0){const users=new Map(),tokens=new Map(),refresh=new Map();
 const pub=u=>({id:u.id,aud:'authenticated',role:'authenticated',email:u.email,user_metadata:{full_name:u.name},app_metadata:{},identities:[{id:u.id}],created_at:new Date().toISOString()});
 const mk=u=>{const a='at_'+randomUUID(),r='rt_'+randomUUID();tokens.set(a,u.id);refresh.set(r,u.id);return{access_token:a,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:r,user:pub(u)}};
 const byId=id=>[...users.values()].find(u=>u.id==id);
 const srv=http.createServer(async(q,s)=>{const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'};
  if(q.method=='OPTIONS'){s.writeHead(204,cors);return s.end()}
  let b='';for await(const c of q)b+=c;const j=b?JSON.parse(b):{},u=new URL(q.url,'http://x'),tok=(q.headers.authorization||'').replace('Bearer ',''),me=byId(tokens.get(tok));
  const send=(st,o)=>{s.writeHead(st,{...cors,'Content-Type':'application/json'});s.end(o===undefined?'':JSON.stringify(o))};
  const em=(j.email||'').toLowerCase();
  if(u.pathname=='/auth/v1/signup'){if(users.has(em))return send(422,{code:422,error_code:'user_already_exists',msg:'User already registered'});
   const n={id:randomUUID(),email:em,password:j.password,name:(j.data||{}).full_name||''};users.set(em,n);return send(200,mk(n))}
  if(u.pathname=='/auth/v1/token'){const g=u.searchParams.get('grant_type');
   if(g=='password'){const n=users.get(em);return n&&n.password==j.password?send(200,mk(n)):send(400,{code:400,error_code:'invalid_credentials',msg:'Invalid login credentials'})}
   if(g=='refresh_token'){const n=byId(refresh.get(j.refresh_token));return n?send(200,mk(n)):send(400,{code:400,error_code:'refresh_token_not_found',msg:'Invalid Refresh Token'})}}
  if(u.pathname=='/auth/v1/user')return me?send(200,pub(me)):send(401,{code:401,error_code:'bad_jwt',msg:'invalid JWT'});
  if(u.pathname=='/auth/v1/logout'){tokens.delete(tok);return send(204)}
  if(u.pathname=='/rest/v1/profiles')return me?send(200,{id:me.id,full_name:me.name+' (profile)',email:me.email}):send(401,{message:'JWT invalid'});
  send(404,{msg:'mock: not found'})});
 return new Promise(r=>srv.listen(port,'127.0.0.1',()=>r(srv)))}
if(import.meta.url===pathToFileURL(process.argv[1]).href)startMock(+process.argv[2]||54321).then(s=>console.log('mock supabase on',s.address().port));
