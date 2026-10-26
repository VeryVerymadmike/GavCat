import asyncio, json, sys
from playwright.async_api import async_playwright
from PIL import Image
SET = dict(breathe=False, blink=False, sway=False, eyeAuto=False, auto=False, followCursor=False, lickCursor=False, pounce=False, jumpCursor=False, posX=float(sys.argv[2]), size=10, ground=10, jumpHeight=2.5)
RND="Math.random=(()=>{let s=%s;return ()=>{s=(s*16807)%%2147483647;return s/2147483647}})();" % sys.argv[3]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1512,'height':945}); await pg.add_init_script(RND)
        url='http://127.0.0.1:8765/new.html'; await pg.goto(url)
        await pg.evaluate(f"localStorage.clear(); localStorage.setItem('cat-stretch-v2', JSON.stringify({json.dumps(SET)}))"); await pg.goto(url); await pg.wait_for_timeout(400); await pg.keyboard.press('h')
        await pg.evaluate("catDebug.doMove('jump')"); await pg.wait_for_timeout(30); await pg.evaluate("document.getElementById('playBtn').click()")
        info = await pg.evaluate("(()=>{const P=catDebug.plan; const i=P.steps.findIndex(s=>s.to==='jumpPush'); const s=P.steps; return {total:P.total, a:s[i].start, b:s[i+2].start+s[i+2].dur, tilt:s[i].jTilt, lift:s[i+1].lift, x0:s[i+1].x0, x1:s[i+1].x1}})()")
        print(info)
        W=Image.new("RGB",(1512,945),"white"); N=18
        for i in range(N):
            t=info['a'] + (info['b']-info['a'])*i/(N-1)
            await pg.evaluate(f"const s=document.getElementById('scrub'); s.value={t/info['total']}; s.dispatchEvent(new Event('input'))"); await pg.wait_for_timeout(40)
            await pg.screenshot(path=sys.argv[1]+'_t.png'); im=Image.open(sys.argv[1]+'_t.png').convert('RGB')
            if i==0: W=im.copy()
            else:
                px=im.load(); wp=W.load()
                for y in range(0,945):
                    for x in range(0,1512):
                        if sum(px[x,y])<150: wp[x,y]=px[x,y]
        W.save(sys.argv[1]+'.png')
        top = await pg.evaluate("1")
        await b.close()
asyncio.run(main())
