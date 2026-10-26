import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1280,'height':800}); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        url='http://127.0.0.1:8765/new.html'
        await pg.goto(url); await pg.evaluate("localStorage.setItem('cat-stretch-v2', JSON.stringify({speed:2, idleTime:0.5})); localStorage.setItem('cat-stretch-ui', JSON.stringify({tab:'shape'}))")
        await pg.goto(url+'?wallpaper'); await pg.wait_for_timeout(500)
        vis = await pg.evaluate("getComputedStyle(document.getElementById('skel')).display")
        labels=set()
        await pg.evaluate("document.getElementById('holdPose').checked=false; catDebug.doMove('stand')")
        for i in range(140):
            await pg.wait_for_timeout(250); labels.add(await pg.evaluate("catDebug.state.label"))
        print('skel display in wallpaper:', vis, '| errors:', errs, '| labels:', sorted(l for l in labels if l))
        await b.close()
asyncio.run(main())
