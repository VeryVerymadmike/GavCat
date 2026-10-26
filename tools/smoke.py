import sys, asyncio
from playwright.async_api import async_playwright
OUT = sys.argv[2]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':1280,'height':800})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.set_content(open(sys.argv[1]).read(), wait_until='load')
        await pg.wait_for_timeout(800)
        ok = await pg.evaluate("typeof window.catDebug")
        await pg.screenshot(path=OUT)
        print('debug hook:', ok, 'errors:', errs)
        await b.close()
asyncio.run(main())
