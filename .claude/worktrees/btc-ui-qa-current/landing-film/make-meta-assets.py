# make-meta-assets.py — favicon e cover do BTC Radar para app-meta.json.
from PIL import Image, ImageDraw, ImageFont

FONT = r"C:\Windows\Fonts\arialbd.ttf"
BG_TOP = (11, 17, 32)
BG_BOT = (14, 24, 48)
GOLD = (232, 179, 58)
INK = (241, 245, 249)
MUTED = (148, 163, 184)

here = r"E:\Diretorio\Claude\ARQUIVO\Btc-radar\btc-radar\landing-film"
world = r"E:\Diretorio\Claude\ARQUIVO\Btc-radar\btc-radar\landing-higgsfield\app\public\assets\world"

# favicon 32x32
fav = Image.new("RGB", (32, 32), BG_TOP)
fd = ImageDraw.Draw(fav)
fd.rectangle([4, 4, 27, 27], outline=GOLD, width=2)
fav.save(here + r"\favicon.png")
# "B" no favicon 32px com fonte 16
fd = ImageDraw.Draw(fav)
font = ImageFont.truetype(FONT, 18)
bbox = font.getbbox("B")
fd.text(((32 - (bbox[2] - bbox[0])) / 2 - bbox[0], (32 - (bbox[3] - bbox[1])) / 2 - bbox[1]), "B", font=font, fill=GOLD)
fav.save(world + r"\favicon.png")

# cover 1200x630
W, H = 1200, 630
cover = Image.new("RGB", (W, H), BG_TOP)
d = ImageDraw.Draw(cover)
for y in range(H):
    u = y / H
    r = int(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * u)
    g = int(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * u)
    b = int(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * u)
    d.line([(0, y), (W, y)], fill=(r, g, b))
font_big = ImageFont.truetype(FONT, 96)
font_mid = ImageFont.truetype(FONT, 36)
title = "BTC Radar"
sub = "Sinais de trading, dominancia, medo e ganancia e backtest de Bitcoin"
tb = font_big.getbbox(title)
d.text(((W - (tb[2] - tb[0])) / 2 - tb[0], 170), title, font=font_big, fill=GOLD)
sb = font_mid.getbbox(sub)
d.text(((W - (sb[2] - sb[0])) / 2 - sb[0], 320), sub, font=font_mid, fill=INK)
bar_w = 220
d.rectangle([(W - bar_w) / 2, 430, (W + bar_w) / 2, 436], fill=GOLD)
cover.save(world + r"\cover.png")
cover.save(here + r"\cover.png")

print("meta assets ok: favicon.png e cover.png em assets/world")
