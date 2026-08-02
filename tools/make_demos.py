#!/usr/bin/env python3
"""메인 페이지용 기능 데모 영상 생성 (PIL 프레임 → ffmpeg mp4).

기능별로 한 편씩. 목록은 파일 끝 CLIPS 참고.
인수를 주면 그 이름이 포함된 클립만 다시 만든다:  python3 tools/make_demos.py zoom draw
"""
import math
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 800, 500
FPS = 30
OUT = os.path.join(os.path.dirname(__file__), '..', 'web')

FONT_PATH = '/System/Library/Fonts/AppleSDGothicNeo.ttc'


def font(size):
    return ImageFont.truetype(FONT_PATH, size)


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def seg(f, a, b):
    """프레임 f가 [a,b] 구간에서 0→1로 진행하는 비율."""
    if b <= a:
        return 1.0
    return ease((f - a) / (b - a))


def draw_cursor(d, x, y):
    pts = [(0, 0), (0, 17), (4.6, 13), (7.6, 19.6), (10.4, 18.4), (7.4, 12), (12.4, 12)]
    poly = [(x + px, y + py) for px, py in pts]
    d.polygon(poly, fill=(20, 24, 34), outline=(255, 255, 255))


def click_ripple(d, x, y, t):
    if t <= 0 or t >= 1:
        return
    r = 6 + 18 * t
    alpha = int(160 * (1 - t))
    d.ellipse([x - r, y - r, x + r, y + r], outline=(59, 130, 246, alpha), width=3)


def cursor_path(f, keys):
    """keys: [(frame, x, y), ...] 사이를 부드럽게 이동."""
    if f <= keys[0][0]:
        return keys[0][1], keys[0][2]
    for (f0, x0, y0), (f1, x1, y1) in zip(keys, keys[1:]):
        if f <= f1:
            t = seg(f, f0, f1)
            return lerp(x0, x1, t), lerp(y0, y1, t)
    return keys[-1][1], keys[-1][2]


_EMOJI_FONT_PATH = '/System/Library/Fonts/Apple Color Emoji.ttc'
_EMOJI_CACHE = {}


def emoji(img, ch, x, y, size):
    """컬러 이모지를 그린다.

    PIL은 한글 폰트로 이모지를 못 그려서 빈 사각형이 된다. Apple Color Emoji는
    160px 한 종류만 렌더되므로, 크게 그린 뒤 필요한 크기로 줄여 붙인다.
    """
    key = (ch, size)
    if key not in _EMOJI_CACHE:
        try:
            f = ImageFont.truetype(_EMOJI_FONT_PATH, 160)
            big = Image.new('RGBA', (200, 200), (0, 0, 0, 0))
            ImageDraw.Draw(big).text((12, 18), ch, font=f, embedded_color=True)
            bb = big.getbbox()
            glyph = big.crop(bb) if bb else big
            _EMOJI_CACHE[key] = glyph.resize((size, size), Image.LANCZOS)
        except Exception:
            _EMOJI_CACHE[key] = None
    g = _EMOJI_CACHE[key]
    if g is None:
        return
    img.paste(g, (int(x), int(y)), g)


def caption(d, text):
    """화면 아래 가운데 자막."""
    bb = d.textbbox((0, 0), text, font=font(15))
    w = bb[2] + 44
    d.rounded_rectangle([W / 2 - w / 2, H - 42, W / 2 + w / 2, H - 12],
                        radius=15, fill=(15, 23, 42))
    d.text((W / 2 - bb[2] / 2, H - 38), text, font=font(15), fill=(241, 245, 249))


def desktop_bg():
    img = Image.new('RGB', (W, H), (226, 232, 240))
    d = ImageDraw.Draw(img)
    # 메뉴바 느낌의 상단 띠
    d.rectangle([0, 0, W, 24], fill=(203, 213, 225))
    return img


def window(d, x0, y0, x1, y1, title, active=True):
    d.rounded_rectangle([x0 + 3, y0 + 4, x1 + 3, y1 + 4], radius=12, fill=(148, 163, 184))  # 그림자
    d.rounded_rectangle([x0, y0, x1, y1], radius=12, fill=(255, 255, 255),
                        outline=(148, 163, 184) if active else (203, 213, 225), width=1)
    d.rounded_rectangle([x0, y0, x1, y0 + 34], radius=12, fill=(241, 245, 249))
    d.rectangle([x0, y0 + 20, x1, y0 + 34], fill=(241, 245, 249))
    for i, c in enumerate([(252, 165, 165), (253, 224, 71), (134, 239, 172)]):
        cx = x0 + 16 + i * 18
        d.ellipse([cx - 5, y0 + 12, cx + 5, y0 + 22], fill=c)
    d.text((x0 + 70, y0 + 9), title, font=font(13), fill=(71, 85, 105))


def doc_window(d, scroll=0):
    """수업 자료 창 — 문제 하나와 회색 본문 줄.

    주석을 정확한 위치에 얹으려면 좌표를 짐작하지 말고 실제 글자
    바운딩 박스를 돌려받아 써야 한다.
    """
    window(d, 70, 60, 730, 470, '3단원 수업자료.pdf')
    y = 120 - scroll
    boxes = {}
    d.text((110, y), '문제 3.', font=font(20), fill=(30, 41, 59))
    d.text((190, y), '밑변이 6cm, 높이가 4cm인 삼각형의', font=font(20), fill=(30, 41, 59))
    line2 = '넓이를 구하시오.'
    d.text((110, y + 34), line2, font=font(20), fill=(30, 41, 59))
    boxes['line2'] = d.textbbox((110, y + 34), line2, font=font(20))
    boxes['label4'] = d.textbbox((306, y + 136), '4cm', font=font(15))
    # 삼각형 그림
    d.polygon([(160, y + 190), (360, y + 190), (300, y + 100)],
              outline=(59, 130, 246), width=3)
    d.line([(300, y + 100), (300, y + 190)], fill=(148, 163, 184), width=2)
    d.text((250, y + 196), '6cm', font=font(15), fill=(71, 85, 105))
    d.text((306, y + 136), '4cm', font=font(15), fill=(71, 85, 105))
    # 본문 줄 (회색 바)
    for i in range(4):
        yy = y + 250 + i * 26
        if 100 < yy < 450:
            d.rounded_rectangle([110, yy, 110 + (520 - i * 60), yy + 12],
                                radius=6, fill=(226, 232, 240))
    return boxes


def toolbar(d, x, y, active_btn=None):
    """캡처 도구모음 — (버튼이름, 중심좌표) 목록을 돌려준다."""
    btns = [('arrow', '↗'), ('rect', '▭'), ('ellipse', '◯'),
            ('sep', None), ('pin', '핀'), ('copy', '복사'), ('save', '저장')]
    widths = {'arrow': 36, 'rect': 36, 'ellipse': 36, 'sep': 10, 'pin': 58, 'copy': 52, 'save': 52}
    total = sum(widths[k] for k, _ in btns) + 16
    d.rounded_rectangle([x, y, x + total, y + 44], radius=10, fill=(15, 23, 42))
    cx = x + 8
    centers = {}
    for key, label in btns:
        w = widths[key]
        if key == 'sep':
            d.line([(cx + 5, y + 10), (cx + 5, y + 34)], fill=(71, 85, 105), width=1)
        else:
            if key == active_btn:
                d.rounded_rectangle([cx, y + 6, cx + w, y + 38], radius=8, fill=(37, 99, 235))
            elif key == 'pin':
                d.rounded_rectangle([cx, y + 6, cx + w, y + 38], radius=8, fill=(37, 99, 235))
            fill = (241, 245, 249)
            fnt = font(17 if len(label) == 1 else 14)
            bb = d.textbbox((0, 0), label, font=fnt)
            d.text((cx + (w - bb[2]) / 2, y + 22 - (bb[3] - bb[1]) / 2 - bb[1]),
                   label, font=fnt, fill=fill)
        centers[key] = (cx + w / 2, y + 22)
        cx += w
    return centers


def red_arrow(d, x0, y0, x1, y1, t):
    """t(0~1)만큼 그려지는 빨간 화살표."""
    if t <= 0:
        return
    xe, ye = lerp(x0, x1, t), lerp(y0, y1, t)
    d.line([(x0, y0), (xe, ye)], fill=(239, 68, 68), width=6)
    if t > 0.55:
        ang = math.atan2(y1 - y0, x1 - x0)
        head = 20
        for da in (-0.45, 0.45):
            d.line([(xe, ye),
                    (xe - head * math.cos(ang + da), ye - head * math.sin(ang + da))],
                   fill=(239, 68, 68), width=6)


def veil_over(img, sel=None, alpha=110):
    """반투명 어둠 + 선택 영역만 밝게."""
    ov = Image.new('RGBA', (W, H), (0, 0, 0, alpha))
    if sel:
        x0, y0, x1, y1 = sel
        cut = Image.new('RGBA', (int(x1 - x0), int(y1 - y0)), (0, 0, 0, 0))
        ov.paste(cut, (int(x0), int(y0)))
    img.paste(Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB'), (0, 0))


# ---------------------------------------------------------------- clip A

def clip_pin(frames_dir):
    SEL = (170, 100, 560, 330)
    n = 0
    total = 175
    cur = [
        (0, 640, 420), (18, 640, 420),
        (26, SEL[0], SEL[1]),                 # 선택 시작점
        (58, SEL[2], SEL[3]),                 # 드래그 끝
        (70, 250, 170), (96, 470, 285),       # 화살표 긋기
        (108, 0, 0),                          # (핀 버튼 위치는 프레임에서 계산)
        (150, 660, 430), (175, 660, 430),
    ]
    for f in range(total):
        img = desktop_bg()
        d = ImageDraw.Draw(img)
        doc_window(d)

        veil_on = f >= 20
        drag_t = seg(f, 26, 58)
        sel_now = None
        if f >= 26:
            sel_now = (SEL[0], SEL[1],
                       lerp(SEL[0] + 8, SEL[2], drag_t), lerp(SEL[1] + 8, SEL[3], drag_t))

        arrow_t = seg(f, 74, 96)
        pin_done = f >= 116

        if veil_on and not pin_done:
            veil_over(img, sel_now)
            d = ImageDraw.Draw(img)
            if sel_now:
                d.rectangle(sel_now, outline=(59, 130, 246), width=3)

        # 화살표 (선택 영역 안)
        if not pin_done and arrow_t > 0:
            red_arrow(d, 240, 160, 480, 290, arrow_t)

        centers = {}
        if 58 <= f and not pin_done:
            centers = toolbar(d, SEL[0] + 40, SEL[3] + 14,
                              active_btn='arrow' if f < 100 else None)

        if pin_done:
            # 다른 창이 앞으로 나옴 — 핀은 그 위에 남는다
            sl = seg(f, 116, 140)
            wy = int(lerp(520, 120, sl))
            window(d, 240, wy, 780, wy + 360, '출석부.xlsx')
            for i in range(6):
                yy = wy + 60 + i * 34
                if yy < wy + 340:
                    d.rounded_rectangle([270, yy, 620, yy + 12], radius=6, fill=(226, 232, 240))
            # 핀(캡처 결과) — 항상 위
            pw, ph = int((SEL[2] - SEL[0]) * 0.82), int((SEL[3] - SEL[1]) * 0.82)
            px, py = 60, 70
            pin_img = Image.new('RGB', (pw, ph), (255, 255, 255))
            pd = ImageDraw.Draw(pin_img)
            pd.text((28, 18), '문제 3.', font=font(17), fill=(30, 41, 59))
            pd.text((95, 18), '밑변 6cm, 높이 4cm인', font=font(17), fill=(30, 41, 59))
            pd.text((28, 46), '삼각형의 넓이는?', font=font(17), fill=(30, 41, 59))
            pd.polygon([(70, 170), (215, 170), (170, 100)], outline=(59, 130, 246), width=3)
            red_arrow(pd, 60, 60, 250, 150, 1.0)
            sh = Image.new('RGB', (W, H), (0, 0, 0))
            img.paste((100, 116, 139), (px + 6, py + 8, px + pw + 6, py + ph + 8))
            img.paste(pin_img, (px, py))
            d = ImageDraw.Draw(img)
            d.rectangle([px, py, px + pw, py + ph], outline=(59, 130, 246), width=3)
            # 모서리의 작은 핀 표시 (이모지 대신 직접 그림)
            d.ellipse([px + pw - 26, py + 8, px + pw - 8, py + 26], fill=(229, 57, 53))
            d.line([(px + pw - 17, py + 24), (px + pw - 22, py + 34)], fill=(30, 41, 59), width=3)
            d.text((520, 60), '창을 바꿔도 핀은 그대로', font=font(17), fill=(15, 23, 42))

        # 커서
        if 100 <= f < 116 and 'pin' in centers:
            cx, cy = cursor_path(f, [(96, 470, 285), (108, *centers['pin']), (116, *centers['pin'])])
        else:
            cx, cy = cursor_path(f, cur)
        if 108 <= f <= 118 and 'pin' in centers:
            click_ripple(d, *centers['pin'], seg(f, 108, 118))
        draw_cursor(d, cx, cy)

        # 캡션
        cap = ''
        if f < 20: cap = '자료에서 필요한 부분만'
        elif f < 60: cap = '드래그해서 캡처'
        elif f < 105: cap = '그 자리에서 화살표까지'
        elif f < 116: cap = '핀 버튼 클릭'
        else: cap = '화면 맨 위에 고정'
        caption(d, cap)

        img.save(f'{frames_dir}/f_{n:04d}.png')
        n += 1
    return n


# ---------------------------------------------------------------- clip B

def clip_cover(frames_dir):
    total = 150
    ANS = (330, 250, 520, 310)   # 정답 영역
    n = 0
    cur = [
        (0, 640, 420), (16, 640, 420),
        (24, ANS[0], ANS[1]),
        (48, ANS[2], ANS[3]),
        (66, (ANS[0] + ANS[2]) / 2, (ANS[1] + ANS[3]) / 2),
        (150, (ANS[0] + ANS[2]) / 2, (ANS[1] + ANS[3]) / 2),
    ]
    for f in range(total):
        img = desktop_bg()
        d = ImageDraw.Draw(img)
        window(d, 70, 60, 730, 470, '쪽지시험.pdf')
        d.text((110, 120), '문제.  7 × 8 = ?', font=font(24), fill=(30, 41, 59))
        d.text((110, 265), '정답:', font=font(22), fill=(30, 41, 59))
        d.text((340, 262), '56', font=font(26), fill=(220, 38, 38))

        drag_t = seg(f, 24, 48)
        covered = None
        if f >= 24:
            covered = (ANS[0], ANS[1], lerp(ANS[0] + 10, ANS[2], drag_t), ANS[3])

        # 공개/가리기 토글: 84f에 공개, 120f에 다시 가림
        revealed = 84 <= f < 120

        if covered and not revealed:
            x0, y0, x1, y1 = covered
            d.rounded_rectangle([x0, y0, x1, y1], radius=8, fill=(30, 41, 59))
            if drag_t >= 1:
                bb = d.textbbox((0, 0), '?', font=font(26))
                d.text(((x0 + x1) / 2 - bb[2] / 2, (y0 + y1) / 2 - 18), '?',
                       font=font(26), fill=(241, 245, 249))
        elif covered and revealed:
            d.rounded_rectangle(covered, radius=8, outline=(100, 116, 139), width=2)

        cx, cy = cursor_path(f, cur)
        for click_f in (78, 114):
            if click_f <= f <= click_f + 10:
                click_ripple(d, cx, cy, seg(f, click_f, click_f + 10))
        draw_cursor(d, cx, cy)

        if f < 20: cap = '정답을 미리 가려두기'
        elif f < 55: cap = '드래그하면 가림판 생성'
        elif f < 84: cap = '학생들 답을 듣고'
        elif f < 120: cap = '클릭 한 번으로 공개'
        else: cap = '다시 클릭하면 가려짐'
        caption(d, cap)

        img.save(f'{frames_dir}/f_{n:04d}.png')
        n += 1
    return n


# ---------------------------------------------------------------- clip C

def clip_zoom(frames_dir):
    total = 150
    n = 0
    for f in range(total):
        base = desktop_bg()
        d = ImageDraw.Draw(base)
        boxes = doc_window(d)          # 글자 위치를 실측해서 받아온다

        # 18~60f: 1.0 → 1.8배 확대 (문제 텍스트 중심)
        z = lerp(1.0, 1.8, seg(f, 18, 60))
        cx, cy = 300, 230
        x0 = y0 = 0
        sx = sy = 1.0
        if z > 1.001:
            zw, zh = int(W / z), int(H / z)
            x0 = int(min(max(cx - zw / 2, 0), W - zw))
            y0 = int(min(max(cy - zh / 2, 0), H - zh))
            base = base.crop((x0, y0, x0 + zw, y0 + zh)).resize((W, H), Image.LANCZOS)
            sx, sy = W / zw, H / zh
        d = ImageDraw.Draw(base)

        def mp(bx, by):
            """문서 좌표 → 지금 화면(확대 반영) 좌표."""
            return ((bx - x0) * sx, (by - y0) * sy)

        # 밑줄 (66~96f) — 실측한 글자 박스 바로 아래에 정확히 긋는다
        ut = seg(f, 66, 96)
        if ut > 0:
            bx0, _, bx1, by1 = boxes['line2']
            ux0, uy = mp(bx0, by1 + 5)
            ux1, _ = mp(bx1, by1 + 5)
            d.line([(ux0, uy), (lerp(ux0, ux1, ut), uy)], fill=(239, 68, 68), width=7)

        # 동그라미 (100~126f) — '4cm' 라벨을 감싸도록
        ot = seg(f, 100, 126)
        if ot > 0:
            lx0, ly0, lx1, ly1 = boxes['label4']
            ccx, ccy = mp((lx0 + lx1) / 2, (ly0 + ly1) / 2)
            r = max((lx1 - lx0) * sx, (ly1 - ly0) * sy) / 2 + 16
            d.arc([ccx - r, ccy - r, ccx + r, ccy + r], -90, -90 + 360 * ot,
                  fill=(239, 68, 68), width=6)

        if f < 18: cap = '뒷자리에서 잘 안 보일 때'
        elif f < 62: cap = '휠로 화면 확대'
        elif f < 98: cap = '그대로 밑줄 긋고'
        else: cap = '중요한 곳에 동그라미'
        caption(d, cap)

        base.save(f'{frames_dir}/f_{n:04d}.png')
        n += 1
    return n


# ---------------------------------------------------------------- clip D 판서

def pen_toolbar(img, d, x, y, active_color=0, board=None):
    cols = [(239, 68, 68), (247, 115, 22), (234, 179, 8),
            (34, 197, 94), (59, 130, 246), (30, 41, 59)]
    wide = 22 * len(cols) + 150
    d.rounded_rectangle([x, y, x + wide, y + 40], radius=10, fill=(15, 23, 42))
    cxx = x + 12
    for i, c in enumerate(cols):
        r = 9
        d.ellipse([cxx, y + 11, cxx + 2 * r, y + 11 + 2 * r], fill=c,
                  outline=(255, 255, 255) if i == active_color else (71, 85, 105),
                  width=2 if i == active_color else 1)
        cxx += 22
    cxx += 8
    marks = [('⬜', board == 'white'), ('⬛', board == 'black'), ('🗑', False)]
    for label, on in marks:
        if on:
            d.rounded_rectangle([cxx - 4, y + 6, cxx + 26, y + 34], radius=7, fill=(37, 99, 235))
        cxx += 34
    cxx = x + 22 * 6 + 20
    for label, _ in marks:
        emoji(img, label, cxx, y + 11, 18)
        cxx += 34


def clip_draw(frames_dir):
    total = 165
    n = 0
    for f in range(total):
        board = 'white' if f >= 118 else None
        if board:
            img = Image.new('RGB', (W, H), (248, 250, 252))
            d = ImageDraw.Draw(img)
            boxes = None
        else:
            img = desktop_bg()
            d = ImageDraw.Draw(img)
            boxes = doc_window(d)

        color_i = 0 if f < 76 else 4
        if f >= 10:
            pen_toolbar(img, d, 210, H - 96, active_color=color_i, board=board)
            d = ImageDraw.Draw(img)

        if boxes:
            # 빨간 밑줄 (24~62f) — 글자 박스 아래
            ut = seg(f, 24, 62)
            if ut > 0:
                bx0, _, bx1, by1 = boxes['line2']
                d.line([(bx0, by1 + 5), (lerp(bx0, bx1, ut), by1 + 5)],
                       fill=(239, 68, 68), width=6)
            # 파란 동그라미 (80~112f) — 4cm 라벨
            ot = seg(f, 80, 112)
            if ot > 0:
                lx0, ly0, lx1, ly1 = boxes['label4']
                ccx, ccy = (lx0 + lx1) / 2, (ly0 + ly1) / 2
                r = max(lx1 - lx0, ly1 - ly0) / 2 + 16
                d.arc([ccx - r, ccy - r, ccx + r, ccy + r], -90, -90 + 360 * ot,
                      fill=(59, 130, 246), width=6)
        else:
            # 흰 칠판에 새로 그리기
            t = seg(f, 126, 158)
            if t > 0:
                d.line([(200, 180), (lerp(200, 560, t), 180)], fill=(59, 130, 246), width=7)
                if t > 0.5:
                    tt = seg(f, 142, 160)
                    d.arc([300, 230, 420, 350], -90, -90 + 360 * tt,
                          fill=(239, 68, 68), width=6)

        if f < 20: cap = '화면 위에 바로 그리기'
        elif f < 70: cap = '드래그하면 펜'
        elif f < 116: cap = '색을 바꿔서 강조'
        else: cap = '빈 칠판으로도 전환'
        caption(d, cap)
        img.save(f'{frames_dir}/f_{n:04d}.png')
        n += 1
    return n


# ---------------------------------------------------------------- clip E 모자이크

def clip_mosaic(frames_dir):
    total = 140
    n = 0
    AREA = (272, 158, 575, 262)
    cur = [(0, 640, 400), (16, 640, 400), (26, AREA[0], AREA[1]),
           (60, AREA[2], AREA[3]), (140, AREA[2] + 30, AREA[3] + 30)]
    for f in range(total):
        img = desktop_bg()
        d = ImageDraw.Draw(img)
        window(d, 70, 60, 730, 470, '학생 명단.xlsx')
        rows = [('김민준', '010-2345-6781'), ('이서연', '010-3456-7892'),
                ('박지호', '010-4567-8903')]
        d.text((110, 130), '이름', font=font(15), fill=(100, 116, 139))
        d.text((280, 130), '연락처', font=font(15), fill=(100, 116, 139))
        for i, (nm, ph) in enumerate(rows):
            yy = 165 + i * 34
            d.text((110, yy), nm, font=font(18), fill=(30, 41, 59))
            d.text((280, yy), ph, font=font(18), fill=(30, 41, 59))

        drag_t = seg(f, 26, 60)
        if f >= 26:
            x1 = lerp(AREA[0] + 10, AREA[2], drag_t)
            reg = (AREA[0], AREA[1], x1, AREA[3])
            # 실제 앱처럼 원본을 격자 단위로 확대해 모자이크
            src = img.crop((int(reg[0]), int(reg[1]), int(reg[2]), int(reg[3])))
            cell = 9
            small = src.resize((max(1, src.width // cell), max(1, src.height // cell)),
                               Image.BILINEAR)
            img.paste(small.resize(src.size, Image.NEAREST), (int(reg[0]), int(reg[1])))
            d = ImageDraw.Draw(img)
            if drag_t < 1:
                d.rectangle(reg, outline=(59, 130, 246), width=2)

        cx, cy = cursor_path(f, cur)
        draw_cursor(d, cx, cy)
        if f < 22: cap = '가려야 할 정보가 보일 때'
        elif f < 66: cap = '드래그로 모자이크'
        else: cap = '그 부분만 알아볼 수 없게'
        caption(d, cap)
        img.save(f'{frames_dir}/f_{n:04d}.png')
        n += 1
    return n


# ---------------------------------------------------------------- clip F 최근 캡처

def clip_history(frames_dir):
    total = 145
    n = 0
    THUMB = (150, 190)
    cur = [(0, 640, 420), (30, 640, 420), (54, THUMB[0] + 55, THUMB[1] + 40),
           (145, THUMB[0] + 55, THUMB[1] + 40)]
    for f in range(total):
        img = desktop_bg()
        d = ImageDraw.Draw(img)
        window(d, 100, 110, 700, 430, '최근 캡처')
        d.text((130, 150), '최근 캡처', font=font(18), fill=(30, 41, 59))
        for i in range(4):
            tx = 130 + (i % 4) * 140
            ty = 190
            d.rounded_rectangle([tx, ty, tx + 120, ty + 84], radius=8,
                                fill=(255, 255, 255), outline=(203, 213, 225))
            d.rounded_rectangle([tx + 10, ty + 12, tx + 96, ty + 20], radius=4,
                                fill=(226, 232, 240))
            d.polygon([(tx + 20, ty + 70), (tx + 74, ty + 70), (tx + 50, ty + 34)],
                      outline=(147, 197, 253), width=2)
            d.text((tx + 8, ty + 90), f'{600 - i * 40}×{420 - i * 20}',
                   font=font(11), fill=(100, 116, 139))
        if 54 <= f <= 70:
            d.rounded_rectangle([THUMB[0] - 3, THUMB[1] - 3, THUMB[0] + 123, THUMB[1] + 87],
                                radius=9, outline=(37, 99, 235), width=3)

        if f >= 78:
            s = seg(f, 78, 104)
            pw, ph = int(300 * s), int(210 * s)
            px, py = 430, 90
            if pw > 12:
                d.rounded_rectangle([px, py, px + pw, py + ph], radius=6,
                                    fill=(255, 255, 255), outline=(59, 130, 246), width=3)
                if s > 0.6:
                    d.rounded_rectangle([px + 20, py + 24, px + pw - 60, py + 36],
                                        radius=5, fill=(226, 232, 240))
                    d.polygon([(px + 40, py + ph - 40), (px + pw - 90, py + ph - 40),
                               (px + pw / 2 - 20, py + 70)], outline=(59, 130, 246), width=3)
                    d.ellipse([px + pw - 26, py + 8, px + pw - 8, py + 26], fill=(229, 57, 53))

        cx, cy = cursor_path(f, cur)
        if 60 <= f <= 72:
            click_ripple(d, cx, cy, seg(f, 60, 72))
        draw_cursor(d, cx, cy)
        if f < 40: cap = '앞에서 쓴 캡처가 쌓여 있고'
        elif f < 78: cap = '그림을 클릭하면'
        else: cap = '다시 화면에 붙습니다'
        caption(d, cap)
        img.save(f'{frames_dir}/f_{n:04d}.png')
        n += 1
    return n


# ---------------------------------------------------------------- clip G 타이머

TIMER_BTNS = [('-30초', 62), ('▶ 시작', 84), ('리셋', 44), ('+30초', 62)]


def clip_timer(frames_dir):
    total = 150
    n = 0
    TX, TY = 250, 150
    cur = [(0, 620, 400), (18, 620, 400), (34, TX + 150, TY + 78),
           (60, TX + 150, TY + 78), (76, TX + 60, TY + 148), (150, TX + 60, TY + 148)]
    for f in range(total):
        img = desktop_bg()
        d = ImageDraw.Draw(img)
        # 타이머 위젯
        alarm = f >= 132 and (f // 5) % 2 == 0
        d.rounded_rectangle([TX, TY, TX + 300, TY + 176], radius=14,
                            fill=(124, 45, 18) if alarm else (15, 23, 42),
                            outline=(51, 65, 85))
        d.text((TX + 16, TY + 12), '수업 타이머 · 시간을 클릭하면 직접 입력',
               font=font(12), fill=(148, 163, 184))
        editing = 42 <= f < 72
        if editing:
            d.rounded_rectangle([TX + 70, TY + 44, TX + 230, TY + 104], radius=8,
                                fill=(30, 41, 59), outline=(37, 99, 235), width=2)
            typed = '3:00'[:max(0, (f - 44) // 5)]
            d.text((TX + 96, TY + 52), typed or '|', font=font(40), fill=(241, 245, 249))
        else:
            if f < 42:
                label = '05:00'
            elif f < 84:
                label = '03:00'
            else:
                left = max(0, 180 - (f - 84) * 3)
                label = f'{left // 60:02d}:{left % 60:02d}'
            if f >= 132:
                label = '시간 종료'
            d.text((TX + (44 if f >= 132 else 62), TY + (58 if f >= 132 else 44)), label,
                   font=font(36 if f >= 132 else 52), fill=(241, 245, 249))
        for i, (bl, w) in enumerate(TIMER_BTNS):
            bx = TX + 16 + sum(x for _, x in TIMER_BTNS[:i]) + i * 6
            running = f >= 84 and i == 1
            d.rounded_rectangle([bx, TY + 128, bx + w, TY + 160], radius=8,
                                fill=(37, 99, 235) if i == 1 else (30, 41, 59))
            txt = '⏸ 정지' if running else bl
            bb = d.textbbox((0, 0), txt, font=font(13))
            d.text((bx + (w - bb[2]) / 2, TY + 137), txt, font=font(13), fill=(226, 232, 240))

        cx, cy = cursor_path(f, cur)
        for cf in (36, 80):
            if cf <= f <= cf + 10:
                click_ripple(d, cx, cy, seg(f, cf, cf + 10))
        draw_cursor(d, cx, cy)
        if f < 34: cap = '남은 시간을 띄워두기'
        elif f < 74: cap = '시간을 클릭해 직접 입력'
        elif f < 130: cap = '시작하면 카운트다운'
        else: cap = '끝나면 알려줍니다'
        caption(d, cap)
        img.save(f'{frames_dir}/f_{n:04d}.png')
        n += 1
    return n


# ---------------------------------------------------------------- clip H 퀵 실행바

QB_ICONS = ['📸', '📌', '🔍', '✏️', '⏱️', '🕘', '❓', '⚙️']
QB_NAMES = ['영역 캡처', '클립보드 핀', '화면 확대', '판서', '타이머', '최근 캡처', '사용법', '설정']


def clip_quickbar(frames_dir):
    total = 170
    n = 0
    for f in range(total):
        img = desktop_bg()
        d = ImageDraw.Draw(img)
        doc_window(d)
        # (아래에서 이모지를 붙일 때마다 d를 다시 만들어야 한다)

        # 110f 이후 아래로 이동
        move_t = seg(f, 118, 150)
        bx = lerp(200, 200, move_t)
        by = lerp(40, 330, move_t)
        bw = 34 * len(QB_ICONS) + 46
        d.rounded_rectangle([bx, by, bx + bw, by + 44], radius=22, fill=(15, 23, 42),
                            outline=(100, 116, 139))
        d.text((bx + 12, by + 13), '⠿', font=font(15), fill=(100, 116, 139))
        hover = None
        if 18 <= f < 114:
            hover = min(len(QB_ICONS) - 1, (f - 18) // 12)
        for i, ic in enumerate(QB_ICONS):
            ix = bx + 32 + i * 34
            if i == hover:
                d.rounded_rectangle([ix - 4, by + 5, ix + 30, by + 39], radius=9,
                                    fill=(51, 65, 85))
        for i, ic in enumerate(QB_ICONS):
            emoji(img, ic, bx + 32 + i * 34, by + 13, 19)
        d = ImageDraw.Draw(img)
        if hover is not None:
            tip = QB_NAMES[hover]
            tw = d.textbbox((0, 0), tip, font=font(13))[2] + 20
            tx = bx + 32 + hover * 34 + 13 - tw / 2
            ty = by + 52
            d.rounded_rectangle([tx, ty, tx + tw, ty + 28], radius=7, fill=(30, 41, 59))
            d.text((tx + 10, ty + 5), tip, font=font(13), fill=(226, 232, 240))
            draw_cursor(d, bx + 32 + hover * 34 + 12, by + 34)
        else:
            handle_x = bx + 16
            draw_cursor(d, handle_x, by + 22)

        if f < 16: cap = '화면 위에 떠 있는 버튼바'
        elif f < 114: cap = '버튼 하나로 기능 실행'
        else: cap = '원하는 자리로 옮겨두기'
        caption(d, cap)
        img.save(f'{frames_dir}/f_{n:04d}.png')
        n += 1
    return n


# ---------------------------------------------------------------- clip I 핀 조작

def clip_pinops(frames_dir):
    total = 165
    n = 0
    for f in range(total):
        img = desktop_bg()
        d = ImageDraw.Draw(img)
        window(d, 60, 250, 740, 470, '메모.txt')
        for i in range(4):
            d.rounded_rectangle([90, 300 + i * 30, 90 + (560 - i * 70), 312 + i * 30],
                                radius=6, fill=(226, 232, 240))

        # 휠로 확대 (20~56f) → Ctrl+휠 투명도 (70~104f) → 더블클릭 접기 (120f~)
        grow = lerp(1.0, 1.35, seg(f, 20, 56))
        fade = 1.0 - 0.55 * seg(f, 70, 104)
        collapsed = f >= 124
        pw, ph = int(300 * grow), int(200 * grow)
        px, py = 120, 70

        if collapsed:
            d.rounded_rectangle([px, py, px + 170, py + 34], radius=7,
                                fill=(30, 41, 59), outline=(59, 130, 246))
            emoji(img, '📌', px + 12, py + 9, 16)
            d = ImageDraw.Draw(img)
            d.text((px + 36, py + 8), '접힌 핀', font=font(14), fill=(226, 232, 240))
        else:
            pin = Image.new('RGB', (pw, ph), (255, 255, 255))
            pdw = ImageDraw.Draw(pin)
            pdw.rounded_rectangle([18, 18, pw - 70, 30], radius=5, fill=(226, 232, 240))
            pdw.polygon([(40, ph - 34), (pw - 70, ph - 34), (pw / 2 - 14, 60)],
                        outline=(59, 130, 246), width=3)
            if fade < 1.0:
                bgc = img.crop((px, py, px + pw, py + ph))
                pin = Image.blend(bgc, pin, fade)
            img.paste(pin, (px, py))
            d = ImageDraw.Draw(img)
            d.rectangle([px, py, px + pw, py + ph], outline=(59, 130, 246), width=3)
            d.ellipse([px + pw - 26, py + 8, px + pw - 8, py + 26], fill=(229, 57, 53))

        cx, cy = px + pw / 2, py + ph / 2
        draw_cursor(d, cx, cy if not collapsed else py + 18)
        if 120 <= f <= 132:
            click_ripple(d, cx, py + 18, seg(f, 120, 132))

        if f < 18: cap = '붙여둔 핀은 마우스로 조절'
        elif f < 64: cap = '휠로 크기 조절'
        elif f < 116: cap = 'Ctrl+휠로 투명하게'
        else: cap = '더블클릭하면 접힘'
        caption(d, cap)
        img.save(f'{frames_dir}/f_{n:04d}.png')
        n += 1
    return n


def encode(frames_dir, out_name):
    out = os.path.join(OUT, out_name)
    subprocess.run([
        'ffmpeg', '-y', '-framerate', str(FPS),
        '-i', f'{frames_dir}/f_%04d.png',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '27',
        '-movflags', '+faststart', out,
    ], check=True, capture_output=True)
    return out


def build(name, fn):
    tmp = tempfile.mkdtemp(prefix='sshotpin_demo_')
    try:
        fn(tmp)
        out = encode(tmp, name)
        print(name, f'{os.path.getsize(out) / 1024:.0f}KB')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


CLIPS = [
    ('demo-pin.mp4', clip_pin),
    ('demo-zoom.mp4', clip_zoom),
    ('demo-draw.mp4', clip_draw),
    ('demo-cover.mp4', clip_cover),
    ('demo-mosaic.mp4', clip_mosaic),
    ('demo-history.mp4', clip_history),
    ('demo-timer.mp4', clip_timer),
    ('demo-quickbar.mp4', clip_quickbar),
    ('demo-pinops.mp4', clip_pinops),
]

if __name__ == '__main__':
    import sys
    want = sys.argv[1:]
    for name, fn in CLIPS:
        if want and not any(w in name for w in want):
            continue
        build(name, fn)
