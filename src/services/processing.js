import {analyse} from './ai.js';import {cfg} from '../config.js';import {HttpError} from '../middleware.js';
const must=x=>{if(x.error){console.error('[db]',x.error.code);throw new HttpError(500,'Database error')}return x.data};
export async function processEmail(db,userId,e){
 const ex=await db.from('ai_processing').select('*').eq('email_id',e.id).eq('status','completed').maybeSingle();if(ex.data)return{result:ex.data,cached:true};
 let a;try{a=await analyse(e)}catch(err){if(err.status!==503&&err.status!==429)await db.from('emails').update({ai_status:'failed'}).eq('id',e.id);throw err}
 const rec=must(await db.from('ai_processing').upsert({user_id:userId,email_id:e.id,intent:a.intent,summary:a.summary,suggested_priority:a.priority,suggested_category:a.category,suggested_owner:a.owner,suggested_action:a.suggestedAction,requires_attention:a.requiresAttention,follow_up_needed:a.followUpNeeded,key_info:a.keyInfo,model:cfg.oaModel,status:'completed'},{onConflict:'email_id'}).select().single());
 must(await db.from('emails').update({ai_summary:a.summary,ai_status:'processed',priority:a.priority,category:a.category}).eq('id',e.id).select('id').single());
 let approval=null;if(a.suggestedReply&&a.owner!='None')approval=must(await db.from('approvals').insert({user_id:userId,email_id:e.id,suggested_reply:a.suggestedReply}).select().single());
 if(approval)await db.from('notifications').insert({user_id:userId,type:'approval',title:'Reply awaiting approval',message:'Draft reply for "'+e.subject.slice(0,80)+'"',related_id:approval.id});
 await db.from('activity_history').insert({user_id:userId,type:'ai',description:'AI analysed "'+e.subject.slice(0,80)+'"',related_id:e.id});
 return{result:rec,followUpDays:a.followUpDays??null,approval,cached:false}}
export async function processPending(db,userId,limit=10){
 const rows=must(await db.from('emails').select('*').in('ai_status',['pending','failed']).eq('status','open').order('received_at',{ascending:false}).limit(limit));let processed=0,failed=0,stopped=null;
 for(const e of rows){try{await processEmail(db,userId,e);processed++}catch(err){failed++;if(err.status===429||err.status===503){stopped=err.message;break}}}
 const{count}=await db.from('emails').select('id',{count:'exact',head:true}).in('ai_status',['pending','failed']).eq('status','open');return{processed,failed,remaining:count||0,stopped}}
