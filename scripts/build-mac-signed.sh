#!/bin/bash
# 맥용 서명·공증 빌드.
# 공증까지 끝내면 사용자 화면에 "악성 코드가 없음을 확인할 수 없습니다" 경고가 뜨지 않는다.
#
# 준비물 두 가지 (한 번만 하면 됨):
#   1. Developer ID Application 인증서 (웹 배포용 — 앱스토어용과 다름)
#   2. notarytool 키체인 프로필 "sshotpin"
# 준비가 안 됐으면 아래에서 무엇을 해야 하는지 알려준다.

set -e
TEAM_ID="T5YN2MB5DY"
PROFILE="sshotpin"
BUILD_DIR="$HOME/sshotpin-build"

echo "── 준비 상태 확인 ──"

if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  cat <<'MSG'
✗ Developer ID Application 인증서가 없습니다.

  현재 키체인에는 앱스토어 배포용 "Apple Distribution"만 있습니다.
  웹사이트에서 직접 내려받는 앱은 "Developer ID Application"으로
  서명해야 공증이 통과합니다.

  만드는 법 (Xcode가 대신 처리해 줍니다):
    1. Xcode 실행 → 메뉴 Xcode → Settings… → Accounts 탭
    2. 왼쪽 아래 + → Apple ID → 개발자 계정으로 로그인
    3. 팀(Yongsu Jung) 선택 → 오른쪽 아래 Manage Certificates…
    4. 왼쪽 아래 + → "Developer ID Application" 선택
    5. 목록에 생기면 창을 닫고 이 스크립트를 다시 실행

MSG
  exit 1
fi
echo "✓ Developer ID Application 인증서 있음"

if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  cat <<MSG
✗ 공증 자격증명(키체인 프로필 "$PROFILE")이 없습니다.

  앱 암호를 먼저 발급받아야 합니다 (Apple 계정 암호가 아닌 전용 암호):
    1. https://account.apple.com 로그인 → 로그인 및 보안 → 앱 암호
    2. + 를 눌러 이름을 "스샷핀 공증"으로 만들고 나온 암호를 복사
       (xxxx-xxxx-xxxx-xxxx 형태)
    3. 아래 명령을 직접 실행하고, 물어보면 그 암호를 붙여넣기

  xcrun notarytool store-credentials "$PROFILE" \\
    --apple-id "본인_애플_아이디@example.com" \\
    --team-id "$TEAM_ID"

  끝나면 이 스크립트를 다시 실행하세요.

MSG
  exit 1
fi
echo "✓ 공증 자격증명 있음"

echo
echo "── 빌드 + 서명 + 공증 (10~20분 걸립니다) ──"
cd "$BUILD_DIR"
APPLE_KEYCHAIN_PROFILE="$PROFILE" \
  npx electron-builder --mac --arm64 --x64 \
  -c.mac.notarize.teamId="$TEAM_ID"

echo
echo "── 검증 ──"
VER=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")
FAIL=0
for ARCH in arm64 x64; do
  DMG="dist/SshotPin-${VER}-mac-${ARCH}.dmg"
  [ -f "$DMG" ] || { echo "✗ $DMG 없음"; FAIL=1; continue; }
  # 공증 티켓이 dmg에 붙었는지, Gatekeeper가 통과시키는지
  if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
    echo "✓ $ARCH — 공증 티켓 부착됨"
  else
    echo "✗ $ARCH — 공증 티켓 없음"; FAIL=1
  fi
  if spctl -a -vvv -t open --context context:primary-signature "$DMG" 2>&1 | grep -q accepted; then
    echo "✓ $ARCH — Gatekeeper 통과 (경고 안 뜸)"
  else
    echo "✗ $ARCH — Gatekeeper 거부"; FAIL=1
  fi
done

[ $FAIL -eq 0 ] && echo && echo "완료 — 이 dmg는 경고 없이 열립니다." || { echo; echo "문제가 있습니다. 위 항목을 확인하세요."; exit 1; }
