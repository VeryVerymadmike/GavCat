import asyncio, json, sys
from playwright.async_api import async_playwright
from PIL import Image
OUT=sys.argv[1]; PAGE=sys.argv[2]; N=int(sys.argv[3])
SET = dict(breathe=False, blink=False, sway=False, eyeAuto=False, auto=False, followCursor=False, lickCursor=False, pounce=False, jumpCursor=False, posX=12, size=16)
RND="Math.random=(()=>{let s=11;return ()=>{s=(s*16807)%2147483647;return s/2147483647}})();"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':2400,'height':1400}); await pg.add_init_script(RND)
        url=f'http://127.0.0.1:8765/{PAGE}.html'; await pg.goto(url)
        await pg.evaluate(f"localStorage.clear(); localStorage.setItem('cat-stretch-v2', JSON.stringify({json.dumps(SET)}))"); await pg.goto(url); await pg.wait_for_timeout(500); await pg.keyboard.press('h')
        await pg.add_style_tag(content='#low-bf,#low-ff,#leg-bf,#leg-ff{fill:#d0453a !important} #low-bn,#low-fn,#leg-bn,#leg-fn{fill:#2a6fd6 !important}')
        await pg.evaluate("catDebug.doMove('jump')"); await pg.wait_for_timeout(50); await pg.evaluate("document.getElementById('playBtn').click()")
        info = await pg.evaluate("(()=>{const P=catDebug.plan; const i=P.steps.findIndex(s=>s.to==='jumpPush'); const s=P.steps; return {total:P.total, a:s[i].start-0.02, b:s[i+1].start+0.45*s[i+1].dur}})()")
        ims=[]
        for i in range(N):
            t=info['a'] + (info['b']-info['a'])*i/(N-1)
            await pg.evaluate(f"const s=document.getElementById('scrub'); s.value={t/info['total']}; s.dispatchEvent(new Event('input'))"); await pg.wait_for_timeout(40)
            r = await pg.evaluate("(()=>{const r=document.getElementById('skull').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]})()")
            f=OUT+'_t.png'; await pg.screenshot(path=f, clip=dict(x=max(0,r[0]-330), y=max(0,r[1]-230), width=460, height=460)); ims.append(Image.open(f).copy())
        cols=min(N,6); rows=(N+cols-1)//cols; w,h=250,250
        W=Image.new('RGB',(cols*w,rows*h),'white')
        for i,im in enumerate(ims): W.paste(im.resize((w,h)),((i%cols)*w,(i//cols)*h))
        W.save(OUT+'.png'); print(info)
        await b.close()
asyncio.run(main())
