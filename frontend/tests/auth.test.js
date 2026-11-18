const test=require('node:test'),assert=require('node:assert'),make=require('../auth.js');
const fake=(o={})=>({auth:{signUp:async()=>o.signUp||{data:{user:{identities:[1]},session:null},error:null},signInWithPassword:async()=>o.signIn||{data:{session:{access_token:'t'}},error:null},
 signOut:async()=>{o.out=(o.out||0)+1;return{}},getSession:async()=>({data:{session:o.sess===undefined?{access_token:'tok'}:o.sess}}),onAuthStateChange(){}}});
const mk=(o,fetchImpl)=>make({AVENOR_CONFIG:{SUPABASE_URL:'http://x',SUPABASE_ANON_KEY:'k',API_URL:'http://api'},supabase:{createClient:()=>fake(o)},fetch:fetchImpl});
test('validation: email, password, name',()=>{const AV=mk({});assert.ok(AV.validate('in',{email:'bad',password:'x'}).ae);assert.ok(AV.validate('in',{email:'a@b.co',password:''}).ap);
 assert.ok(AV.validate('up',{name:'A',email:'a@b.co',password:'abc12345'}).an);assert.ok(AV.validate('up',{name:'Ada',email:'a@b.co',password:'short'}).ap);assert.ok(AV.validate('up',{name:'Ada',email:'a@b.co',password:'abcdefgh'}).ap);
 assert.deepEqual(AV.validate('up',{name:'Ada',email:'a@b.co',password:'abc12345'}),{});assert.deepEqual(AV.validate('forgot',{email:'a@b.co'}),{})});
test('error mapping',()=>{const AV=mk({});assert.match(AV.mapError({code:'invalid_credentials'}),/Incorrect email or password/);assert.match(AV.mapError({code:'user_already_exists'}),/already exists/);
 assert.match(AV.mapError({code:'duplicate'}),/already exists/);assert.match(AV.mapError({status:0,message:'Failed to fetch'}),/Cannot reach/);assert.match(AV.mapError({status:429}),/Too many/);assert.match(AV.mapError({code:'email_not_confirmed'}),/Confirm/)});
test('duplicate registration detected when Supabase hides it (empty identities)',async()=>{const AV=mk({signUp:{data:{user:{identities:[]},session:null},error:null}});await assert.rejects(AV.signUp('Ada','a@b.co','abc12345'),e=>e.code==='duplicate')});
test('signUp without session means email confirmation needed',async()=>assert.equal((await mk({}).signUp('Ada','a@b.co','abc12345')).needsConfirm,true));
test('signIn surfaces Supabase errors',async()=>{const AV=mk({signIn:{data:{},error:{code:'invalid_credentials',message:'Invalid login credentials',status:400}}});await assert.rejects(AV.signIn('a@b.co','x'),e=>/Incorrect/.test(AV.mapError(e)))});
test('unconfigured client refuses to sign in, never fakes success',async()=>{const AV=make({AVENOR_CONFIG:{}});assert.equal(AV.configured,false);await assert.rejects(AV.signIn('a@b.co','x'),e=>e.code==='not_configured')});
test('api sends bearer token; 401 signs out; 503 and 403 surfaced; network error status 0',async()=>{
 let seen;const ok=mk({},async(u,o)=>{seen=o.headers.Authorization;return{status:200,ok:true,json:async()=>({data:{a:1}})}});assert.deepEqual(await ok.api('/api/me'),{a:1});assert.equal(seen,'Bearer tok');
 const st={};const r401=mk(st,async()=>({status:401,ok:false,json:async()=>({})}));await assert.rejects(r401.api('/x'),e=>e.status===401);assert.equal(st.out,1);
 await assert.rejects(mk({},async()=>({status:503,ok:false,json:async()=>({error:{message:'Supabase is not configured'}})})).api('/x'),e=>e.status===503&&/not configured/.test(e.message));
 await assert.rejects(mk({},async()=>({status:403,ok:false,json:async()=>({})})).api('/x'),e=>e.status===403);
 await assert.rejects(mk({},async()=>{throw new Error('down')}).api('/x'),e=>e.status===0);
 await assert.rejects(mk({sess:null},async()=>({})).api('/x'),e=>e.status===401)});
