# 📌 스샷핀 (Sshot-Pin)

**스샷을 콕! 화면에 붙이는 수업 도구**

캡처한 화면을 쪽지처럼 화면 맨 위에 고정해두고 수업할 수 있는 무료 프로그램입니다. 윈도우와 맥을 지원하고, 9개 언어로 표시됩니다.

👉 **다운로드: https://sshot-pin.web.app**

## 주요 기능

| 윈도우 | 맥 | 기능 |
|---|---|---|
| `Ctrl+F1` | `Ctrl+Shift+1` | 영역 캡처 → `Enter`로 화면에 고정(핀) |
| `Ctrl+F2` | `Ctrl+Shift+2` | 클립보드 이미지를 화면에 핀 |
| `Ctrl+F3` | `Ctrl+Shift+3` | 정답 가리개 — 드래그로 덮고, 클릭하면 공개 |
| `Ctrl+1` | `Ctrl+1` | 화면 확대·축소 (`Ctrl`+휠로 40배까지) |
| `Ctrl+2` | `Ctrl+2` | 판서 (`Shift`=직선, `Ctrl`=사각형, `Ctrl+Shift`=화살표, `Alt`+클릭=①②③) |
| `Ctrl+3` | `Ctrl+3` | 수업 타이머 |

단축키는 설정에서 바꾸거나 비울 수 있습니다.

핀 위에서: 휠=확대/축소, `Ctrl`+휠=투명도, 더블클릭=접기, 우클릭=테두리 색·회전·클릭 통과

전체 사용법은 프로그램 트레이 아이콘 → **❓ 사용법·단축키**에서 볼 수 있습니다.

## 사용법 가이드

화면 캡처와 화면 확대, 판서를 어디에 어떻게 쓰는지 정리해 뒀습니다.

- [단축키가 안 먹을 때 확인할 것](https://sshot-pin.web.app/guide/hotkey-not-working/) — 눌러도 아무 일이 없다면 원인은 대개 셋 중 하나예요.
- [모니터 두 대에서 화면 캡처하기](https://sshot-pin.web.app/guide/dual-monitor/) — 어느 쪽이 찍히는지만 알면 나머지는 어렵지 않아요. 마우스가 있는 쪽이에요.
- [화상 수업에서 화면 공유하며 설명하기](https://sshot-pin.web.app/guide/online-class/) — 손으로 화면을 가리키는 방식은 카메라 너머로 잘 안 닿아요.
- [맥에서 캡처가 안 될 때 — 화면 기록 권한](https://sshot-pin.web.app/guide/mac-screen-permission/) — 맥은 화면을 읽는 프로그램을 사용자가 직접 허락하게 해뒀어요.
- [윈도우·맥 화면 캡처 단축키, 이것만 알면 돼요](https://sshot-pin.web.app/guide/capture-shortcuts/) — 전체 화면, 창 하나, 원하는 부분만. 어떤 키가 어디까지 되는지 한 번에 모았어요.
- [스크린샷을 화면 맨 위에 붙여두는 법](https://sshot-pin.web.app/guide/pin-screenshot-on-top/) — 찍은 화면을 포스트잇처럼 붙여두면, 창을 바꿔도 사라지지 않아요.
- [발표와 수업에서 화면 확대하기](https://sshot-pin.web.app/guide/zoom-screen/) — 뒷자리에서 안 보이는 작은 글씨를, 보고 있는 자리를 중심으로 크게 키워요.
- [화면 위에 바로 그리며 설명하기](https://sshot-pin.web.app/guide/draw-on-screen/) — 지금 보이는 화면이 무엇이든 그 위에 동그라미와 화살표를 얹을 수 있어요.
- [화면 공유 전에 개인정보 가리기](https://sshot-pin.web.app/guide/mosaic-private-info/) — 스크린샷에는 보여주려던 것 말고도 여러 가지가 함께 담겨요.
- [캡처한 이미지는 어디로 가고, 어떻게 바꾸나요](https://sshot-pin.web.app/guide/save-location/) — 윈도우와 맥은 찍은 화면을 서로 다른 곳에 넣어요.
- [윈도우 캡처 도구로 되는 것과 안 되는 것](https://sshot-pin.web.app/guide/windows-snipping-tool/) — 찍어서 붙여넣는 게 목적이라면 Win+Shift+S로 충분해요. 막히는 곳은 따로 있어요.
- [모둠 활동 시간을 화면에 띄워두기](https://sshot-pin.web.app/guide/class-timer/) — 남은 시간이 화면에 보이면 얼마나 남았냐고 묻는 일이 없어져요.

전체 목록: **https://sshot-pin.web.app/guide/**
## 개발

```bash
npm install
npm start
```

### 설치파일 빌드

⚠️ 한글 경로에서는 NSIS 컴파일이 실패하므로 ASCII 경로에서 빌드해야 합니다.

```bash
rsync -a --exclude dist --exclude node_modules --exclude web ./ ~/sshotpin-build/
cd ~/sshotpin-build && npm install
npm run dist                          # 윈도우 (x64 NSIS)
bash scripts/build-mac-signed.sh      # 맥 (서명·공증·DMG)
```

릴리스 전체 순서는 [RELEASE.md](RELEASE.md)를 따릅니다.

## 기술 스택

- Electron (트레이 상주, 전역 단축키, 투명·항상위 창)
- electron-builder (윈도우 NSIS 설치파일 · 맥 서명 DMG) + electron-updater (자동 업데이트)
- Firebase Hosting (다운로드 페이지) + GitHub Releases (설치파일)

## 라이선스

MIT
