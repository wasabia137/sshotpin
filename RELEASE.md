# 릴리스 절차

## 순서

1. `package.json`의 `version` 올리기
2. 윈도우 빌드 — `npm run dist` (x64 고정. 인자 없이 `electron-builder --win nsis`를
   쓰면 빌드하는 기계의 아키텍처를 따라가서 일반 PC에서 못 쓰는 ARM64 exe가 나온다)
3. 맥 빌드 — `~/sshotpin-build`에서 `bash scripts/build-mac-signed.sh`
   (서명 → 공증 → 티켓 부착 → `latest-mac.yml` 해시 재계산까지 한 번에)
4. 깃허브 릴리스에 자산 업로드
5. **자산이 올라간 것을 확인한 뒤** `node scripts/sync-web-version.mjs`
6. `firebase deploy --only hosting`

5번을 4번보다 먼저 하면 그 사이 웹 다운로드 버튼이 404가 된다.

## 파일 이름은 한 곳에서만 정한다

배포 파일 이름은 `package.json`의 `build.artifactName` / `build.mac.artifactName`
두 곳에서만 정한다. 나머지는 전부 여기서 가져다 쓴다:

- `scripts/sync-web-version.mjs` → `web/version.json`의 다운로드 주소
- `scripts/build-mac-signed.sh` → 서명·공증할 DMG 이름
- 웹 9개 언어 페이지 → `version.json`의 주소를 그대로 씀 (이름을 조립하지 않는다)

HTML에 적힌 다운로드 링크는 `version.json`을 못 읽었을 때만 쓰는 예비값이다.

## 건드리면 안 되는 것

- **`build.appId` (`com.sshotpin.app`)** — 윈도우 NSIS가 이 값에서 만든 GUID로
  레지스트리에서 이전 설치를 찾아 지운다. Squirrel.Mac은 번들 식별자를 대조한다.
  바꾸면 기존 사용자의 자동 업데이트가 끊기고 프로그램이 두 벌 깔린다.

## 이름을 바꿀 때 (2026-08 SshotPin → Sshot-Pin)

`productName`을 바꾸면:

- **윈도우** — 설치 폴더가 `...\Programs\Sshot-Pin`으로 바뀐다. `appId`가 그대로면
  설치 관리자가 레지스트리에서 옛 설치를 찾아 지우고 새 위치에 깐다.
- **맥** — Squirrel.Mac은 내려받은 번들을 **지금 깔린 앱의 경로 이름 그대로** 덮어쓴다.
  그래서 기존 사용자의 앱은 파일 이름이 `SshotPin.app`으로 남고, 내용만 새것이 된다.
  새로 받는 사람만 `Sshot-Pin.app`이 된다. 동작에는 문제가 없다.

## 아직 한국어로 남아 있는 값

9개 언어를 지원하지만 아래는 모든 언어권 사용자에게 한국어로 보인다.
바꾸려면 위의 이름 변경과 같은 주의가 필요하다.

| 위치 | 값 | 어디에 보이나 |
|---|---|---|
| `build.win.executableName` | `스샷핀` | 윈도우 작업 관리자, exe 파일 이름 |
| `build.mac.extendInfo.CFBundleDisplayName` | `스샷핀` | 맥 메뉴 막대, Finder |
| `build.dmg.title` | `스샷핀` | 맥에서 DMG를 열었을 때 창 제목 |
