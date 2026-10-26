import asyncio, json, sys
from playwright.async_api import async_playwright
SET = dict(breathe=False, blink=False, sway=False, eyeAuto=False, auto=False, followCursor=False, lickCursor=False, pounce=False, jumpCursor=False, posX=20, size=12)
RND="Math.random=(()=>{let s=11;return ()=>{s=(s*16807)%2147483647;return s/2147483647}})();"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for tag in sys.argv[1].split(','):
            pg=await b.new_page(viewport={'width':1600,'height':900}); await pg.add_init_script(RND)
            url=f'http://127.0.0.1:8765/{tag}.html'; await pg.goto(url)
            await pg.evaluate(f"localStorage.clear(); localStorage.setItem('cat-stretch-v2', JSON.stringify({json.dumps(SET)}))"); await pg.goto(url); await pg.wait_for_timeout(400)
            await pg.evaluate("catDebug.doMove('jump')"); await pg.wait_for_timeout(30); await pg.evaluate("document.getElementById('playBtn').click()")
            res = await pg.evaluate("""(async()=>{const P=catDebug.plan; const i=P.steps.findIndex(s=>s.to==='jumpPush'); const a=P.steps[i].start, b2=P.steps[i+4].start+P.steps[i+4].dur; const out={}; const sc=document.getElementById('scrub');
              const rows=[]; for(let t=a;t<=b2;t+=1/120){ sc.value=t/P.total; sc.dispatchEvent(new Event('input')); await new Promise(r=>requestAnimationFrame(r));
                const tr=document.getElementById('cat').getAttribute('transform'); const m=/translate\\(([-\\d.]+) [-\\d.]+\\) scale\\(([-\\d.]+)\\)/.exec(tr); const x=+m[1], s=+m[2]; const sh=catDebug.shown, lift=catDebug.state.lift||0;
                const row={t, step:catDebug.step&&catDebug.step.to}; for(const l of ['fn','ff','bn','bf']){const [h,k,w]=sh.legs[l]; const bn=sh.bones[l]; row[l]=[x/s + w[0], w[1], Math.hypot(w[0]-h[0],w[1]-h[1])-(bn[0]+bn[1])];} rows.push(row);} return rows;})()""")
            out={}
            FLs={l:max(r[l][1] for r in res) for l in ['fn','ff','bn','bf']}
            for l in ['fn','ff','bn','bf']:
                slide=0; anchor=None; mx=-99
                for r in res:
                    x,y,st=r[l]; mx=max(mx,st)
                    if r['step'] in ('jumpAbsorb','stand') and y>=FLs[l]-0.3:
                        if anchor is None: anchor=x
                        slide=max(slide,abs(x-anchor))
                out[l]=dict(slide=round(slide,2), stretch=round(mx,2))
            print(tag, out)
            for l in ['fn','ff','bn','bf']:
                hits=[(round(r['t']-res[0]['t'],3), r['step'], round(r[l][1],1)) for r in res if r[l][2]>-0.5]
                FL=FLs[l]; land=[round(r['t']-res[0]['t'],3) for r in res if r[l][1]>=FL-0.3 and r['t']-res[0]['t']>0.3]; print('   maxY', FL)
                print('  ',l, 'clamped frames', len(hits), 'lands at', land[:1])
            await pg.close()
        await b.close()
asyncio.run(main())
