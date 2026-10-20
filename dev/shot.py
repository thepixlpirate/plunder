import sys, asyncio
from playwright.async_api import async_playwright
ROOT='/home/claude/prism-launcher'
OUT=sys.argv[1]
pages=sys.argv[2:]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        pg=await b.new_page(viewport={'width':1586,'height':992})
        errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.add_init_script(path=ROOT+'/dev/mock.js')
        await pg.goto('file://'+ROOT+'/src/renderer/index.html')
        await pg.wait_for_timeout(800)
        for spec in pages:
            name, js = spec.split('::',1) if '::' in spec else (spec, '')
            if js: await pg.evaluate(js); await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'{OUT}/{name}.png')
        print('ERRORS:', [e for e in errs if 'ERR_' not in e and 'Failed to load resource' not in e])
        await b.close()
asyncio.run(main())
