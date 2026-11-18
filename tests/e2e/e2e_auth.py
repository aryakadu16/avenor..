"""Browser e2e for AVENOR auth. Uses a MOCK Supabase (server/tests/mock-supabase.js), the real Express API and the real frontend. Not a test of real Supabase."""
import subprocess,time,os,socket,sys
from playwright.sync_api import sync_playwright
R=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'));B='http://127.0.0.1:5173/'
env={**os.environ,'PORT':'4000','SUPABASE_URL':'http://127.0.0.1:54321','SUPABASE_ANON_KEY':'anon','ALLOWED_ORIGINS':'http://127.0.0.1:5173'}
P=[subprocess.Popen(['node','server/tests/mock-supabase.js','54321'],cwd=R,stdout=subprocess.DEVNULL),subprocess.Popen(['node','src/server.js'],cwd=R+'/server',env=env,stdout=subprocess.DEVNULL),
   subprocess.Popen(['python3','-m','http.server','5173','--bind','127.0.0.1','-d','frontend'],cwd=R,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)]
for port in(54321,4000,5173):
    for _ in range(50):
        try:socket.create_connection(('127.0.0.1',port),0.2).close();break
        except OSError:time.sleep(.2)
CFG="window.AVENOR_CONFIG={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'anon',API_URL:'http://127.0.0.1:4000'}"
EMPTY="window.AVENOR_CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',API_URL:'http://127.0.0.1:4000'}"
res=[];reqs=[]
def check(name,fn):
    try:fn();res.append((name,True,''))
    except Exception as e:res.append((name,False,str(e).split('\n')[0][:160]))
def page(ctx,cfg=CFG,hash='start',block=False):
    p=ctx.new_page();p.route('**/config.js',lambda r:r.fulfill(body=cfg,content_type='application/javascript'))
    if block:p.route('**/127.0.0.1:54321/**',lambda r:r.abort())
    p.on('request',lambda r:reqs.append((r.url,r.headers.get('authorization','')))if ':4000/api/me' in r.url else None)
    p.goto(B+'#'+hash);p.evaluate("document.getElementById('boot')&&document.getElementById('boot').remove()");return p
def hashis(p,h):p.wait_for_function(f"location.hash=='#{h}'",timeout=8000)
def fill(p,name,email,pw,mode):
    p.wait_for_selector('#af');p.click(f"[data-a='mode:{mode}']");p.wait_for_selector(f"#af[data-m='{mode}']")
    if name:p.fill('#an',name)
    p.fill('#ae',email);p.fill('#ap',pw);p.click('.sub')
def msg(p,sub,sel='#am'):p.wait_for_function(f"document.querySelector('{sel}')&&document.querySelector('{sel}').textContent.includes({sub!r})",timeout=8000)
with sync_playwright() as pw:
    br=pw.chromium.launch();ctx=br.new_context(viewport={'width':1280,'height':800});S={}
    def t_unconf():
        c=br.new_context();p=page(c,EMPTY);fill(p,None,'a@b.co','whatever1','in');msg(p,'not configured');c.close()
    check('Missing Supabase config shows an error, no fake login',t_unconf)
    def t_inv():
        p=page(ctx);fill(p,None,'bad','x','in');msg(p,'valid email','#aee');S['p']=p
    check('Invalid email rejected by form validation',t_inv)
    def t_reg():
        p=S['p'];fill(p,'Ada Lovelace','ada@example.com','secret123','up');hashis(p,'connect');p.wait_for_selector('#cbtn')
        assert 'Connect your Gmail' in p.inner_text('.sec h1'),p.inner_text('.sec h1')
    check('Registration signs in and goes to the Gmail connect screen (not the demo dashboard)',t_reg)
    check('Frontend sent Supabase bearer token to Express /api/me',lambda:(_ for _ in()).throw(AssertionError(reqs)) if not any(a.startswith('Bearer at_') for _,a in reqs) else None)
    def t_refresh():
        p=S['p'];p.reload();p.evaluate("document.getElementById('boot')&&document.getElementById('boot').remove()");p.wait_for_selector('#cbtn',timeout=10000)
        assert p.evaluate('location.hash')=='#connect'
    check('Session persists after browser refresh',t_refresh)
    def t_out():
        p=S['p'];p.click("[data-a='logout']");p.click("[data-m='y']");hashis(p,'welcome');p.wait_for_timeout(3000);p.evaluate("document.getElementById('boot')&&document.getElementById('boot').remove()")
        assert not p.evaluate("Object.keys(localStorage).some(k=>k.startsWith('sb-')&&localStorage.getItem(k))"),'token left in storage'
        p.evaluate("location.hash='app-overview'");hashis(p,'start')
    check('Logout clears session; dashboard redirects to sign-in',t_out)
    def t_wrong():
        p=S['p'];fill(p,None,'ada@example.com','wrongpass1','in');msg(p,'Incorrect email or password')
    check('Incorrect password shows a clear error',t_wrong)
    def t_login():
        p=S['p'];fill(p,None,'ada@example.com','secret123','in');hashis(p,'connect');p.wait_for_selector('#cbtn')
    check('Login with correct credentials lands on Gmail connect',t_login)
    def t_dup():
        p=S['p'];p.click("[data-a='logout']");p.click("[data-m='y']");hashis(p,'welcome');p.wait_for_timeout(3000);p.evaluate("document.getElementById('boot')&&document.getElementById('boot').remove()");p.evaluate("location.hash='start'");hashis(p,'start')
        fill(p,'Ada Again','ada@example.com','secret123','up');msg(p,'already exists')
    check('Duplicate registration shows a clear error',t_dup)
    def t_guard():
        c=br.new_context();p=page(c,CFG,'app-overview');hashis(p,'start');c.close()
    check('Unauthenticated dashboard access redirects to sign-in',t_guard)
    def t_down():
        c=br.new_context();p=page(c,CFG,'start',True);fill(p,None,'ada@example.com','secret123','in');msg(p,'Cannot reach');c.close()
    check('Auth service unavailable shows a graceful error',t_down)
    br.close()
for p in P:p.terminate()
for n,ok,e in res:print(('PASS ' if ok else 'FAIL ')+n+('' if ok else ' -> '+e))
sys.exit(0 if all(o for _,o,_ in res) else 1)
