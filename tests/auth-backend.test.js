import test from 'node:test';import assert from 'node:assert';import {startMock} from './mock-supabase.js';
// Backend auth tested against a MOCK Supabase, not a real project.
const mock=await startMock(0),M='http://127.0.0.1:'+mock.address().port;
process.env.SUPABASE_URL=M;process.env.SUPABASE_ANON_KEY='anon';
const {createApp}=await import('../src/app.js');let srv,b,tok;
test.before(async()=>{srv=createApp().listen(0);await new Promise(r=>srv.once('listening',r));b='http://127.0.0.1:'+srv.address().port;
 tok=(await(await fetch(M+'/auth/v1/signup',{method:'POST',body:JSON.stringify({email:'a@b.co',password:'secret123',data:{full_name:'Ada'}})})).json()).access_token});
test.after(()=>{srv.close();mock.close()});
test('valid token is accepted and /api/me returns that user\'s profile',async()=>{const r=await fetch(b+'/api/me',{headers:{Authorization:'Bearer '+tok}});assert.equal(r.status,200);assert.equal((await r.json()).data.email,'a@b.co')});
test('invalid token is rejected with 401',async()=>assert.equal((await fetch(b+'/api/me',{headers:{Authorization:'Bearer nope'}})).status,401));
test('revoked token is rejected after logout',async()=>{await fetch(M+'/auth/v1/logout',{method:'POST',headers:{Authorization:'Bearer '+tok}});assert.equal((await fetch(b+'/api/me',{headers:{Authorization:'Bearer '+tok}})).status,401)});
