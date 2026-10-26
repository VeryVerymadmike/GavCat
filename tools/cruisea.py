import asyncio, json, sys
from playwright.async_api import async_playwright
from PIL import Image
OUT=sys.argv[1]; MOVE=sys.argv[2]; N=int(sys.argv[3]); EXTRA=json.loads(sys.argv[4]) if len(sys.argv)>4 else {}
SET = dict(breathe=False, blink=False, sway=False, eyeAuto=False, auto=False, followCursor=False, lickCursor=False, pounce=False, jumpCursor=False, posX=8, size=14); SET.update(EXTRA)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':2400,'height':700}, device_scale_factor=2)
        url='http://127.0.0.1:8765/'+(sys.argv[5] if len(sys.argv)>5 else 'new')+'.html'; await pg.goto(url)
        await pg.evaluate(f"localStorage.clear(); localStorage.setItem('cat-stretch-v2', JSON.stringify({json.dumps(SET)}))"); await pg.goto(url); await pg.wait_for_timeout(500); await pg.keyboard.press('h'); await pg.add_style_tag(content='#low-bf,#low-ff{fill:#d0453a !important} #low-bn,#low-fn{fill:#2a6fd6 !important}')
        await pg.evaluate(f"catDebug.doMove('{MOVE}')"); await pg.wait_for_timeout(50); await pg.evaluate("document.getElementById('playBtn').click()")
        info = await pg.evaluate("(()=>{const P=catDebug.plan; const g=P.steps.find(s=>s.gait); return {total:P.total, start:g.start, Tc:g.gait.Tc, Ta:g.gait.Ta, Tcr:g.gait.Tcr, V:g.gait.V}})()")
        import math; t0 = info['start'] + math.ceil((info['Ta'] + info['Tcr']/2)/info['Tc'])*info['Tc']
        ims=[]
        for i in range(N):
            t=t0 + info['Tc']*i/N
            await pg.evaluate(f"const s=document.getElementById('scrub'); s.value={t/info['total']}; s.dispatchEvent(new Event('input'))"); await pg.wait_for_timeout(50)
            x = await pg.evaluate("+/translate\\(([-\\d.]+)/.exec(document.getElementById('cat').getAttribute('transform'))[1]")
            f=OUT+'_t.png'; await pg.screenshot(path=f, clip=dict(x=max(0,x-120), y=520, width=220, height=180)); ims.append(Image.open(f).copy())
        cols=min(N,6); rows=(N+cols-1)//cols; w,h=330,270
        W=Image.new('RGB',(cols*w,rows*h),'white')
        for i,im in enumerate(ims): W.paste(im.resize((w,h)),((i%cols)*w,(i//cols)*h))
        W.save(OUT+'.png'); print(info)
        await b.close()
asyncio.run(main())
