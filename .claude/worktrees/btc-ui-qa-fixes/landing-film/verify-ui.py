# verify-ui.py — prova de navegador da landing do BTC Radar.
# Carrega, confere o gate, digita a senha, scrolla o scrub e confere o video.
import sys

from playwright.sync_api import sync_playwright

URL = "https://btc-radar.higgsfield.app"

errors = []
console = []
failed = []
with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    )
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: console.append(f"{m.type}: {m.text[:160]}") if m.type in ("error", "warning") else None)
    page.on("requestfailed", lambda r: failed.append(f"{r.method} {r.url}"))

    page.goto(URL, wait_until="networkidle", timeout=90000)
    print("1. gate visivel:", page.locator("text=Area restrita").count() > 0)

    page.fill('input[type="password"]', "Coragem@10")
    page.click('button[type="submit"]')
    page.wait_for_selector(".scroll-scrub", timeout=30000)
    print("2. scroll-scrub montado apos senha:", True)

    btns = page.locator(".scroll-scrub__route-button").count()
    h1 = page.locator("h1").first.inner_text()
    print("3. capitulos:", btns, "| h1:", h1[:50])

    # scrolla para mover o scrub e pintar o primeiro video
    for _ in range(3):
        page.mouse.wheel(0, 900)
        page.wait_for_timeout(400)
    try:
        page.wait_for_selector(".scroll-scrub__layer[data-video-painted]", timeout=30000)
        print("4. video pintou frame apos scroll:", True)
    except Exception:
        print("4. video pintou frame apos scroll: False")

    # estado dos videos
    vstate = page.evaluate(
        """() => Array.from(document.querySelectorAll('video')).map(v => ({
             src: (v.src || '').slice(-40), ready: v.readyState, t: v.currentTime.toFixed(2), dur: v.duration }))"""
    )
    print("5. videos:", vstate)

    # capitulo 2
    page.locator(".scroll-scrub__route-button").nth(1).click()
    page.wait_for_timeout(2000)
    print("6. capitulo 2 visivel apos navegacao:",
          page.locator('article[id="signals"]').is_visible())

    page.screenshot(path=r"E:\Diretorio\Claude\ARQUIVO\Btc-radar\btc-radar\landing-film\verify-final.png")

    browser.close()

print("7. pageerrors:", errors if errors else "nenhum")
print("8. console erros:", console if console else "nenhum")
print("9. requests falhos:", failed if failed else "nenhum")
