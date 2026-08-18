#!/bin/bash
# 맥용 서명·공증 빌드.
# 공증까지 끝내면 사용자 화면에 "악성 코드가 없음을 확인할 수 없습니다" 경고가 뜨지 않는다.
#
# 서명 준비는 이미 끝나 있다:
#   - Developer ID Application 인증서를 전용 키체인(sshotpin-signing)에 설치
#   - 서명 시 키체인 승인창이 뜨지 않도록 파티션 목록 설정 완료
#   - 그 키체인 암호는 로그인 키체인에 보관 (아래에서 자동으로 꺼내 씀)
#
# 남은 준비물은 공증 자격증명 하나뿐이다. 없으면 아래에서 방법을 알려준다.

set -e
TEAM_ID="T5YN2MB5DY"
PROFILE="sshotpin"
KC_NAME="sshotpin-signing.keychain-db"
KC_PATH="$HOME/Library/Keychains/$KC_NAME"
BUILD_DIR="$HOME/sshotpin-build"
# electron-builder는 종류 prefix를 붙이면 거부한다 (인증서는 자동 선택)
IDENTITY="Yongsu Jung (T5YN2MB5DY)"

echo "── 준비 상태 확인 ──"

# 1) 서명 키체인 해제
if [ ! -f "$KC_PATH" ]; then
  echo "✗ 서명 키체인이 없습니다: $KC_PATH"
  echo "  인증서를 다시 설치해야 합니다."
  exit 1
fi
KC_PW=$(security find-generic-password -a sshotpin -s sshotpin-signing-kc -w 2>/dev/null || true)
if [ -z "$KC_PW" ]; then
  echo "✗ 서명 키체인 암호를 로그인 키체인에서 찾지 못했습니다."
  exit 1
fi
security unlock-keychain -p "$KC_PW" "$KC_NAME"
# 검색 목록에 들어 있어야 codesign이 찾는다
security list-keychains -d user | grep -q "$KC_NAME" \
  || security list-keychains -d user -s "$KC_PATH" "$HOME/Library/Keychains/login.keychain-db"
echo "✓ 서명 키체인 준비"

# 2) 인증서
security find-identity -v -p codesigning "$KC_NAME" | grep -q "Developer ID Application" \
  || { echo "✗ 전용 키체인에 Developer ID Application 인증서가 없습니다."; exit 1; }
echo "✓ Developer ID Application 인증서"

# 3) 공증 자격증명
if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  cat <<MSG

✗ 공증 자격증명(키체인 프로필 "$PROFILE")이 없습니다. 이것만 하면 끝납니다.

  ① 앱 암호 발급 — Apple 계정 암호가 아닌 전용 암호입니다.
     https://account.apple.com 로그인 → 로그인 및 보안 → 앱 암호
     → + 를 눌러 이름을 "스샷핀 공증"으로 만들고 나온 암호를 복사
     (xxxx-xxxx-xxxx-xxxx 형태)

  ② 아래 명령을 실행하고, 암호를 물어보면 붙여넣기
     (암호는 화면에 표시되지 않고 키체인에만 저장됩니다)

  xcrun notarytool store-credentials "$PROFILE" \\
    --apple-id "본인_애플_아이디" \\
    --team-id "$TEAM_ID"

  ③ 이 스크립트를 다시 실행

MSG
  exit 1
fi
echo "✓ 공증 자격증명"

echo
echo "── 빌드 + 서명 + 공증 (10~20분, 공증 심사 대기 포함) ──"
cd "$BUILD_DIR"
export CSC_KEYCHAIN="$KC_PATH"
export CSC_NAME="$IDENTITY"
# electron-builder 26: notarize는 boolean이고 팀 ID·자격증명은 환경변수로 받는다
export APPLE_KEYCHAIN_PROFILE="$PROFILE"
export APPLE_TEAM_ID="$TEAM_ID"
npx electron-builder --mac --arm64 --x64 -c.mac.notarize=true

VER=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")

# DMG 이름을 여기에 다시 적지 않는다. package.json의 artifactName을 그대로 채워 쓴다.
# (예전에는 손으로 적어두어서 이름 규칙이 바뀌면 이 스크립트만 옛 이름을 찾다가
#  "파일 없음"으로 조용히 넘어갔다)
dmg_name() {
  python3 -c "
import json, sys
tpl = json.load(open('package.json'))['build']['mac']['artifactName']
print(tpl.replace('\${version}', sys.argv[1]).replace('\${arch}', sys.argv[2]).replace('\${ext}', 'dmg'))
" "$VER" "$1"
}

# electron-builder는 .app만 서명·공증하고 그 뒤에 DMG를 만든다.
# 사용자가 내려받는 파일은 DMG이므로 DMG도 직접 처리해야 한다.
# 순서가 중요하다: 서명 → 공증 → 티켓 부착.
# (서명을 나중에 하면 파일이 바뀌어 붙여둔 티켓이 무효가 된다.
#  서명이 없으면 spctl이 "no usable signature"로 거부한다.)
echo
echo "── DMG 서명 + 공증 (배포 파일 자체) ──"
for ARCH in arm64 x64; do
  DMG="dist/$(dmg_name "$ARCH")"
  [ -f "$DMG" ] || continue
  echo "· $ARCH 서명…"
  codesign --force --keychain "$KC_PATH" \
    --sign "Developer ID Application: Yongsu Jung ($TEAM_ID)" \
    --timestamp "$DMG" 2>&1 | tail -1
  echo "· $ARCH 공증 제출… (몇 분 걸립니다)"
  xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait 2>&1 \
    | grep -E "^ *status:|^ *message:" | tail -2
  xcrun stapler staple "$DMG" >/dev/null 2>&1 && echo "  티켓 부착" || echo "  티켓 부착 실패"
done

# electron-builder는 DMG를 만든 직후 latest-mac.yml에 해시·크기를 적는다.
# 그런데 위에서 서명·공증 티켓을 붙이면서 DMG 내용이 바뀌므로 그 값이 어긋난다.
# 자동 업데이트는 내려받은 파일의 sha512를 대조하므로, 어긋나면 설치가 거부된다.
# 최종 파일 기준으로 다시 적어준다.
echo
echo "── latest-mac.yml 해시 재계산 (서명·공증 후 파일 기준) ──"
python3 <<'PY'
import base64, hashlib, os, re, sys

YML = 'dist/latest-mac.yml'
if not os.path.exists(YML):
    sys.exit('latest-mac.yml이 없습니다')

def digest(p):
    h = hashlib.sha512()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return base64.b64encode(h.digest()).decode()

# electron-builder가 쓴 파일을 그대로 두고 sha512·size 값만 실제 파일 기준으로 바꾼다.
# (목록·순서·그 밖의 필드를 건드리지 않아야 zip·dmg가 늘어나도 그대로 따라간다)
lines = open(YML).read().splitlines()
cache, cur, changed = {}, None, 0
for i, line in enumerate(lines):
    m = re.match(r'^(\s*)-?\s*url:\s*(\S+)\s*$', line)
    if m:
        cur = m.group(2)
        p = os.path.join('dist', cur)
        cache[cur] = (digest(p), os.path.getsize(p)) if os.path.exists(p) else None
        if cache[cur] is None:
            print(f'  ! {cur} 파일을 찾지 못해 건너뜀')
        continue
    if cur and cache.get(cur):
        sha, size = cache[cur]
        m2 = re.match(r'^(\s*)sha512:\s*(\S+)\s*$', line)
        if m2:
            if m2.group(2) != sha: changed += 1
            lines[i] = f'{m2.group(1)}sha512: {sha}'
            continue
        m3 = re.match(r'^(\s*)size:\s*(\d+)\s*$', line)
        if m3:
            lines[i] = f'{m3.group(1)}size: {size}'
            continue

# 맨 아래 path/sha512는 files 목록과 별개로 한 번 더 적혀 있다
path = next((l.split(':', 1)[1].strip() for l in lines if l.startswith('path:')), None)
if path and cache.get(path):
    for i, line in enumerate(lines):
        if line.startswith('sha512:'):
            lines[i] = f'sha512: {cache[path][0]}'

open(YML, 'w').write('\n'.join(lines) + '\n')
for name, v in cache.items():
    if v: print(f'  {name}  {v[1]}바이트')
print(f'  → 해시 {changed}개 바로잡음')
PY

echo
echo "── 검증 ──"
FAIL=0
for ARCH in arm64 x64; do
  DMG="dist/$(dmg_name "$ARCH")"
  [ -f "$DMG" ] || { echo "✗ $DMG 없음"; FAIL=1; continue; }
  if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
    echo "✓ $ARCH — 공증 티켓 부착됨"
  else
    echo "✗ $ARCH — 공증 티켓 없음"; FAIL=1
  fi
  OUT=$(spctl -a -vvv -t open --context context:primary-signature "$DMG" 2>&1)
  if echo "$OUT" | grep -q accepted; then
    echo "✓ $ARCH — Gatekeeper 통과 (경고 안 뜸)"
  else
    echo "✗ $ARCH — Gatekeeper 거부: $(echo "$OUT" | head -2 | tr '\n' ' ')"; FAIL=1
  fi
done

if [ $FAIL -eq 0 ]; then
  echo; echo "완료 — 이 dmg는 경고 없이 열립니다."
else
  echo; echo "문제가 있습니다. 위 항목을 확인하세요."; exit 1
fi
