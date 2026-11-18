import {createClient} from '@supabase/supabase-js';
import {cfg} from './config.js';
export class HttpError extends Error{constructor(s,m,c,d){super(m);this.status=s;this.code=c;this.details=d}}
export const wrap=f=>(q,s,n)=>Promise.resolve(f(q,s,n)).catch(n);
const opt={auth:{persistSession:false,autoRefreshToken:false}};
export const needSb=(q,s,n)=>cfg.sbUrl&&cfg.sbAnon?n():n(new HttpError(503,'Supabase is not configured on the server','NOT_CONFIGURED'));
export const auth=wrap(async(q,s,n)=>{
 const t=(q.headers.authorization||'').match(/^Bearer (.+)$/)?.[1];
 if(!t)throw new HttpError(401,'Authentication required','NO_TOKEN');
 const {data,error}=await createClient(cfg.sbUrl,cfg.sbAnon,opt).auth.getUser(t);
 if(error&&(!error.status||error.status>=500))throw new HttpError(503,'Authentication service unreachable','AUTH_UNAVAILABLE');
 if(error||!data?.user)throw new HttpError(401,'Invalid or expired session','BAD_TOKEN');
 q.user=data.user; // per-request client carries the user's JWT, so Postgres RLS enforces ownership
 q.db=createClient(cfg.sbUrl,cfg.sbAnon,{...opt,global:{headers:{Authorization:'Bearer '+t}}});n()});
export const validate=(schema,where='body')=>(q,s,n)=>{const r=schema.safeParse(q[where]);
 if(!r.success)return n(new HttpError(400,'Invalid request','VALIDATION',r.error.issues.map(i=>i.path.join('.')+': '+i.message)));
 q.valid={...q.valid,[where]:r.data};n()};
export const notFound=(q,s,n)=>n(new HttpError(404,'Route not found','NOT_FOUND'));
export const errors=(e,q,s,n)=>{const st=e.status||500;if(st==500)console.error('[error]',e.code||e.name);
 s.status(st).json({error:{message:st==500?'Internal server error':e.message,code:e.code,details:e.details}})};
