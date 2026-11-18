"""Browser e2e for the Gmail user flow. Auth = MOCK Supabase; the AVENOR API is MOCKED at the network layer (page.route). This tests the FRONTEND flow only. Not real Gmail/Google."""
import subprocess,time,os,socket,sys,json,datetime
from playwright.sync_api import sync_playwright
R=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'));B='http://127.0.0.1:5173/'
P=[subprocess.Popen(['node','server/tests/mock-supabase.js','54321'],cwd=R,stdout=subprocess.DEVNULL),subprocess.Popen(['python3','-m','http.server','5173','--bind','127.0.0.1','-d','frontend'],cwd=R,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)]
for port in(54321,5173):
    for _ in range(50):
        try:socket.create_connection(('127.0.0.1',port),0.2).close();break
        except OSError:time.sleep(.2)
CFG="window.AVENOR_CONFIG={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'anon',API_URL:'http://127.0.0.1:4000'}"
now=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
def row(i,subj,sender,ai):
    return {'id':'00000000-0000-0000-0000-00000000000%d'%i,'sender_name':sender,'sender_email':sender.split()[0].lower()+'@real.example','subject':subj,'body_preview':'Preview '+subj,'received_at':(now-datetime.timedelta(hours=i)).isoformat()+'Z','is_read':False,'is_starred':False,'priority':'High' if ai else 'Normal','category':'Contracts and Legal' if ai else 'General','ai_status':'processed' if ai else 'pending','has_attachment':False,
     'ai_processing':{'summary':'Contract renewal needs a decision','intent':'decision','suggested_owner':'Client','suggested_action':'Review clause 4','requires_attention':True,'follow_up_needed':True,'key_info':['Clause 4']} if ai else None,
     'approvals':[{'id':'aaaa','status':'pending','suggested_reply':'Draft reply text','edited_reply':None,'send_status':'not_applicable'}] if ai else []}
EM=[row(1,'REAL Q4 contract renewal','Priya Natarajan',True),row(2,'REAL lunch next week','Tomas Berg',False)]
S={};CALLS=[]
def install(p):
    def h(route,req):
        u=req.url.split(':4000')[1];hd={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}
        if req.method=='OPTIONS':return route.fulfill(status=204,headers=hd)
        def j(d,st=200):route.fulfill(status=st,headers=hd,content_type='application/json',body=json.dumps({'data':d}))
        if u=='/api/me':return j({'full_name':'Ada','email':'ada@example.com'})
        if u=='/api/gmail/status':return j({'configured':True,'connected':S['connected'],'status':'connected' if S['connected'] else 'not_connected','googleEmail':'ada@gmail.com' if S['connected'] else None,'lastSyncedAt':None})
        if u=='/api/gmail/connect':CALLS.append('connect');return j({'url':B+'fake-google.html'})
        if u=='/api/gmail/sync':S['connected']=True;CALLS.append('sync');return j({'mode':'full','imported':0 if S['empty'] else 2,'skipped':0})
        if u=='/api/ai/process-pending':return j({'processed':0,'failed':0,'remaining':2,'stopped':'AI is not configured: set OPENAI_API_KEY on the server'})
        if u.startswith('/api/emails?'):return j({'items':[] if S['empty'] else EM,'total':0 if S['empty'] else 2})
        if u.startswith('/api/emails/'):return j({'body':'FULL BODY TEXT FROM GMAIL'}) if req.method=='GET' else j({})
        if u in('/api/follow-ups','/api/activity'):return j([])
        if u.startswith('/api/approvals/'):CALLS.append('decision:'+req.post_data);return j({'status':'approved'})
        j({},404)
    p.route('http://127.0.0.1:4000/api/**',h);p.route('**/config.js',lambda r:r.fulfill(body=CFG,content_type='application/javascript'));p.route('**/fake-google.html',lambda r:r.fulfill(body='<h1>fake google consent</h1>',content_type='text/html'))
n=[0]
def signup(ctx):
    n[0]+=1;p=ctx.new_page();install(p);p.goto(B+'#start');p.evaluate("document.getElementById('boot')&&document.getElementById('boot').remove()");p.wait_for_selector('#af');p.click("[data-a='mode:up']");p.wait_for_selector("#af[data-m='up']")
    p.fill('#an','Ada Lovelace');p.fill('#ae','u%d@example.com'%n[0]);p.fill('#ap','secret123');p.click('.sub');return p
def hashis(p,h):p.wait_for_function(f"location.hash=='#{h}'",timeout=10000)
def txt(p,sel):return p.inner_text(sel)
def has(p,sel,t):p.wait_for_function(f"document.querySelector({sel!r})&&document.querySelector({sel!r}).innerText.includes({t!r})",timeout=8000)
res=[]
def check(name,fn):
    try:fn();res.append((name,True,''))
    except Exception as e:res.append((name,False,str(e).split('\n')[0][:200]))
with sync_playwright() as pw:
    br=pw.chromium.launch();ctx=br.new_context(viewport={'width':1280,'height':800});W={}
    S.update(connected=False,empty=False)
    def a():
        p=signup(ctx);hashis(p,'connect');has(p,'.sec','Connect your Gmail');body=txt(p,'body');W['p']=p
        assert 'Demo workspace' not in body and 'not connected' in body.lower() and 'read-only' in body.lower() and 'OpenAI' in body
    check('Signed-in user without Gmail sees the connect screen, not the demo dashboard',a)
    def b():
        p=W['p'];p.click('#cbtn');p.wait_for_function("location.pathname.endsWith('fake-google.html')",timeout=8000);assert 'connect' in CALLS
    check('Connect Gmail requests an OAuth URL from the backend and redirects to Google',b)
    def c():
        p=W['p'];p.goto(B+'#gmail-denied');p.evaluate("document.getElementById('boot')&&document.getElementById('boot').remove()");has(p,'#cst','cancelled')
    check('OAuth cancellation shows a clear message and stays unconnected',c)
    def d():
        p=W['p'];p.evaluate("location.hash='gmail-connected'");hashis(p,'app-overview');has(p,'#view','Your Gmail inbox: 2 imported emails')
        assert 'sync' in CALLS and 'Demo mode' not in txt(p,'#view')
    check('After OAuth return: import runs and the real dashboard opens with the real count',d)
    def e():
        p=W['p'];p.click("[data-a='go:emails']");has(p,'#view','REAL Q4 contract renewal');t=txt(p,'#view')
        assert 'REAL lunch next week' in t and 'Northwind' not in t and 'John Davidson' not in t
    check('Email list shows the user\'s emails, no generated sample data',e)
    def f():
        p=W['p'];p.click("text=REAL Q4 contract renewal");has(p,'#view','FULL BODY TEXT FROM GMAIL');has(p,'#view','Contract renewal needs a decision');assert 'OpenAI' in txt(p,'#view')
    check('Opening an email loads its full body and shows the stored AI analysis',f)
    def g():
        p=W['p'];p.click("text=Approve (not sent)");has(p,'#view','Not sent: email sending is not enabled.');assert any(c.startswith('decision:') and 'approved' in c for c in CALLS);assert 'Sent (simulated' not in txt(p,'#view')
    check('Approving a draft saves the decision and never claims it was sent',g)
    def h():
        p=W['p'];p.click("text=REAL lunch next week");has(p,'#view','Analyse with AI')
    check('Unanalysed email offers "Analyse with AI"',h)
    def i():
        p=W['p'];p.click("[data-a='go:settings']");has(p,'#view','ada@gmail.com');assert 'read-only' in txt(p,'#view').lower() and 'Disconnect' in txt(p,'#view')
    check('Settings shows Gmail connection status, sync and disconnect',i)
    def j():
        p=W['p'];p.click("[data-a='logout']");p.click("[data-m='y']");hashis(p,'welcome');p.wait_for_selector('.wel',timeout=8000)
        p.evaluate("location.hash='app-overview'");hashis(p,'start')
    check('Logout from the real workspace returns to welcome and re-protects the dashboard',j)
    def k():
        c2=br.new_context(viewport={'width':1280,'height':800});S.update(connected=True,empty=True);p=signup(c2);hashis(p,'app-overview');has(p,'#view','No emails yet');c2.close()
    check('Connected account with an empty inbox shows an empty state',k)
    def l():
        c3=br.new_context(viewport={'width':1280,'height':800});p=c3.new_page();p.route('**/config.js',lambda r:r.fulfill(body="window.AVENOR_CONFIG={SUPABASE_URL:'',SUPABASE_ANON_KEY:'',API_URL:''}",content_type='application/javascript'))
        p.goto(B+'#start');p.evaluate("document.getElementById('boot')&&document.getElementById('boot').remove()");p.wait_for_selector("[data-a='demo']");p.click("[data-a='demo']");hashis(p,'app-overview');has(p,'#view h1','Welcome to your workspace')
        assert 'Demo mode' in txt(p,'#view') and p.locator('#view svg').count()>=3 and 'Demo workspace' in txt(p,'aside')
        for pg in['emails','approvals','followups','analytics','activity','settings']:
            p.click(f"[data-a='go:{pg}']");hashis(p,'app-'+pg)
        c3.close()
    check('Demo mode still works separately (generated data, charts, all pages)',l)
    br.close()
for p in P:p.terminate()
for nm,ok,e in res:print(('PASS ' if ok else 'FAIL ')+nm+('' if ok else ' -> '+e))
sys.exit(0 if all(o for _,o,_ in res) else 1)
