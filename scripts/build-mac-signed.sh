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
IDENTITY="Developer ID Application: Yongsu Jung (T5YN2MB5DY)"

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
export APPLE_KEYCHAIN_PROFILE="$PROFILE"
npx electron-builder --mac --arm64 --x64 \
  -c.mac.notarize.teamId="$TEAM_ID"

echo
echo "── 검증 ──"
VER=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")
FAIL=0
for ARCH in arm64 x64; do
  DMG="dist/SshotPin-${VER}-mac-${ARCH}.dmg"
  [ -f "$DMG" ] || { echo "✗ $DMG 없음"; FAIL=1; continue; }
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

if [ $FAIL -eq 0 ]; then
  echo; echo "완료 — 이 dmg는 경고 없이 열립니다."
else
  echo; echo "문제가 있습니다. 위 항목을 확인하세요."; exit 1
fi
