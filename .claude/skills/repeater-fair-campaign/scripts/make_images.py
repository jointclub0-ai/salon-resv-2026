"""Repeater Fair キャンペーン用の画像を生成する。

出力（--out ディレクトリ）:
  richmenu.png      LINEリッチメニュー（2500x1686・6分割 A〜F、A+B=予約バナー）
  broadcast.jpg     LINE配信用の縦長画像（1080x1350）
  richmessage.jpg   リッチメッセージ用の正方形画像（1040x1040）

例:
  python3 make_images.py --season WINTER --headline "全商品" --discount "20%OFF" \
    --deadline "11/30（月）" --handover "12/5（土）" --out /path/to/out
"""
import argparse
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PHOTO = os.path.join(HERE, "..", "assets", "product-photo-w.jpg")

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]

NAVY = (24, 36, 62)
GOLD = (201, 169, 110)
ICE = (232, 240, 248)
WHITE = (255, 255, 255)
GRAYTXT = (110, 120, 140)


def font_path():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit("日本語フォントが見つかりません: " + ", ".join(FONT_CANDIDATES))


FONT = None


def f(size):
    return ImageFont.truetype(FONT, size)


def gradient(w, h):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(20 + 24 * t), int(30 + 36 * t), int(56 + 60 * t)))
    return img


def fit(im, w, h, ybias=0.6):
    s = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * s) + 1, int(im.height * s) + 1), Image.LANCZOS)
    x = (im.width - w) // 2
    y = int((im.height - h) * ybias)
    return im.crop((x, y, x + w, y + h))


def paste_photo(img, photo, x, y, w, h, radius=32):
    ph = fit(photo, w, h)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius, fill=255)
    sh = Image.new("L", (w + 60, h + 60), 0)
    ImageDraw.Draw(sh).rounded_rectangle([30, 30, w + 29, h + 29], radius, fill=150)
    img.paste((5, 10, 25), (x - 30, y - 18), sh.filter(ImageFilter.GaussianBlur(16)))
    img.paste(ph, (x, y), mask)


def snow(d, w, h, n, avoid, seed):
    """avoid: [(x0,y0,x1,y1), ...] 文字や写真に雪が重ならないようにする領域"""
    rnd = random.Random(seed)
    for _ in range(n):
        x, y = rnd.randint(0, w), rnd.randint(0, h)
        if any(a <= x <= c and b <= y <= e for a, b, c, e in avoid):
            continue
        r = rnd.choice([2, 2, 3, 4])
        d.ellipse([x - r, y - r, x + r, y + r], fill=WHITE)


def richmenu(a, photo, out):
    W, H = 2500, 1686
    CW = [0, 833, 1666, 2500]
    RH = [0, 843, 1686]
    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)

    # A+B: キャンペーンバナー（A・Bとも予約フォームにリンクする前提）
    banner = gradient(1666, 843)
    PW, PH = 560, 730
    bx = 1666 - PW - 70
    bd = ImageDraw.Draw(banner)
    snow(bd, 1666, 843, 90, [(0, 60, 1000, 830), (bx - 20, 36, bx + PW + 20, 56 + PH + 20)], 3)
    paste_photo(banner, photo, bx, 56, PW, PH)
    bd = ImageDraw.Draw(banner)
    bd.text((90, 95), "Repeater Fair " + a.year, font=f(54), fill=GOLD)
    bd.text((90, 160), a.season, font=f(54), fill=GOLD)
    bd.text((90, 265), a.headline, font=f(96), fill=WHITE)
    bd.text((90, 375), a.discount, font=f(190), fill=WHITE)
    bd.text((95, 585), a.subline, font=f(44), fill=ICE)
    bd.text((95, 650), f"予約受付 〜{a.deadline}　お渡し {a.handover}〜", font=f(40), fill=ICE)
    bd.rounded_rectangle([90, 730, 690, 810], 40, fill=GOLD)
    bd.text((390, 770), "LINEで予約する  →", font=f(42), fill=NAVY, anchor="mm")
    img.paste(banner, (0, 0))

    def tile(c, r, bg, title, sub, fg, subfg, icon):
        x0, x1, y0, y1 = CW[c], CW[c + 1], RH[r], RH[r + 1]
        d.rectangle([x0, y0, x1, y1], fill=bg)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        icon(cx, cy - 150)
        d.text((cx, cy + 20), title, font=f(84), fill=fg, anchor="mm")
        d.text((cx, cy + 120), sub, font=f(44), fill=subfg, anchor="mm")

    def lupine(cx, cy):
        d.line([cx, cy - 80, cx, cy + 80], fill=GOLD, width=6)
        for i, yy in enumerate(range(cy - 70, cy + 50, 24)):
            w = 10 + i * 5
            d.ellipse([cx - w - 14, yy - 9, cx - 14, yy + 9], outline=GOLD, width=5)
            d.ellipse([cx + 14, yy - 9, cx + w + 14, yy + 9], outline=GOLD, width=5)

    def octagon(cx, cy):
        d.regular_polygon((cx, cy, 60), 8, outline=GOLD, width=6)

    def calendar(cx, cy):
        c = (200, 40, 90)
        d.rounded_rectangle([cx - 70, cy - 60, cx + 70, cy + 70], 16, outline=c, width=7)
        d.line([cx - 70, cy - 20, cx + 70, cy - 20], fill=c, width=7)
        d.line([cx - 35, cy + 25, cx - 5, cy + 50, cx + 45, cy - 5], fill=c, width=9)

    def insta(cx, cy):
        c = (193, 53, 132)
        d.rounded_rectangle([cx - 70, cy - 70, cx + 70, cy + 70], 38, outline=c, width=8)
        d.ellipse([cx - 32, cy - 32, cx + 32, cy + 32], outline=c, width=8)
        d.ellipse([cx + 38, cy - 48, cx + 52, cy - 34], fill=c)

    # C: Lupinus（提携エステ）
    tile(2, 0, ICE, "Lupinus", "ヘッドスパ・エステ", NAVY, (90, 100, 120), lupine)
    if a.lupinus_badge:
        d.rounded_rectangle([CW[2] + 216, 640, CW[3] - 216, 720], 40, fill=GOLD)
        d.text(((CW[2] + CW[3]) // 2, 680), a.lupinus_badge, font=f(44), fill=NAVY, anchor="mm")
    tile(0, 1, (20, 20, 22), "JOINT CLUB", "ATTRACT YOUR GRAND STYLE", GOLD, (170, 150, 110), octagon)
    tile(1, 1, (255, 246, 248), "ネット予約", "ホットペッパービューティー", (200, 40, 90), (150, 80, 100), calendar)
    tile(2, 1, (250, 245, 252), "Instagram", "最新スタイル＆情報", (150, 40, 110), (140, 90, 130), insta)

    for x in (833, 1666):
        d.line([x, 843 if x == 833 else 0, x, H], fill=(220, 220, 225), width=4)
    d.line([0, 843, W, 843], fill=(220, 220, 225), width=4)
    img.save(os.path.join(out, "richmenu.png"))


def broadcast(a, photo, out):
    W, H = 1080, 1350
    img = gradient(W, H)
    PW, PH, px, py = 560, 700, 1080 - 560 - 60, 300
    d = ImageDraw.Draw(img)
    snow(d, W, H, 160, [(px - 20, py - 20, px + PW + 20, py + PH + 20), (40, 290, 520, 1010),
                        (0, 120, W, 250), (0, 1040, W, H)], 7)
    paste_photo(img, photo, px, py, PW, PH, 36)
    d = ImageDraw.Draw(img)
    d.text((W // 2, 95), "joint club", font=f(40), fill=GOLD, anchor="mm")
    d.text((W // 2, 160), "Repeater Fair " + a.year, font=f(58), fill=WHITE, anchor="mm")
    d.text((W // 2, 228), f"— {a.season} —", font=f(44), fill=GOLD, anchor="mm")
    d.text((60, 330), a.headline, font=f(84), fill=WHITE)
    num, _, rest = a.discount.partition("%")
    d.text((52, 430), num, font=f(210), fill=WHITE)
    d.text((60, 640), "%" + rest, font=f(110), fill=GOLD)
    for i, line in enumerate(["サロン専売", "シャンプー", "トリートメント", "アウトバス"]):
        d.text((62, 790 + 55 * i), line, font=f(40), fill=ICE)
    d.rounded_rectangle([60, 1050, W - 60, 1200], 24, fill=WHITE)
    d.text((100, 1080), "予約受付", font=f(34), fill=GRAYTXT)
    d.text((260, 1074), f"{a.deadline}まで", font=f(44), fill=NAVY)
    d.text((100, 1142), "お渡し", font=f(34), fill=GRAYTXT)
    d.text((260, 1136), f"{a.handover}以降のご来店時", font=f(44), fill=NAVY)
    d.rounded_rectangle([200, 1235, W - 200, 1310], 38, fill=GOLD)
    d.text((W // 2, 1272), "LINEから簡単予約  →", font=f(40), fill=NAVY, anchor="mm")
    img.save(os.path.join(out, "broadcast.jpg"), quality=92)


def richmessage(a, photo, out):
    W = H = 1040
    img = gradient(W, H)
    PW, PH, px, py = 440, 560, 1040 - 440 - 50, 215
    d = ImageDraw.Draw(img)
    snow(d, W, H, 120, [(px - 20, py - 20, px + PW + 20, py + PH + 20), (30, 200, 560, 790),
                        (0, 50, W, 175), (0, 800, W, H)], 11)
    paste_photo(img, photo, px, py, PW, PH, 30)
    d = ImageDraw.Draw(img)
    d.text((W // 2, 75), "joint club  Repeater Fair " + a.year, font=f(44), fill=WHITE, anchor="mm")
    d.text((W // 2, 140), f"— {a.season} —", font=f(40), fill=GOLD, anchor="mm")
    d.text((50, 225), a.headline, font=f(76), fill=WHITE)
    num, _, rest = a.discount.partition("%")
    d.text((42, 315), num, font=f(190), fill=WHITE)
    d.text((50, 505), "%" + rest, font=f(100), fill=GOLD)
    d.text((52, 650), "サロン専売 シャンプー", font=f(34), fill=ICE)
    d.text((52, 700), "トリートメント・アウトバス", font=f(34), fill=ICE)
    d.rounded_rectangle([50, 815, W - 50, 935], 22, fill=WHITE)
    d.text((90, 835), "予約受付", font=f(30), fill=GRAYTXT)
    d.text((240, 830), f"{a.deadline}まで", font=f(38), fill=NAVY)
    d.text((90, 885), "お渡し", font=f(30), fill=GRAYTXT)
    d.text((240, 880), f"{a.handover}以降のご来店時", font=f(38), fill=NAVY)
    d.rounded_rectangle([230, 960, W - 230, 1020], 30, fill=GOLD)
    d.text((W // 2, 990), "タップしてLINEで予約  →", font=f(34), fill=NAVY, anchor="mm")
    img.save(os.path.join(out, "richmessage.jpg"), quality=92)


def main():
    global FONT
    p = argparse.ArgumentParser()
    p.add_argument("--year", default="2026")
    p.add_argument("--season", required=True, help="例: WINTER / SPRING / SUMMER")
    p.add_argument("--headline", default="全商品", help="割引の対象。例: 全商品 / 大容量")
    p.add_argument("--discount", default="20%OFF", help="例: 20%%OFF（数字%%OFF の形）")
    p.add_argument("--subline", default="サロン専売シャンプー・トリートメント")
    p.add_argument("--deadline", required=True, help="例: 11/30（月）")
    p.add_argument("--handover", required=True, help="例: 12/5（土）")
    p.add_argument("--lupinus-badge", default="初回 20%OFF", help="空文字で帯を出さない")
    p.add_argument("--photo", default=DEFAULT_PHOTO)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    FONT = font_path()
    os.makedirs(a.out, exist_ok=True)
    photo = Image.open(a.photo).convert("RGB")
    richmenu(a, photo, a.out)
    broadcast(a, photo, a.out)
    richmessage(a, photo, a.out)
    for n in ("richmenu.png", "broadcast.jpg", "richmessage.jpg"):
        path = os.path.join(a.out, n)
        print(f"{path}  {os.path.getsize(path) // 1024}KB")


if __name__ == "__main__":
    main()
