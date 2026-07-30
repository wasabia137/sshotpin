#!/usr/bin/env python3
"""스샷핀 아이콘 생성 — 스샷 카드 + 파란 핀"""
from PIL import Image, ImageDraw
import os

BASE = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(BASE, exist_ok=True)

S = 512
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 스샷 카드 (흰 바탕, 짙은 테두리)
d.rounded_rectangle([56, 104, 400, 440], radius=44, fill=(255, 255, 255, 255),
                    outline=(30, 41, 59, 255), width=18)
# 카드 안 그림: 해 + 산
d.ellipse([110, 160, 176, 226], fill=(250, 204, 21, 255))
d.polygon([(96, 392), (208, 240), (300, 392)], fill=(96, 165, 250, 255))
d.polygon([(244, 392), (330, 282), (404, 392)], fill=(59, 130, 246, 255))
# 산 폴리곤이 카드 밖으로 삐져나온 부분 지우기
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([56 + 9, 104 + 9, 400 - 9, 440 - 9], radius=36, fill=255)
card_only = Image.new('RGBA', (S, S), (0, 0, 0, 0))
card_only.paste(img, (0, 0), mask)
base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(base)
bd.rounded_rectangle([56, 104, 400, 440], radius=44, fill=(255, 255, 255, 255),
                     outline=(30, 41, 59, 255), width=18)
base.alpha_composite(card_only)
img = base
d = ImageDraw.Draw(img)

# 핀 (빨강 헤드 + 바늘) — 카드 오른쪽 위에 크게 꽂힘
d.line([(388, 168), (300, 256)], fill=(30, 41, 59, 255), width=28)  # 바늘
d.ellipse([312, 8, 496, 192], fill=(229, 57, 53, 255), outline=(30, 41, 59, 255), width=16)
d.ellipse([352, 44, 412, 104], fill=(255, 205, 210, 255))  # 하이라이트

# 저장
img.resize((256, 256), Image.LANCZOS).save(os.path.join(BASE, 'icon.png'))
img.resize((32, 32), Image.LANCZOS).save(os.path.join(BASE, 'tray.png'))
img.resize((256, 256), Image.LANCZOS).save(
    os.path.join(BASE, 'icon.ico'),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('아이콘 생성 완료:', os.listdir(BASE))
