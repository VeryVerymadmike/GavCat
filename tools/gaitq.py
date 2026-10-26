import asyncio, json, sys
from playwright.async_api import async_playwright
MOVE=sys.argv[1]; X=int(sys.argv[2]); page=sys.argv[3] if len(sys.argv)>3 else 'new'
SET = dict(breathe=False, blink=False, sway=False, eyeAuto=False, auto=False, followCursor=False, lickCursor=False, pounce=False, jumpCursor=False, posX=X)
JS = """(()=>{ window._L=[]; const cat=document.getElementById('cat'); const t0=performance.now();
function f(){ const tr=cat.getAttribute('transform'); const m=/translate\\(([-\\d.]+) [-\\d.]+\\) scale\\(([-\\d.]+)\\)/.exec(tr), ff=/scale\\((-?1) 1\\)/.exec(tr);
 const x=+m[1], s=+m[2], fc=+ff[1], sh=catDebug.shown, st=catDebug.step; const row={gait:!!(st&&st.gait), gt: st&&st.gait ? catDebug.planT-st.start : -1, T: st&&st.gait? st.gait.T:0};
 for (const l of ['bn','bf','fn','ff']){ const [h,kn,w]=sh.legs[l]; const q = st&&st.gait ? catDebug.gaitLeg(st.gait,l,catDebug.planT-st.start) : {s:-1};
   const b=sh.bones[l]; row[l]={wx:x + s*(220 + fc*(w[0]-220) - 200), wy:w[1], s:q.s, str: Math.hypot(w[0]-h[0],w[1]-h[1]) - (b[0]+b[1]), hy:h[1]}; }
 _L.push(row); if (performance.now()-t0 < 14000) requestAnimationFrame(f); } requestAnimationFrame(f); })()"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1600,'height':800}); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        url=f'http://127.0.0.1:8765/{page}.html'; await pg.goto(url)
        await pg.evaluate(f"localStorage.clear(); localStorage.setItem('cat-stretch-v2', JSON.stringify({json.dumps(SET)}))"); await pg.goto(url); await pg.wait_for_timeout(600)
        await pg.evaluate(f"catDebug.doMove('{MOVE}')"); await pg.evaluate(JS); await pg.wait_for_timeout(14300)
        L=[r for r in await pg.evaluate("_L") if r['gait']]
        out={}
        for l in ['bn','bf','fn','ff']:
            slide=0; run=None; mxs=0; hj=0; prev=None; pp=None; acc=0; wacc=0; at_=None
            for r in L:
                q=r[l]
                if q['s']<0:
                    if run is None: run=q['wx']
                    slide=max(slide,abs(q['wx']-run))
                else: run=None
                mxs=max(mxs,q['str'])
                if prev: hj=max(hj,abs(q['hy']-prev['hy']))
                if prev and pp:
                    a_=abs(q['hy']-2*prev['hy']+pp['hy'])
                    if a_>acc: acc=a_; at_=(round(r['gt'],2), round(r['T'],2))
                    wacc=max(wacc,abs(q['wy']-2*prev['wy']+pp['wy']))
                pp=prev; prev=q
            out[l]=dict(slide=round(slide,2), stretch=round(mxs,2), hipStep=round(hj,2), hipKick=round(acc,2), kickAt=at_, pawKick=round(wacc,2))
        print(page, MOVE, errs, out)
        await b.close()
asyncio.run(main())
