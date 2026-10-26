import sys, json, asyncio
from playwright.async_api import async_playwright
SET = dict(breathe=False, blink=False, sway=False, eyeAuto=False, auto=False, followCursor=False, lickCursor=False, pounce=False, size=40, showSkel=False)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':1600,'height':800}); url=f'http://127.0.0.1:8765/{sys.argv[1]}.html'
        await pg.goto(url); await pg.evaluate(f"localStorage.setItem('cat-stretch-v2', JSON.stringify({json.dumps(SET)}))"); await pg.goto(url); await pg.wait_for_timeout(300)
        print(await pg.evaluate(sys.argv[2]))
        await b.close()
asyncio.run(main())
