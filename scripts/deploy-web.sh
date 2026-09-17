#!/bin/bash
# 홈페이지(파이어베이스 호스팅) 배포.
# 계정 로그인 토큰은 며칠마다 만료돼 매번 브라우저 로그인을 해야 했다.
# `firebase login:ci`로 만든 토큰을 키체인에 넣어 두면 그걸로 배포한다.
#
# 준비(한 번만, 터미널에서):
#   firebase login:ci                      # 브라우저에서 gty@cc.re.kr 로 로그인 → 토큰이 찍힌다
#   security add-generic-password -a sshotpin -s sshotpin-firebase-token -w '<토큰>' -U
#
# 토큰이 없으면 예전처럼 로그인 계정으로 배포한다.
set -e
cd "$(dirname "$0")/.."
TOKEN=$(security find-generic-password -a sshotpin -s sshotpin-firebase-token -w 2>/dev/null || true)
if [ -n "$TOKEN" ]; then
  echo "· 키체인의 배포 토큰으로 배포"
  FIREBASE_TOKEN="$TOKEN" firebase deploy --only hosting --non-interactive
else
  echo "· 배포 토큰이 없어 로그인 계정으로 배포 (만료됐으면: firebase login --reauth)"
  firebase deploy --only hosting
fi
