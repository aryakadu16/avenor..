import {Router} from 'express';import {z} from 'zod';import rateLimit from 'express-rate-limit';
import {auth,needSb,validate,wrap,HttpError} from '../middleware.js';import {analyse} from '../services/ai.js';import {cfg} from '../config.js';
const r=Router(),ok=(s,d,st=200)=>s.status(st).json({data:d});
const must=x=>{if(x.error){if(x.error.code=='PGRST116')throw new HttpError(404,'Not found','NOT_FOUND');console.error('[db]',x.error.code);throw new HttpError(500,'Database error')}return x.data};
const act=(q,type,description,rid)=>q.db.from('activity_history').insert({user_id:q.user.id,type,description,related_id:rid||null});
const note=(q,type,title,message,rid)=>q.db.from('notifications').insert({user_id:q.user.id,type,title,message,related_id:rid||null});
const id=z.object({id:z.string().uuid()}),pri=z.enum(['High','Normal','Low']);
const aiLimit=rateLimit({windowMs:60000,limit:20,standardHeaders:true,legacyHeaders:false,message:{error:{message:'Too many AI requests',code:'RATE_LIMIT'}}});
r.get('/health',(q,s)=>ok(s,{status:'ok',supabaseConfigured:!!(cfg.sbUrl&&cfg.sbAnon),openaiConfigured:!!cfg.oaKey}));
r.use(needSb,auth);
r.get('/me',wrap(async(q,s)=>ok(s,must(await q.db.from('profiles').select('*').eq('id',q.user.id).single()))));
r.patch('/me',validate(z.object({full_name:z.string().trim().min(1).max(100)}).strict()),wrap(async(q,s)=>{const d=must(await q.db.from('profiles').update(q.valid.body).eq('id',q.user.id).select().single());await act(q,'profile','Updated profile');ok(s,d)}));
const eq=z.object({q:z.string().max(200).optional(),category:z.string().max(60).optional(),priority:pri.optional(),unread:z.enum(['true','false']).optional(),status:z.enum(['open','archived']).default('open'),sort:z.enum(['new','old','priority']).default('new'),limit:z.coerce.number().int().min(1).max(200).default(50),offset:z.coerce.number().int().min(0).default(0)});
r.get('/emails',validate(eq,'query'),wrap(async(q,s)=>{const v=q.valid.query;
 let x=q.db.from('emails').select('id,sender_name,sender_email,subject,received_at,is_read,is_starred,priority,category,ai_status,ai_summary,has_attachment,is_demo',{count:'exact'}).eq('status',v.status);
 if(v.q){const t=v.q.replace(/[^\p{L}\p{N}\s@._-]/gu,' ').trim();if(t)x=x.or(`subject.ilike.%${t}%,sender_name.ilike.%${t}%,body.ilike.%${t}%`)}
 if(v.category)x=x.eq('category',v.category);if(v.priority)x=x.eq('priority',v.priority);if(v.unread)x=x.eq('is_read',v.unread=='false');
 x=v.sort=='priority'?x.order('priority_rank').order('received_at',{ascending:false}):x.order('received_at',{ascending:v.sort=='old'});
 const res=await x.range(v.offset,v.offset+v.limit-1);ok(s,{items:must(res),total:res.count})}));
r.get('/emails/:id',validate(id,'params'),wrap(async(q,s)=>ok(s,must(await q.db.from('emails').select('*,ai_processing(*),approvals(*)').eq('id',q.valid.params.id).single()))));
const ep=z.object({is_read:z.boolean(),is_starred:z.boolean(),priority:pri,category:z.string().max(60),status:z.enum(['open','archived'])}).partial().strict().refine(o=>Object.keys(o).length,'No fields to update');
r.patch('/emails/:id',validate(id,'params'),validate(ep),wrap(async(q,s)=>{const d=must(await q.db.from('emails').update(q.valid.body).eq('id',q.valid.params.id).select('id,is_read,is_starred,priority,category,status').single());
 if(q.valid.body.status||q.valid.body.priority||q.valid.body.category)await act(q,'email','Updated email: '+Object.keys(q.valid.body).join(', '),d.id);ok(s,d)}));
r.delete('/emails/:id',validate(id,'params'),wrap(async(q,s)=>{must(await q.db.from('emails').delete().eq('id',q.valid.params.id).select('id').single());await act(q,'email','Deleted an email');ok(s,{deleted:true})}));
r.post('/emails/:id/process',aiLimit,validate(id,'params'),wrap(async(q,s)=>{
 const e=must(await q.db.from('emails').select('*').eq('id',q.valid.params.id).single());
 const ex=await q.db.from('ai_processing').select('*').eq('email_id',e.id).eq('status','completed').maybeSingle();
 if(ex.data)return ok(s,{result:ex.data,cached:true});
 let a;try{a=await analyse(e)}catch(err){await q.db.from('emails').update({ai_status:'failed'}).eq('id',e.id);throw err}
 const rec=must(await q.db.from('ai_processing').upsert({user_id:q.user.id,email_id:e.id,intent:a.intent,summary:a.summary,suggested_priority:a.priority,suggested_category:a.category,suggested_owner:a.owner,suggested_action:a.suggestedAction,requires_attention:a.requiresAttention,follow_up_needed:a.followUpNeeded,key_info:a.keyInfo,model:cfg.oaModel,status:'completed'},{onConflict:'email_id'}).select().single());
 must(await q.db.from('emails').update({ai_summary:a.summary,ai_status:'processed',priority:a.priority,category:a.category}).eq('id',e.id).select('id').single());
 let approval=null;if(a.suggestedReply&&a.owner!='None')approval=must(await q.db.from('approvals').insert({user_id:q.user.id,email_id:e.id,suggested_reply:a.suggestedReply}).select().single());
 if(approval)await note(q,'approval','Reply awaiting approval','Draft reply for "'+e.subject.slice(0,80)+'"',approval.id);
 await act(q,'ai','AI analysed "'+e.subject.slice(0,80)+'"',e.id);ok(s,{result:rec,followUpDays:a.followUpDays??null,approval,cached:false},201)}));
r.get('/approvals',validate(z.object({status:z.enum(['pending','approved','rejected']).optional()}),'query'),wrap(async(q,s)=>{let x=q.db.from('approvals').select('*,emails(subject,sender_name)').order('created_at',{ascending:false}).limit(200);if(q.valid.query.status)x=x.eq('status',q.valid.query.status);ok(s,must(await x))}));
r.post('/approvals/:id/decision',validate(id,'params'),validate(z.object({decision:z.enum(['approved','rejected']),reply:z.string().max(10000).optional()}).strict()),wrap(async(q,s)=>{const {decision,reply}=q.valid.body;
 const rows=must(await q.db.from('approvals').update({status:decision,edited_reply:reply??null,reviewed_at:new Date().toISOString(),send_status:decision=='approved'?'awaiting_sending_configuration':'not_applicable'}).eq('id',q.valid.params.id).eq('status','pending').select());
 if(!rows.length)throw new HttpError(409,'Approval not found or already decided','CONFLICT');await act(q,'approval',`Reply ${decision}${decision=='approved'?' (not sent: no mailbox configured)':''}`,rows[0].id);ok(s,rows[0])}));
const fb=z.object({email_id:z.string().uuid().nullable().optional(),description:z.string().trim().min(1).max(500),due_date:z.string().datetime()}).strict();
const fl=r=>({...r,overdue:r.status=='pending'&&new Date(r.due_date)<new Date()});
r.get('/follow-ups',wrap(async(q,s)=>ok(s,must(await q.db.from('follow_ups').select('*,emails(subject,sender_name)').order('due_date').limit(500)).map(fl))));
r.post('/follow-ups',validate(fb),wrap(async(q,s)=>{const d=must(await q.db.from('follow_ups').insert({...q.valid.body,user_id:q.user.id,reminder_at:q.valid.body.due_date}).select().single());await act(q,'follow_up','Created follow-up',d.id);ok(s,fl(d),201)}));
r.patch('/follow-ups/:id',validate(id,'params'),validate(fb.partial().extend({status:z.enum(['pending','completed'])}).partial().strict().refine(o=>Object.keys(o).length,'No fields')),wrap(async(q,s)=>{const b={...q.valid.body};if(b.status)b.completed_at=b.status=='completed'?new Date().toISOString():null;
 const d=must(await q.db.from('follow_ups').update(b).eq('id',q.valid.params.id).select().single());await act(q,'follow_up',b.status=='completed'?'Completed follow-up':'Updated follow-up',d.id);ok(s,fl(d))}));
r.delete('/follow-ups/:id',validate(id,'params'),wrap(async(q,s)=>{must(await q.db.from('follow_ups').delete().eq('id',q.valid.params.id).select('id').single());await act(q,'follow_up','Deleted follow-up');ok(s,{deleted:true})}));
r.get('/notifications',wrap(async(q,s)=>{const l=must(await q.db.from('notifications').select('*').order('created_at',{ascending:false}).limit(100));ok(s,{items:l,unread:l.filter(n=>!n.is_read).length})}));
r.post('/notifications/read-all',wrap(async(q,s)=>{must(await q.db.from('notifications').update({is_read:true}).eq('is_read',false).select('id'));ok(s,{ok:true})}));
r.post('/notifications/:id/read',validate(id,'params'),wrap(async(q,s)=>ok(s,must(await q.db.from('notifications').update({is_read:true}).eq('id',q.valid.params.id).select().single()))));
r.get('/activity',wrap(async(q,s)=>ok(s,must(await q.db.from('activity_history').select('*').order('created_at',{ascending:false}).limit(200)))));
const sp=z.object({theme:z.enum(['light','dark','system']),notification_prefs:z.object({approvals:z.boolean(),followups:z.boolean(),urgent:z.boolean(),ai:z.boolean()}).partial().strict(),ai_prefs:z.object({autoSuggestReplies:z.boolean()}).partial().strict()}).partial().strict();
r.get('/settings',wrap(async(q,s)=>ok(s,must(await q.db.from('user_settings').select('*').eq('user_id',q.user.id).single()))));
r.put('/settings',validate(sp),wrap(async(q,s)=>{const cur=must(await q.db.from('user_settings').select('*').eq('user_id',q.user.id).single()),b=q.valid.body;
 const d=must(await q.db.from('user_settings').update({...(b.theme&&{theme:b.theme}),notification_prefs:{...cur.notification_prefs,...b.notification_prefs},ai_prefs:{...cur.ai_prefs,...b.ai_prefs}}).eq('user_id',q.user.id).select().single());await act(q,'settings','Changed settings');ok(s,d)}));
r.get('/analytics/summary',wrap(async(q,s)=>{
 const em=must(await q.db.from('emails').select('received_at,category,ai_status').limit(20000));
 const cnt=async(t,f)=>{const {count,error}=await f(q.db.from(t).select('id',{count:'exact',head:true}));if(error)throw new HttpError(500,'Database error');return count};
 const now=new Date().toISOString(),[pa,ca,pf,of]=await Promise.all([cnt('approvals',x=>x.eq('status','pending')),cnt('approvals',x=>x.neq('status','pending')),cnt('follow_ups',x=>x.eq('status','pending')),cnt('follow_ups',x=>x.eq('status','pending').lt('due_date',now))]);
 const cats={},day={},mon={};let done=0;for(const e of em){cats[e.category]=(cats[e.category]||0)+1;const p=e.ai_status=='processed';if(p)done++;
  const d=e.received_at.slice(0,10),m=e.received_at.slice(0,7);(day[d]??={received:0,processed:0}).received++;(mon[m]??={received:0,processed:0}).received++;if(p){day[d].processed++;mon[m].processed++}}
 ok(s,{totalEmails:em.length,aiProcessed:done,aiProcessedPct:em.length?Math.round(done/em.length*100):0,pendingApprovals:pa,completedApprovals:ca,pendingFollowUps:pf,overdueFollowUps:of,
  categories:Object.entries(cats).map(([name,count])=>({name,count})),daily:Object.entries(day).sort().slice(-365).map(([date,v])=>({date,...v})),monthly:Object.entries(mon).sort().slice(-12).map(([month,v])=>({month,...v}))})}));
export default r;
