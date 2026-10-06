# render-film.py — filme scroll-scrub do BTC Radar a partir de candles reais da OKX.
# Renderiza 12s em 3 clipes de 4s (96 frames cada) a 24fps, 1280x720.
# Dados: candles.json da API publica OKX (bar=1H), barras em formacao descartadas.

import json
import math
import os

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
FPS = 24
DUR = 12.0
N = int(DUR * FPS)  # 288

CW, GAP = 12, 3
STEP = CW + GAP  # 15px por candle
MARGIN_X = 60
CHART_TOP = 130
CHART_BOTTOM = 600
CY = 360.0  # centro vertical do mundo

BG_TOP = (11, 17, 32)
BG_BOT = (14, 24, 48)
GRID = (148, 163, 184, 16)
GREEN = (34, 197, 94)
RED = (239, 68, 68)
GOLD = (232, 179, 58)
CLOSE_LINE = GOLD

FONT_PATH = r"C:\Windows\Fonts\arialbd.ttf"


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def load_candles(path):
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    rows = []
    for d in payload["data"]:
        if d[8] != "1":  # barra em formacao, descarta
            continue
        rows.append((int(d[0]), float(d[1]), float(d[2]), float(d[3]), float(d[4])))
    rows.reverse()  # mais antiga primeiro
    return rows


def zoom_at(t):
    # zoom: 1.0 ate 4s, sobe a 1.18 em 4..8s, volta a 1.0 em 8..12s
    if t < 4.0:
        return 1.0
    elif t < 8.0:
        return 1.0 + 0.18 * smooth((t - 4.0) / 4.0)
    return 1.18 - 0.18 * smooth((t - 8.0) / 4.0)


def build_base():
    base = Image.new("RGB", (W, H), BG_TOP)
    d = ImageDraw.Draw(base)
    # gradiente vertical sutil
    for y in range(H):
        u = y / H
        r = int(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * u)
        g = int(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * u)
        b = int(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * u)
        d.line([(0, y), (W, y)], fill=(r, g, b))
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for x in range(0, W, 160):
        od.line([(x, 0), (x, H)], fill=GRID)
    for y in range(0, H, 90):
        od.line([(0, y), (W, y)], fill=GRID)
    base.paste(Image.alpha_composite(base.convert("RGBA"), ov).convert("RGB"), (0, 0))
    return base


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    candles = load_candles(os.path.join(here, "candles.json"))
    n = len(candles)
    world_w = n * STEP + 2 * MARGIN_X

    lows = [c[3] for c in candles]
    highs = [c[2] for c in candles]
    lo = min(lows)
    hi = max(highs)
    pad = (hi - lo) * 0.12
    ylo = lo - pad
    yhi = hi + pad
    span = max(yhi - ylo, 1e-9)

    def wx(i):
        return MARGIN_X + i * STEP

    def wy(p):
        return CHART_BOTTOM - (p - ylo) / span * (CHART_BOTTOM - CHART_TOP)

    def sx(x, cx, s):
        return (x - cx) * s + W / 2.0

    def sy(y, s):
        return (y - CY) * s + H / 2.0

    # INITIAL_VISIBLE candelas ja aparecem prontas no frame 0 (o poster e esse frame
    # exato), as demais entram progressivamente pela borda direita. Sem isso a camera
    # corre atras de um mundo quase vazio e so um punhado de candelas cabe no canto.
    INITIAL_VISIBLE = 55
    CAMERA_LEAD = 220.0  # px de folga entre a ultima candela revelada e o centro
    reveal_span = DUR * 0.95
    reveal_i = [
        -10.0
        if i < INITIAL_VISIBLE
        else ((i - INITIAL_VISIBLE) / (n - INITIAL_VISIBLE)) * reveal_span
        for i in range(n)
    ]

    def frontier_idx(t):
        frac = min(1.0, max(0.0, t / reveal_span))
        return min((INITIAL_VISIBLE - 1) + frac * (n - INITIAL_VISIBLE), n - 1)

    def cam(t):
        cx = wx(frontier_idx(t)) - CAMERA_LEAD
        return cx, zoom_at(t)

    # candle de destaque do clipe 2: maior range do terco central
    mid_start = n // 3
    mid_end = 2 * n // 3
    highlight = max(range(mid_start, mid_end), key=lambda i: candles[i][2] - candles[i][3])

    font = ImageFont.truetype(FONT_PATH, 24)
    last_close = candles[-1][4]
    ticker = f"BTC/USDT   {last_close:,.1f}    |    1H    |    OKX"
    ticker_bbox = font.getbbox(ticker)

    base = build_base()
    out_root = os.path.join(here, "frames")
    for clip in (1, 2, 3):
        os.makedirs(os.path.join(out_root, f"clip{clip}"), exist_ok=True)

    for frame in range(N):
        t = frame / FPS
        cx, s = cam(t)
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)

        # close line com glow, alfa revelado por tempo
        pts = []
        for i in range(n):
            pts.append((sx(wx(i), cx, s), sy(wy(candles[i][4]), s)))
        alphas = [smooth((t - reveal_i[i]) / 0.35) for i in range(n)]

        for width, alpha in ((6, 40), (2, 150), (1, 255)):
            for i in range(n - 1):
                a = int(max(alphas[i], alphas[i + 1]) * alpha)
                if a <= 0:
                    continue
                x0, y0 = pts[i]
                x1, y1 = pts[i + 1]
                d.line([(x0, y0), (x1, y1)], fill=(GOLD[0], GOLD[1], GOLD[2], a), width=max(1, int(width * s)))

        # candles
        for i in range(n):
            a = int(alphas[i] * 255)
            if a <= 0:
                continue
            ts, o, h, l, c = candles[i]
            color = GREEN if c >= o else RED
            x0 = sx(wx(i) - CW / 2, cx, s)
            x1 = sx(wx(i) + CW / 2, cx, s)
            yo = sy(wy(o), s)
            yc = sy(wy(c), s)
            yh = sy(wy(h), s)
            yl = sy(wy(l), s)
            d.line([((x0 + x1) / 2, yh), ((x0 + x1) / 2, yl)], fill=(color[0], color[1], color[2], a), width=max(1, int(1 * s)))
            d.rectangle([x0, min(yo, yc), x1, max(yo, yc)], fill=(color[0], color[1], color[2], a))

        # destaque pulsante no clipe 2
        if 4.0 <= t < 8.0:
            pulse = int(100 + 90 * abs(math.sin((t - 4.0) * math.pi)))
            i = highlight
            x0 = sx(wx(i) - CW / 2, cx, s)
            x1 = sx(wx(i) + CW / 2, cx, s)
            yh = sy(wy(candles[i][2]), s)
            yl = sy(wy(candles[i][3]), s)
            d.rectangle([x0 - 3, yh - 3, x1 + 3, yl + 3], outline=(GOLD[0], GOLD[1], GOLD[2], pulse), width=2)

        # ticker no clipe 3
        if t >= 8.4:
            a = int(smooth((t - 8.4) / 0.7) * 255)
            tx, ty = 28, 22
            d.text((tx + 2, ty + 2), ticker, font=font, fill=(0, 0, 0, int(a * 0.5)))
            d.text((tx, ty), ticker, font=font, fill=(GOLD[0], GOLD[1], GOLD[2], a))
            bar_end = tx + ticker_bbox[2] - ticker_bbox[0]
            d.rectangle([tx, ty + 40, bar_end, ty + 42], fill=(GOLD[0], GOLD[1], GOLD[2], int(a * 0.7)))

        out = Image.alpha_composite(base.convert("RGBA"), ov).convert("RGB")
        clip = 1 if frame < 96 else (2 if frame < 192 else 3)
        out.save(os.path.join(out_root, f"clip{clip}", f"frame_{frame % 96:03d}.png"))

    print(f"render ok: {N} frames em 3 clipes, {n} candles, ultimo close {last_close}")


if __name__ == "__main__":
    main()
