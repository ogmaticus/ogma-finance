"""Рендер reel.html в кадры PNG.
python3 render.py OUTDIR [fps] [t1,t2,...]  — без списка рендерит весь ролик.
"""
import sys, os, pathlib, http.server, threading, functools
from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
fps = int(sys.argv[2]) if len(sys.argv) > 2 else 30
times = [float(x) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 else None

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(here))
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1080, "height": 1920})
    pg.goto(f"http://127.0.0.1:{srv.server_port}/reel.html?render=1")
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(300)
    dur = pg.evaluate("window.DURATION")
    if times is None:
        times = [i / fps for i in range(int(dur * fps))]
    start = int(os.environ.get('START', '0'))
    for i, t in enumerate(times):
        if i < start or i >= int(os.environ.get('END', '999999')):
            continue
        pg.evaluate(f"render({t})")
        pg.screenshot(path=str(out / f"f{i:05d}.png"))
    b.close()
srv.shutdown()
print(len(times), "frames")
