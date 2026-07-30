#!/usr/bin/env python3
"""스샷핀 OG 이미지(1200x630) 생성 — 카톡·페북·트위터 공유 미리보기용"""
from PIL import Image, ImageDraw, ImageFont
import os

BASE = os.path.join(os.path.dirname(__file__), '..', 'web')
ICON = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icon.png')

W, H = 1200, 630
img = Image.new('RGB', (W, H), (15, 23, 42))
d = ImageDraw.Draw(img)

# 배경 장식 — 오른쪽 아래 은은한 원
d.ellipse([W - 260, H - 260, W + 120, H + 120], fill=(30, 41, 59))

def font(size, bold=True):
    candidates = [
        '/System/Library/Fonts/AppleSDGothicNeo.ttc',
        '/Library/Fonts/AppleGothic.ttf',
        '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size, index=10 if bold and p.endswith('.ttc') else 0)
            except Exception:
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    pass
    return ImageFont.load_default()

# 아이콘
icon = Image.open(ICON).convert('RGBA').resize((190, 190), Image.LANCZOS)
img.paste(icon, (92, 108), icon)

# 텍스트
d.text((92, 330), '스샷핀', font=font(96), fill=(248, 250, 252))
d.text((96, 452), '스샷을 콕! 화면에 붙이는 수업 도구', font=font(40), fill=(148, 163, 184))
d.text((96, 522), '캡처 · 화면 고정 · 확대 · 판서 · 타이머 · 정답 가리개', font=font(28), fill=(100, 116, 139))

# 우측 배지
badge = 'Windows 무료'
bw, bh = 300, 64
bx, by = W - bw - 92, 108
d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=32, fill=(37, 99, 235))
tb = d.textbbox((0, 0), badge, font=font(30))
d.text((bx + (bw - (tb[2] - tb[0])) / 2, by + (bh - (tb[3] - tb[1])) / 2 - 4),
       badge, font=font(30), fill=(255, 255, 255))

out = os.path.join(BASE, 'og.png')
img.save(out, optimize=True)
print('OG 이미지 생성:', out, img.size)
