import crypto from 'node:crypto';
// Minimal in-memory stand-in for the supabase-js query builder (tests only).
// Column defaults that the real schema (001_schema.sql) applies in Postgres.
const DEFAULTS={approvals:{status:'pending',send_status:'not_applicable'}};
export class FakeDb{constructor(){this.t={}}
 from(n){const rows=this.t[n]??=[];let f=[],op='select',pay,opts={},single=false,ret=false,head=false;
  const b={select(c,o){ret=true;head=!!(o&&o.head);return b},eq(c,v){f.push(r=>r[c]===v);return b},in(c,v){f.push(r=>v.includes(r[c]));return b},lt(){return b},not(){return b},order(){return b},limit(){return b},
   insert(x){op='insert';pay=x;return b},upsert(x,o){op='upsert';pay=x;opts=o||{};return b},update(x){op='update';pay=x;return b},delete(){op='delete';return b},maybeSingle(){single=true;return b},single(){single=true;return b},
   then(res,rej){return Promise.resolve(run()).then(res,rej)}};
  function run(){const m=rows.filter(r=>f.every(g=>g(r)));let out=[];
   if(op=='insert')[].concat(pay).forEach(x=>{const r={id:crypto.randomUUID(),...(DEFAULTS[n]||{}),...x};rows.push(r);out.push(r)});
   else if(op=='upsert'){const k=(opts.onConflict||'').split(',');[].concat(pay).forEach(x=>{const i=rows.findIndex(r=>k.every(c=>r[c]===x[c]));if(i<0){const r={id:crypto.randomUUID(),...x};rows.push(r);out.push(r)}else if(!opts.ignoreDuplicates){Object.assign(rows[i],x);out.push(rows[i])}})}
   else if(op=='update'){m.forEach(r=>Object.assign(r,pay));out=m}
   else if(op=='delete'){m.forEach(r=>rows.splice(rows.indexOf(r),1));out=m}
   else out=m;
   const data=op!='select'&&!ret?null:(single?(out[0]?{...out[0]}:null):out.map(r=>({...r})));return{data:head?null:data,count:m.length,error:null}}
  return b}}
