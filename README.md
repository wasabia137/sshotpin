# 📌 스샷핀 (SshotPin)

**스샷을 콕! 화면에 붙이는 수업 도구**

캡처한 화면을 쪽지처럼 화면 맨 위에 고정해두고 수업할 수 있는 윈도우용 무료 프로그램입니다.

👉 **다운로드: https://sshot-pin.web.app**

## 주요 기능

| 단축키 | 기능 |
|---|---|
| `F1` | 영역 캡처 → `Enter`로 화면에 고정(핀) |
| `F2` | 정답 가리개 — 드래그로 덮고, 클릭하면 공개 |
| `F3` | 클립보드 이미지를 화면에 핀 |
| `Ctrl+1` | 화면 확대·축소 |
| `Ctrl+2` | 판서 (`Shift`=직선, `Ctrl`=사각형, `Ctrl+Shift`=화살표, `Alt`+클릭=①②③) |
| `Ctrl+3` | 수업 타이머 |

핀 위에서: 휠=확대/축소, `Ctrl`+휠=투명도, 더블클릭=접기, 우클릭=테두리 색·회전·클릭 통과

전체 사용법은 프로그램 트레이 아이콘 → **❓ 사용법·단축키**에서 볼 수 있습니다.

## 개발

```bash
npm install
npm start
```

### 윈도우 설치파일 빌드

⚠️ 한글 경로에서는 NSIS 컴파일이 실패하므로 ASCII 경로에서 빌드해야 합니다.

```bash
rsync -a --exclude dist --exclude node_modules --exclude web ./ ~/sshotpin-build/
cd ~/sshotpin-build && npm install
npx electron-builder --win nsis --x64 --publish never
```

## 기술 스택

- Electron (트레이 상주, 전역 단축키, 투명·항상위 창)
- electron-builder (NSIS 한국어 설치파일)
- Firebase Hosting (다운로드 페이지) + GitHub Releases (설치파일)

## 라이선스

MIT
