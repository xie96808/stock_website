# Regression: 关闭公告 / × must close on taps during the enter animation and absorb rapid repeat taps.
# Usage: python3 scripts/e2e/announcements-close-race.py http://127.0.0.1:PORT [tag]   (expect all 0/N, rapid 6/6)
import sys, json
from playwright.sync_api import sync_playwright
BASE=sys.argv[1]; TAG=sys.argv[2] if len(sys.argv)>2 else 'x'
out={}
with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
  for vw,vh in [(390,844),(1280,800)]:
    pg=b.new_page(viewport={'width':vw,'height':vh})
    pg.goto(BASE+'/',wait_until='networkidle'); pg.wait_for_timeout(700)
    pg.evaluate("""()=>{const m=document.getElementById('announcementsModal');if(m&&!m.hidden){document.getElementById('announcementsClose').click();}}""")
    pg.wait_for_timeout(400)
    for sel in ['#announcementsClose','#announcementsCloseX']:
     for delay in [0,40,80,150,600]:
      fails=0;N=10
      for i in range(N):
        pg.evaluate("document.getElementById('announcementsBtn').click()")
        pg.wait_for_timeout(delay)
        # press near the bottom/right edge, release 90ms later (human tap) while dialog still scaling
        r=pg.evaluate(f"(()=>{{const r=document.querySelector('{sel}').getBoundingClientRect();return [r.x,r.y,r.width,r.height]}})()")
        x=(r[0]+r[2]-2) if sel=='#announcementsClose' else r[0]+r[2]*0.5; y=(r[1]+r[3]-2) if sel=='#announcementsClose' else r[1]+r[3]*0.5
        pg.mouse.move(x,y); pg.mouse.down(); pg.wait_for_timeout(90); pg.mouse.up()
        pg.wait_for_timeout(450)
        if not pg.evaluate("document.getElementById('announcementsModal').hidden"):
          fails+=1
          pg.evaluate("document.getElementById('announcementsClose').click()"); pg.wait_for_timeout(450)
      out[f'{vw} {sel} d={delay}']=f'{fails}/{N}'
    # repeated rapid clicks: open + 5 clicks
    ok=0
    for i in range(6):
      pg.evaluate("document.getElementById('announcementsBtn').click()"); pg.wait_for_timeout(20)
      r2=pg.evaluate("(()=>{const r=document.querySelector('#announcementsClose').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
      for k in range(4): pg.mouse.click(r2[0],r2[1]); pg.wait_for_timeout(40)
      pg.wait_for_timeout(450); ok+=pg.evaluate("document.getElementById('announcementsModal').hidden && !document.querySelector('.is-open:not([hidden])') && !document.body.classList.contains('ctl-scroll-lock')")
    out[f'{vw} rapid-repeat ok']=f'{ok}/6'
    if TAG=='after' and vw==390:
      pg.evaluate("document.getElementById('announcementsBtn').click()"); pg.wait_for_timeout(60)
      pg.screenshot(path='/tmp/01-open-60ms-390.png')
      r=pg.evaluate("(()=>{const r=document.querySelector('#announcementsClose').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
      pg.mouse.move(r[0]+r[2]-2,r[1]+r[3]-2); pg.mouse.down(); pg.wait_for_timeout(90); pg.mouse.up(); pg.wait_for_timeout(450)
      pg.screenshot(path='/tmp/02-closed-after-edge-tap-390.png')
    pg.close()
  b.close()
print(TAG, json.dumps(out,indent=0))
