// 스샷핀 — 스샷을 콕! 화면에 붙여두는 캡처 도구
// Ctrl+F1: 영역 캡처 / Ctrl+F2: 클립보드 핀 / Ctrl+1: 확대·축소 / Ctrl+2: 판서 / Ctrl+3: 타이머
// (맥은 Ctrl+Shift+1/2/3 — DEFAULT_HOTKEYS 참조)

const {
  app, BrowserWindow, globalShortcut, Tray, Menu,
  clipboard, nativeImage, screen, desktopCapturer,
  ipcMain, dialog, Notification, shell, systemPreferences,
} = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';

// macOS 26에서 화면 캡처 목록을 관리하는 스레드가 스스로 죽는 일이 있었다
// (DesktopMediaListCaptureThread 크래시, 캡처가 끝난 뒤에도 발생).
// 가장 최신이라 검증이 덜 된 ScreenCaptureKit 선택기 경로를 끄고
// 안정적인 경로만 쓰게 한다. 캡처 품질·동작에는 영향이 없음을 확인했다.
if (isMac) {
  app.commandLine.appendSwitch('disable-features',
    'ScreenCaptureKitPickerScreen,ScreenCaptureKitStreamPickerSonoma');
}

let tray = null;
let captureWin = null;        // 캡처 오버레이 (한 번에 하나)
let captureDisplay = null;
let overlayWin = null;        // 확대/판서 오버레이 (한 번에 하나)
let overlayDisplay = null;
let timerWin = null;
let helpWin = null;
let quickbarWin = null;
let pinSeq = 0;
const pins = new Map();
let pinsHidden = false;
let coverSeq = 0;
const covers = new Map();     // 가리개 창
const dragOrigins = new Map(); // webContents.id -> [x, y]

// ---------- 로그 (문의 대응·문제 진단용) ----------

const logDir = path.join(app.getPath('userData'), 'logs');
const logPath = path.join(logDir, 'app.log');

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  try {
    fs.mkdirSync(logDir, { recursive: true });
    // 로그가 2MB를 넘으면 한 번 갈아치워 무한 증가를 막는다
    try {
      if (fs.statSync(logPath).size > 2 * 1024 * 1024) {
        fs.renameSync(logPath, logPath + '.old');
      }
    } catch (e) { /* 파일이 아직 없음 */ }
    fs.appendFileSync(logPath, line + '\n');
  } catch (e) { /* 로그 실패가 앱을 막지 않도록 */ }
}

// 예기치 못한 오류로 조용히 죽지 않게 — 기록하고 사용자에게 알린다
process.on('uncaughtException', (err) => {
  log('UNCAUGHT', err && err.stack ? err.stack : String(err));
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: '스샷핀 오류',
        body: '문제가 생겼지만 계속 실행됩니다. 반복되면 설정에서 로그를 확인해주세요.',
        silent: true,
      }).show();
    }
  } catch (e) { /* 알림 실패는 무시 */ }
});
process.on('unhandledRejection', (reason) => log('UNHANDLED', String(reason)));

// ---------- 설정 ----------

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
// 맥에서는 Cmd+1~3이 브라우저 탭 전환과 충돌하므로 Control 사용
const MOD = isMac ? 'Control' : 'Ctrl';

// F1/F2/F3 단독은 다른 프로그램의 도움말·이름바꾸기·다음찾기를 빼앗으므로 쓰지 않는다.
// 맥은 Ctrl+F1이 시스템 단축키(전체 키보드 접근)라 등록돼도 앱까지 오지 않고,
// F키 설정에 따라 밝기 조절로 전달되기도 해서 Ctrl+Shift+숫자를 쓴다.
const DEFAULT_HOTKEYS = isMac ? {
  capture: 'Control+Shift+1',
  pin: 'Control+Shift+2',
  cover: 'Control+Shift+3',
  zoom: 'Control+1',
  draw: 'Control+2',
  timer: 'Control+3',
} : {
  capture: 'Ctrl+F1',
  pin: 'Ctrl+F2',
  cover: 'Ctrl+F3',
  zoom: 'Ctrl+1',     // ZoomIt과 동일
  draw: 'Ctrl+2',
  timer: 'Ctrl+3',
};

// v0.5.0 이하의 기본값 — 사용자가 손대지 않았다면 새 기본값으로 올려준다
const LEGACY_DEFAULT_HOTKEYS = {
  capture: 'F1',
  cover: 'F2',
  pin: 'F3',
  zoom: `${MOD}+1`,
  draw: `${MOD}+2`,
  timer: `${MOD}+3`,
};

// 표시 순서 = 실제 사용 빈도 순 (가리개는 보조 기능이라 뒤로)
const HOTKEY_LABELS = {
  capture: '영역 캡처',
  pin: '클립보드 이미지 핀',
  zoom: '화면 확대·축소',
  draw: '판서',
  timer: '타이머',
  cover: '가리개',
};

const defaultSettings = {
  firstRunDone: false,
  pinBorderVisible: true,
  pinBorderColor: '#3b82f6',
  quickbarVisible: true,
  quickbarBounds: null,
  hotkeys: { ...DEFAULT_HOTKEYS },
  saveDir: '',        // 빈 값이면 사진 폴더
  quickSave: false,   // true면 대화상자 없이 바로 저장
};
let settings = { ...defaultSettings };
let hotkeysMigrated = false;   // 예전 F1/F2/F3 기본값에서 자동 변경됐는지
try {
  const loaded = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings = { ...defaultSettings, ...loaded };
  // 단축키는 항목별로 병합해 새 기능이 추가돼도 누락되지 않게
  settings.hotkeys = { ...DEFAULT_HOTKEYS, ...(loaded.hotkeys || {}) };

  // 예전 기본값(F1/F2/F3)을 그대로 쓰던 사용자는 새 기본값으로 올려준다.
  // 직접 바꿔 쓰던 사용자의 설정은 건드리지 않는다.
  const untouched = Object.entries(LEGACY_DEFAULT_HOTKEYS)
    .every(([k, v]) => settings.hotkeys[k] === v);
  if (untouched) {
    settings.hotkeys = { ...DEFAULT_HOTKEYS };
    hotkeysMigrated = true;
  }
} catch (e) { /* 첫 실행 */ }
function saveSettings() {
  try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); } catch (e) {}
}

// ---------- 공통 유틸 ----------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function notify(body) {
  if (Notification.isSupported()) {
    new Notification({ title: '스샷핀', body, silent: true }).show();
  }
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function currentSaveDir() {
  if (settings.saveDir) {
    try {
      if (fs.existsSync(settings.saveDir)) return settings.saveDir;
    } catch (e) { /* 폴더가 사라졌으면 기본값으로 */ }
  }
  return app.getPath('pictures');
}

async function saveImageDialog(dataURL, parentWin) {
  const img = nativeImage.createFromDataURL(dataURL);
  const fileName = `스샷핀_${timestamp()}.png`;

  // 빠른 저장: 대화상자 없이 지정 폴더에 바로 저장
  if (settings.quickSave) {
    try {
      const target = path.join(currentSaveDir(), fileName);
      fs.writeFileSync(target, img.toPNG());
      notify(`저장했습니다: ${fileName}`);
      return;
    } catch (e) {
      notify('빠른 저장에 실패했습니다. 저장 위치를 다시 선택해주세요.');
      // 실패하면 아래 대화상자로 진행
    }
  }

  const { canceled, filePath } = await dialog.showSaveDialog(parentWin || null, {
    title: '스샷 저장',
    defaultPath: path.join(currentSaveDir(), fileName),
    filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
  });
  if (canceled || !filePath) return;
  fs.writeFileSync(filePath, img.toPNG());
  notify(`저장했습니다: ${path.basename(filePath)}`);
}

// 프로그램에 의한 크기 변경 (resizable:false 창도 확실히 동작하도록 감쌈)
function setBoundsForce(win, bounds) {
  const wasResizable = win.isResizable();
  if (!wasResizable) win.setResizable(true);
  win.setBounds(bounds);
  if (!wasResizable) win.setResizable(false);
}

function cursorDisplay() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

// 디스플레이 전체 스크린샷 → { width, height, bitmap }
// PNG dataURL로 넘기면 인코딩에만 450ms가 들어 단축키를 눌러도 한참 멈춘다.
// 원시 비트맵은 3ms면 되고 무손실이라 화질도 그대로다(측정 후 교체).
// 화면 기록 권한이 없거나 시스템이 응답하지 않으면 무한정 기다리지 않고 끊는다.
async function grabDisplay(display) {
  const { width, height } = display.bounds;
  const scale = display.scaleFactor;
  const job = desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  });
  const t0 = Date.now();
  const sources = await Promise.race([
    job,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('화면을 읽는 데 너무 오래 걸립니다')), 8000)),
  ]);
  const tSources = Date.now() - t0;
  const source =
    sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;
  const size = source.thumbnail.getSize();
  const t1 = Date.now();
  const bitmap = source.thumbnail.toBitmap();
  const tBitmap = Date.now() - t1;
  // 어느 단계가 느린지 남겨두면 원인을 바로 짚을 수 있다
  if (tSources + tBitmap > 300) {
    log(`grabDisplay 느림: getSources ${tSources}ms + toBitmap ${tBitmap}ms`);
  }
  return { width: size.width, height: size.height, bitmap };
}

// 오버레이 창을 띄우고 실제로 보이는 것까지 확인한다.
// did-finish-load를 놓치는 경우가 있어 로드 완료·타임아웃 양쪽으로 보호한다.
// 로드가 끝나면 곧바로 그림을 보내고, 렌더러가 "다 그렸다"고 알려온 뒤에 창을 띄운다.
// 먼저 띄우면 빈 화면이 한 번 번쩍인다.
function showOverlayWhenReady(win, channel, payload) {
  let shown = false;
  const reveal = () => {
    if (shown || !win || win.isDestroyed()) return;
    shown = true;
    win.show();
    win.focus();
  };
  overlayRevealers.set(win.webContents.id, reveal);
  const send = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
    // 신호가 오지 않아도 창이 갇히지 않도록 하는 안전장치
    setTimeout(reveal, 250);
  };
  // 이미 로드된 창(재사용)이면 바로 보내고, 첫 로드 중이면 끝난 뒤에 보낸다
  if (overlayLoaded.has(win.webContents.id)) send();
  else win.webContents.once('did-finish-load', send);
}

// 렌더러가 첫 그림을 마쳤다고 알려오면 그때 창을 보여준다
const overlayRevealers = new Map();
ipcMain.on('overlay-painted', (e) => {
  const reveal = overlayRevealers.get(e.sender.id);
  if (reveal) { reveal(); overlayRevealers.delete(e.sender.id); }
});

// 전체 화면 오버레이 창 공통 옵션.
// 윈도우에서 fullscreen:true는 resizable:false와 만나면 제대로 전체 화면이
// 되지 않는 문제가 있어(오버레이가 화면을 못 덮음), 어느 플랫폼에서든
// 디스플레이 크기 그대로 덮는 프레임 없는 창 + 최상위 고정을 쓴다.
function fullscreenOverlayWindow(display) {
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    resizable: false,
    movable: false,
    enableLargerThanScreen: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 확대 애니메이션이 창 상태와 무관하게 항상 돌도록
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setBounds({ x, y, width, height });
  // 렌더러가 죽으면 빈 창만 남아 "클릭이 안 된다"로 보인다 — 즉시 닫고 기록
  win.webContents.on('render-process-gone', (e, details) => {
    log(`overlay 렌더러 사망: ${JSON.stringify(details)}`);
    if (!win.isDestroyed()) win.close();
    notify('화면 창에 문제가 생겨 닫았습니다. 다시 시도해주세요.');
  });
  win.on('unresponsive', () => log('overlay 응답 없음'));
  win.on('closed', () => log('overlay 닫힘'));
  return win;
}

// ---------- 오버레이 창 미리 준비 ----------
// 단축키를 누른 뒤 창을 만들면 생성·로드에만 150~250ms가 든다.
// 미리 하나 만들어 숨겨두고, 쓰고 나면 다음 것을 새로 준비한다.
// (매번 새 창을 쓰므로 이전 상태가 남을 걱정이 없다)
const warm = { capture: null, overlay: null };
const WARM_PAGE = { capture: 'capture.html', overlay: 'screen.html' };

const overlayLoaded = new Set();   // 로드가 끝난 오버레이 창 (재사용 판단용)

function prewarmOverlay(kind) {
  if (warm[kind] && !warm[kind].isDestroyed()) return;
  try {
    const win = fullscreenOverlayWindow(screen.getPrimaryDisplay());
    win.webContents.once('did-finish-load', () => overlayLoaded.add(win.webContents.id));
    win.loadFile(path.join(__dirname, 'src', WARM_PAGE[kind]));
    warm[kind] = win;
  } catch (e) {
    log(`오버레이 미리 준비 실패(${kind})`, e.message);
    warm[kind] = null;
  }
}

// 준비된 창을 대상 디스플레이에 맞춰 내어준다.
// 창을 닫지 않고 숨겨 계속 재사용하므로 생성 비용이 아예 들지 않는다.
// (쓸 때마다 새로 만들면 그 300ms가 다음 캡처를 밀어낸다)
function takeOverlay(kind, display) {
  if (!warm[kind] || warm[kind].isDestroyed()) prewarmOverlay(kind);
  const win = warm[kind];
  if (!win) return null;
  const b = display.bounds;
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  return win;
}

// 오버레이는 닫지 않고 숨긴다. 다음에 열 때 렌더러가 상태를 새로 초기화한다.
function hideOverlay(win) {
  if (win && !win.isDestroyed()) win.hide();
}

// 화면에서 내리고 변수를 비운다
function closeCaptureOverlay() { hideOverlay(captureWin); captureWin = null; reshowQuickbar(); }
function closeOverlayWin() { hideOverlay(overlayWin); overlayWin = null; reshowQuickbar(); }

// ---------- 캡처 히스토리 ----------

const HISTORY_MAX = 24;
const historyDir = path.join(app.getPath('userData'), 'history');
const historyIndexPath = path.join(historyDir, 'index.json');
let history = [];   // [{ id, file, w, h, at }]
let historyWin = null;

try {
  history = JSON.parse(fs.readFileSync(historyIndexPath, 'utf8'));
  if (!Array.isArray(history)) history = [];
  // 파일이 사라진 항목은 정리
  history = history.filter((h) => {
    try { return fs.existsSync(path.join(historyDir, h.file)); } catch (e) { return false; }
  });
} catch (e) { history = []; }

function saveHistoryIndex() {
  try {
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(historyIndexPath, JSON.stringify(history));
  } catch (e) { log('history index 저장 실패', e.message); }
}

function addHistory(dataURL, w, h) {
  const before = history.length;
  try {
    fs.mkdirSync(historyDir, { recursive: true });
    const id = `${Date.now()}_${Math.floor(w)}x${Math.floor(h)}`;
    const file = `${id}.png`;
    fs.writeFileSync(path.join(historyDir, file),
      nativeImage.createFromDataURL(dataURL).toPNG());
    history.unshift({ id, file, w: Math.round(w), h: Math.round(h), at: Date.now() });
    // 오래된 것은 파일까지 삭제
    while (history.length > HISTORY_MAX) {
      const old = history.pop();
      try { fs.unlinkSync(path.join(historyDir, old.file)); } catch (e) { /* 이미 없음 */ }
    }
    saveHistoryIndex();
    if (historyWin) sendHistory();
    if (before === 0) rebuildTrayMenu(); // 메뉴의 "최근 캡처" 활성화
  } catch (e) {
    log('history 저장 실패', e.message);
  }
}

function historyDataURL(item) {
  const buf = fs.readFileSync(path.join(historyDir, item.file));
  return 'data:image/png;base64,' + buf.toString('base64');
}

function sendHistory() {
  if (!historyWin) return;
  const items = history.map((h) => {
    let thumb = '';
    try {
      // 목록은 축소 이미지로 보내 메모리를 아낀다
      const img = nativeImage.createFromPath(path.join(historyDir, h.file));
      thumb = img.resize({ width: Math.min(320, img.getSize().width) }).toDataURL();
    } catch (e) { /* 손상된 파일은 빈 썸네일 */ }
    return { ...h, thumb };
  });
  historyWin.webContents.send('history-state', { items });
}

function openHistory() {
  if (historyWin) { historyWin.focus(); return; }
  historyWin = new BrowserWindow({
    width: 760, height: 620,
    title: '최근 캡처',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  historyWin.loadFile(path.join(__dirname, 'src', 'history.html'));
  historyWin.webContents.once('did-finish-load', () => sendHistory());
  historyWin.on('closed', () => { historyWin = null; });
}

ipcMain.on('history-pin', (e, id) => {
  const item = history.find((h) => h.id === id);
  if (!item) return;
  try {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    // 저장된 이미지는 물리 픽셀이므로 화면 배율로 환산
    const w = Math.round(item.w / display.scaleFactor);
    const h = Math.round(item.h / display.scaleFactor);
    createPin(historyDataURL(item), w, h,
      display.bounds.x + (display.bounds.width - w) / 2,
      display.bounds.y + (display.bounds.height - h) / 2);
  } catch (err) {
    log('history 핀 실패', err.message);
    notify('이 캡처를 불러오지 못했습니다.');
  }
});

ipcMain.on('history-copy', (e, id) => {
  const item = history.find((h) => h.id === id);
  if (!item) return;
  try {
    clipboard.writeImage(nativeImage.createFromDataURL(historyDataURL(item)));
    notify('클립보드에 복사했습니다.');
  } catch (err) { notify('복사에 실패했습니다.'); }
});

ipcMain.on('history-save', (e, id) => {
  const item = history.find((h) => h.id === id);
  if (item) saveImageDialog(historyDataURL(item), historyWin);
});

ipcMain.on('history-delete', (e, id) => {
  const i = history.findIndex((h) => h.id === id);
  if (i < 0) return;
  try { fs.unlinkSync(path.join(historyDir, history[i].file)); } catch (err) { /* 이미 없음 */ }
  history.splice(i, 1);
  saveHistoryIndex();
  sendHistory();
});

ipcMain.on('history-clear', async () => {
  const { response } = await dialog.showMessageBox(historyWin || null, {
    type: 'question',
    title: '최근 캡처 전체 삭제',
    message: '저장된 최근 캡처를 모두 삭제할까요?',
    detail: '이미 저장하거나 붙여둔 이미지는 영향을 받지 않습니다.',
    buttons: ['모두 삭제', '취소'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return;
  for (const h of history) {
    try { fs.unlinkSync(path.join(historyDir, h.file)); } catch (e) { /* 이미 없음 */ }
  }
  history = [];
  saveHistoryIndex();
  sendHistory();
});

// ---------- 퀵 실행바 ----------

function createQuickbar() {
  if (quickbarWin) { quickbarWin.showInactive(); return; }
  const display = screen.getPrimaryDisplay();
  const W = 472, H = 46;
  let { x, y } = {
    x: display.workArea.x + Math.round((display.workArea.width - W) / 2),
    y: display.workArea.y + 8,
  };
  const saved = settings.quickbarBounds;
  if (saved && screen.getAllDisplays().some((d) =>
    saved.x >= d.bounds.x - W && saved.x < d.bounds.x + d.bounds.width &&
    saved.y >= d.bounds.y - H && saved.y < d.bounds.y + d.bounds.height)) {
    x = saved.x; y = saved.y;
  }
  quickbarWin = new BrowserWindow({
    x, y, width: W, height: H,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // 수업 중 포커스를 뺏지 않음
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  quickbarWin.setAlwaysOnTop(true, 'screen-saver');
  // 퀵바가 스크린샷에 찍히지 않게 한다 (숨기고 기다리는 지연을 없애기 위함)
  try {
    quickbarWin.setContentProtection(true);
    quickbarProtected = true;
  } catch (e) {
    quickbarProtected = false;
    log('퀵바 화면기록 제외 실패 — 예전 방식으로 숨김', e.message);
  }
  quickbarWin.loadFile(path.join(__dirname, 'src', 'quickbar.html'));
  quickbarWin.webContents.once('did-finish-load', () => {
    if (quickbarWin) quickbarWin.webContents.send('quickbar-state', { hotkeys: settings.hotkeys });
  });
  quickbarWin.once('ready-to-show', () => quickbarWin.showInactive());
  quickbarWin.on('moved', () => {
    if (!quickbarWin) return;
    const b = quickbarWin.getBounds();
    settings.quickbarBounds = { x: b.x, y: b.y };
    saveSettings();
  });
  quickbarWin.on('closed', () => { quickbarWin = null; });
}

function setQuickbarVisible(visible) {
  settings.quickbarVisible = visible;
  saveSettings();
  if (visible) createQuickbar();
  else if (quickbarWin) quickbarWin.close();
  rebuildTrayMenu();
}

// 퀵바는 화면 기록 대상에서 빼두었으므로(setContentProtection) 숨길 필요가 없다.
// 예전에는 숨기고 150ms를 기다렸는데, 그만큼 캡처가 늦고 화면이 깜박였다.
// 보호가 통하지 않는 환경에서는 예전처럼 숨겼다 되돌린다.
let quickbarProtected = false;
async function hideQuickbarForGrab() {
  if (quickbarProtected) return;
  if (quickbarWin && quickbarWin.isVisible()) {
    quickbarWin.hide();
    await new Promise((r) => setTimeout(r, 120));
  }
}

function reshowQuickbar() {
  if (quickbarProtected) return;
  if (quickbarWin && settings.quickbarVisible) quickbarWin.showInactive();
}

ipcMain.on('quickbar-action', (e, action) => {
  if (action === 'capture') startCapture('capture');
  else if (action === 'cover') startCapture('cover');
  else if (action === 'pin') pinFromClipboard();
  else if (action === 'zoom') toggleOverlay('zoom');
  else if (action === 'draw') toggleOverlay('draw');
  else if (action === 'timer') toggleTimer();
  else if (action === 'history') openHistory();
  else if (action === 'help') openHelp();
  else if (action === 'settings') openSettings();
  else if (action === 'hide') {
    setQuickbarVisible(false);
    notify('퀵 실행바를 숨겼습니다. 트레이 메뉴에서 다시 켤 수 있습니다.');
  }
});

// ---------- 영역 캡처 (F1) ----------

let captureBusy = false;   // 화면을 읽는 동안 재진입 방지 (연타 → 이중 오버레이)

async function startCapture(mode = 'capture') { // 'capture' | 'cover'
  // 이미 열려 있으면 닫는다(토글). 오버레이가 포커스를 잃어 Esc가 안 먹을 때
  // 단축키를 다시 눌러 빠져나올 수 있어야 한다.
  if (captureWin) { closeCaptureOverlay(); return; }
  // 창 변수가 채워지기 전(화면 읽는 사이)에 다시 눌리면 오버레이가 두 겹 생기고,
  // Esc가 최신 창만 닫아 그림이 남은 유령 창이 생긴다 — 여기서 차단
  if (captureBusy) return;
  captureBusy = true;
  const tStart = Date.now();
  try {
    if (overlayWin) {
      // 확대·판서 창이 화면에서 실제로 사라진 뒤에 찍어야 오버레이가 함께 찍히지 않는다
      closeOverlayWin();
      await new Promise((r) => setTimeout(r, 150));
    }

    const display = cursorDisplay();
    await hideQuickbarForGrab();
    let shot;
    try {
      // 이 호출 자체가 맥의 화면 기록 권한 요청이다 (미리 막으면 요청창이 안 뜬다)
      shot = await grabDisplay(display);
    } catch (err) {
      log('캡처 실패', err.message);
      if (!screenAccessGranted()) guideScreenAccess();
      else notify(`화면을 읽지 못했습니다. ${err.message}`);
      reshowQuickbar();
      return;
    }
    if (!shot) {
      log('캡처 실패 — 빈 화면');
      if (!screenAccessGranted()) guideScreenAccess();
      else notify('화면을 캡처하지 못했습니다. 잠시 후 다시 시도해주세요.');
      reshowQuickbar();
      return;
    }

    captureDisplay = { ...display.bounds };
    log(`capture: 화면 읽음 (${display.bounds.width}x${display.bounds.height} scale=${display.scaleFactor})`);
    captureWin = takeOverlay('capture', display);
    if (!captureWin) { notify('캡처 창을 열지 못했습니다.'); reshowQuickbar(); return; }
    showOverlayWhenReady(captureWin, 'capture-init', { shot, mode });
    // 유난히 느릴 때만 기록해 둔다 (평소엔 로그를 더럽히지 않게)
    captureWin.once('show', () => {
      const ms = Date.now() - tStart;
      if (ms > 400) log(`capture: 화면에 뜨기까지 ${ms}ms (느림)`);
    });
  } finally {
    captureBusy = false;
  }
}

// 맥은 화면 기록 권한이 없으면 캡처가 조용히 실패한다 — 미리 걸러서 안내한다.
// 단, 아직 한 번도 물어보지 않은 상태(not-determined)는 통과시킨다.
// 여기서 막으면 OS의 권한 요청 팝업이 뜰 기회가 없어
// 사용자가 시스템 설정에서 손으로 앱을 추가해야 하기 때문이다.
// 화면 기록 권한은 프로그램이 켤 수 없다(맥 보안 정책). 사용자가 직접 켜야 한다.
// 중요: 미리 막으면 안 된다. getMediaAccessStatus('screen')은 허용 전까지 늘
// 'denied'를 돌려주는데, 여기서 차단하면 시스템이 권한 창을 띄우고 목록에
// 앱을 추가할 기회가 사라진다(설정 목록에 아예 나타나지 않는 원인).
// 그래서 캡처를 그냥 시도하고 — 그 시도가 곧 권한 요청이다 — 실패했을 때만 안내한다.
function screenAccessGranted() {
  return !isMac || systemPreferences.getMediaAccessStatus('screen') === 'granted';
}

let screenGuideShownAt = 0;
function guideScreenAccess() {
  if (!isMac) return;
  log('화면 기록 권한 없음 — 설정 안내');
  // 캡처를 연달아 눌러도 설정 창이 여러 번 열리지 않게
  const now = Date.now();
  if (now - screenGuideShownAt < 5000) return;
  screenGuideShownAt = now;
  notify('화면 기록 권한을 허용해주세요. 목록에서 스샷핀을 켜면 바로 됩니다.');
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
}

// 응용 프로그램 폴더 밖(다운로드 폴더·DMG)에서 실행하면 맥이 앱을 매번 다른
// 임시 경로로 옮겨(App Translocation) 화면 기록 권한이 계속 초기화된다.
// 첫 실행에 옮겨두면 한 번 허용한 권한이 그대로 유지된다.
async function ensureInApplicationsFolder() {
  if (!isMac || !app.isPackaged) return;
  try {
    if (app.isInApplicationsFolder()) return;
  } catch (e) { return; }

  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: '스샷핀',
    message: '스샷핀을 응용 프로그램 폴더로 옮길까요?',
    detail: '지금 위치에서 실행하면 맥이 앱을 임시 폴더로 옮겨 화면 기록 권한이 매번 초기화됩니다.\n옮겨두면 권한을 한 번만 허용하면 계속 유지됩니다.',
    buttons: ['옮기기 (추천)', '나중에'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    // 성공하면 옮긴 자리에서 다시 실행되고 지금 인스턴스는 종료된다
    app.moveToApplicationsFolder();
  } catch (e) {
    log('응용 프로그램 폴더 이동 실패', e.message);
    notify('옮기지 못했습니다. 스샷핀을 응용 프로그램 폴더로 직접 끌어다 놓아주세요.');
  }
}

// 영역을 확정하면 곧바로 클립보드에 넣는다 (알림은 오버레이 안에서 표시)
ipcMain.on('capture-autocopy', (e, dataURL) => {
  try {
    clipboard.writeImage(nativeImage.createFromDataURL(dataURL));
  } catch (err) { log('자동 복사 실패', err.message); }
});

ipcMain.on('capture-finish', (e, payload) => {
  log(`capture-finish: ${payload ? payload.action : 'null'}`);
  const disp = captureDisplay;
  // 보낸 창 자신을 닫는다 — captureWin 변수가 다른 창을 가리키게 된 경우에도
  // Esc(취소)가 항상 자기 창을 닫을 수 있도록
  const sender = BrowserWindow.fromWebContents(e.sender);
  hideOverlay(sender);
  if (captureWin && captureWin !== sender) hideOverlay(captureWin);
  captureWin = null;
  reshowQuickbar();
  if (!payload || payload.action === 'cancel') return;

  const { action, dataURL, rect } = payload;
  if (action === 'copy') {
    clipboard.writeImage(nativeImage.createFromDataURL(dataURL));
    notify('클립보드에 복사했습니다.');
  } else if (action === 'save') {
    saveImageDialog(dataURL);
  } else if (action === 'pin') {
    createPin(dataURL, rect.w, rect.h, disp.x + rect.x, disp.y + rect.y);
  } else if (action === 'cover') {
    createCover(disp.x + rect.x, disp.y + rect.y, rect.w, rect.h);
  }
  // 이미지가 만들어진 동작은 히스토리에 남긴다 (가리개는 이미지가 없음)
  if (dataURL && action !== 'cover') {
    const img = nativeImage.createFromDataURL(dataURL).getSize();
    addHistory(dataURL, img.width, img.height);
  }
});

// ---------- 가리개 (F2) ----------

const COVER_COLORS = [
  ['남색', '#1e293b'], ['칠판 초록', '#14532d'],
  ['회색', '#475569'], ['포스트잇 노랑', '#fde047'],
];

function createCover(x, y, w, h) {
  const id = ++coverSeq;
  const win = new BrowserWindow({
    x: Math.round(x), y: Math.round(y),
    width: Math.max(40, Math.round(w)),
    height: Math.max(30, Math.round(h)),
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'src', 'cover.html'));
  covers.set(id, { win });
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('cover-init', { id });
    win.show();
  });
  win.webContents.on('context-menu', () => popupCoverMenu(id));
  win.on('closed', () => { covers.delete(id); rebuildTrayMenu(); });
  rebuildTrayMenu();
  return id;
}

function popupCoverMenu(id) {
  const c = covers.get(id);
  if (!c) return;
  const menu = Menu.buildFromTemplate([
    { label: '공개 / 다시 가리기 (클릭)', click: () => c.win.webContents.send('cover-toggle') },
    {
      label: '가리개 색',
      submenu: COVER_COLORS.map(([name, color]) => ({
        label: name,
        click: () => c.win.webContents.send('cover-style', { color }),
      })),
    },
    { type: 'separator' },
    { label: '닫기', accelerator: 'Esc', click: () => c.win.close() },
    { label: '모든 가리개 닫기', click: closeAllCovers },
  ]);
  menu.popup({ window: c.win });
}

function closeAllCovers() {
  for (const c of [...covers.values()]) c.win.close();
}

ipcMain.on('cover-close', (e, id) => covers.get(id)?.win.close());

// ---------- 확대·판서 오버레이 (Ctrl+1 / Ctrl+2) ----------

let overlayBusy = false;   // 화면을 읽는 동안 재진입 방지 (연타 → 이중 오버레이)

async function toggleOverlay(mode) { // 'zoom' | 'draw'
  if (overlayWin) { closeOverlayWin(); return; }
  if (captureWin || overlayBusy) return;
  overlayBusy = true;
  const tStart2 = Date.now();
  try {
    const display = cursorDisplay();
    await hideQuickbarForGrab();
    let dataURL;
    try {
      shot = await grabDisplay(display);
    } catch (err) {
      log('확대·판서 실패', err.message);
      if (!screenAccessGranted()) guideScreenAccess();
      else notify(`화면을 읽지 못했습니다. ${err.message}`);
      reshowQuickbar();
      return;
    }
    if (!shot) {
      if (!screenAccessGranted()) guideScreenAccess();
      else notify('화면을 캡처하지 못했습니다. 잠시 후 다시 시도해주세요.');
      reshowQuickbar();
      return;
    }

    overlayDisplay = { ...display.bounds };
    overlayWin = takeOverlay('overlay', display);
    if (!overlayWin) { notify('화면 창을 열지 못했습니다.'); reshowQuickbar(); return; }
    // 확대는 마우스 위치를 중심으로 시작해야 한다 (ZoomIt과 동일)
    const cur = screen.getCursorScreenPoint();
    showOverlayWhenReady(overlayWin, 'overlay-init', {
      shot, mode,
      cursor: { x: cur.x - display.bounds.x, y: cur.y - display.bounds.y },
    });
    overlayWin.once('show', () => {
      const ms = Date.now() - tStart2;
      if (ms > 400) log(`overlay(${mode}): 화면에 뜨기까지 ${ms}ms (느림)`);
    });
  } finally {
    overlayBusy = false;
  }
}

ipcMain.on('overlay-finish', (e, payload) => {
  const disp = overlayDisplay;
  // 보낸 창 자신을 닫는다 — 변수가 다른 창을 가리켜도 Esc가 항상 통하게
  const sender = BrowserWindow.fromWebContents(e.sender);
  const closeSender = () => {
    hideOverlay(sender);
    if (overlayWin && overlayWin !== sender) hideOverlay(overlayWin);
    overlayWin = null;
    reshowQuickbar();
  };
  if (!payload || payload.action === 'close') {
    closeSender();
    return;
  }
  const { action, dataURL, w, h } = payload;
  if (action === 'copy') {
    clipboard.writeImage(nativeImage.createFromDataURL(dataURL));
    notify('클립보드에 복사했습니다.');
  } else if (action === 'save') {
    closeSender();
    saveImageDialog(dataURL);
  } else if (action === 'pin') {
    closeSender();
    // 화면의 절반 크기로 핀 (가운데 배치)
    const pw = Math.round(disp.width / 2), ph = Math.round(h * (pw / w));
    createPin(dataURL, pw, ph,
      disp.x + (disp.width - pw) / 2, disp.y + (disp.height - ph) / 2);
  }
});

// ---------- 타이머 (Ctrl+3) ----------

function toggleTimer() {
  if (timerWin) { timerWin.close(); return; }
  const display = cursorDisplay();
  timerWin = new BrowserWindow({
    x: display.bounds.x + display.bounds.width - 300,
    y: display.bounds.y + 60,
    width: 264, height: 156,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  timerWin.setAlwaysOnTop(true, 'screen-saver');
  timerWin.loadFile(path.join(__dirname, 'src', 'timer.html'));
  timerWin.once('ready-to-show', () => timerWin.show());
  timerWin.on('closed', () => { timerWin = null; });
}

// 렌더러 오류 로그
ipcMain.on('renderer-log', (e, msg) => log('[renderer]', msg));

// ---------- 단축키 ----------

const HOTKEY_ACTIONS = {
  capture: () => startCapture('capture'),
  cover: () => startCapture('cover'),
  pin: () => pinFromClipboard(),
  zoom: () => toggleOverlay('zoom'),
  draw: () => toggleOverlay('draw'),
  timer: () => toggleTimer(),
};

let hotkeyFailures = [];

// Electron 액셀러레이터는 ASCII만 허용 — 한글 입력 상태에서 자모가 섞이면 등록 자체가 실패한다
function isValidAccelerator(accel) {
  return typeof accel === 'string' && accel.length > 0 && /^[\x20-\x7E]+$/.test(accel);
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyFailures = [];
  for (const [key, accel] of Object.entries(settings.hotkeys)) {
    if (!accel || !HOTKEY_ACTIONS[key]) continue; // 빈 값이면 사용 안 함
    if (!isValidAccelerator(accel)) {
      // 과거 버전에서 잘못 저장된 값은 기본값으로 자동 복구
      settings.hotkeys[key] = DEFAULT_HOTKEYS[key] || '';
      saveSettings();
      const fixed = settings.hotkeys[key];
      if (!fixed) continue;
      if (globalShortcut.register(fixed, HOTKEY_ACTIONS[key])) continue;
      hotkeyFailures.push(`${HOTKEY_LABELS[key]} (${fixed})`);
      continue;
    }
    let ok = false;
    try {
      ok = globalShortcut.register(accel, HOTKEY_ACTIONS[key]);
    } catch (e) {
      ok = false; // 잘못된 형식
    }
    if (!ok) hotkeyFailures.push(`${HOTKEY_LABELS[key]} (${accel})`);
  }
  return hotkeyFailures;
}

// ---------- 설정 창 ----------

let settingsWin = null;

function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 620, height: 720,
    title: '스샷핀 설정',
    autoHideMenuBar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  settingsWin.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWin.webContents.once('did-finish-load', () => sendSettingsState());
  settingsWin.on('closed', () => { settingsWin = null; });
}

function sendSettingsState() {
  if (!settingsWin) return;
  settingsWin.webContents.send('settings-state', {
    hotkeys: settings.hotkeys,
    labels: HOTKEY_LABELS,
    defaults: DEFAULT_HOTKEYS,
    saveDir: currentSaveDir(),
    saveDirIsDefault: !settings.saveDir,
    quickSave: settings.quickSave,
    quickbarVisible: settings.quickbarVisible,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    failures: hotkeyFailures,
    isMac,
    version: app.getVersion(),
    update: updateState,
  });
}

// 단축키가 바뀌면 퀵바 툴팁·트레이 메뉴도 함께 갱신
function broadcastHotkeys() {
  if (quickbarWin && !quickbarWin.isDestroyed()) {
    quickbarWin.webContents.send('quickbar-state', { hotkeys: settings.hotkeys });
  }
  rebuildTrayMenu();
}

ipcMain.on('settings-set-hotkey', (e, { key, accel }) => {
  if (!HOTKEY_ACTIONS[key]) return;
  // 빈 값('사용 안 함')은 허용, 그 외에는 ASCII 액셀러레이터만 저장
  if (accel && !isValidAccelerator(accel)) {
    notify('이 키는 단축키로 쓸 수 없습니다. 한글 입력을 끄고 다시 시도해주세요.');
    sendSettingsState();
    return;
  }
  settings.hotkeys[key] = accel;
  saveSettings();
  const failures = registerHotkeys();
  sendSettingsState();
  broadcastHotkeys();
  if (accel && failures.some((f) => f.includes(accel))) {
    notify(`"${accel}" 단축키를 사용할 수 없습니다. 다른 프로그램이 이미 쓰고 있을 수 있어요.`);
  }
});

ipcMain.on('settings-reset-hotkeys', () => {
  settings.hotkeys = { ...DEFAULT_HOTKEYS };
  saveSettings();
  registerHotkeys();
  sendSettingsState();
  broadcastHotkeys();
});

ipcMain.on('settings-set-flag', (e, { key, value }) => {
  if (key === 'quickSave') {
    settings.quickSave = !!value;
    saveSettings();
  } else if (key === 'quickbarVisible') {
    setQuickbarVisible(!!value);
  } else if (key === 'openAtLogin') {
    app.setLoginItemSettings({ openAtLogin: !!value });
    rebuildTrayMenu();
  }
  sendSettingsState();
});

ipcMain.handle('settings-pick-dir', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(settingsWin || null, {
    title: '저장 폴더 선택',
    defaultPath: currentSaveDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!canceled && filePaths[0]) {
    settings.saveDir = filePaths[0];
    saveSettings();
  }
  sendSettingsState();
});

ipcMain.on('settings-reset-dir', () => {
  settings.saveDir = '';
  saveSettings();
  sendSettingsState();
});

ipcMain.on('settings-open-dir', () => {
  shell.openPath(currentSaveDir());
});

ipcMain.on('settings-open-logs', () => {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '');
    shell.showItemInFolder(logPath);
  } catch (e) {
    notify('로그 폴더를 열지 못했습니다.');
  }
});

ipcMain.on('settings-open-help', () => openHelp());

// ---------- 도움말 ----------

function openHelp() {
  if (helpWin) { helpWin.focus(); return; }
  helpWin = new BrowserWindow({
    width: 620, height: 760,
    title: '스샷핀 사용법',
    autoHideMenuBar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  helpWin.loadFile(path.join(__dirname, 'src', 'help.html'));
  // 실제 지정된 단축키를 표에 그대로 보여주기 위해 전달
  helpWin.webContents.once('did-finish-load', () => {
    helpWin.webContents.send('help-state', { hotkeys: settings.hotkeys });
  });
  helpWin.on('closed', () => { helpWin = null; });
}

// ---------- 핀 ----------

function effSize(p) {
  // 회전(90/270도) 시 가로세로 교체
  const w = p.rot % 2 === 1 ? p.baseH : p.baseW;
  const h = p.rot % 2 === 1 ? p.baseW : p.baseH;
  return [Math.round(w * p.scale), Math.round(h * p.scale)];
}

function sendTransform(p) {
  p.win.webContents.send('pin-transform', {
    rot: p.rot, flipH: p.flipH, flipV: p.flipV,
    borderVisible: p.borderVisible, borderColor: p.borderColor,
  });
}

// 창 크기를 중심 고정으로 변경
function resizePinCentered(p, newW, newH) {
  const b = p.win.getBounds();
  setBoundsForce(p.win, {
    x: Math.round(b.x - (newW - b.width) / 2),
    y: Math.round(b.y - (newH - b.height) / 2),
    width: newW, height: newH,
  });
}

function createPin(dataURL, w, h, x, y) {
  const id = ++pinSeq;
  const win = new BrowserWindow({
    x: Math.round(x), y: Math.round(y),
    width: Math.max(24, Math.round(w)),
    height: Math.max(24, Math.round(h)),
    useContentSize: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'src', 'pin.html'));

  const st = {
    win, dataURL,
    baseW: Math.max(24, Math.round(w)),
    baseH: Math.max(24, Math.round(h)),
    scale: 1, opacity: 1,
    rot: 0, flipH: false, flipV: false,
    borderVisible: settings.pinBorderVisible,
    borderColor: settings.pinBorderColor,
    clickThrough: false,
    collapsed: false, savedBounds: null,
  };
  pins.set(id, st);

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('pin-init', { id, dataURL });
    sendTransform(st);
    win.show();
  });
  win.webContents.on('context-menu', () => popupPinMenu(id));
  win.on('closed', () => { pins.delete(id); pinResizeOrigins.delete(id); rebuildTrayMenu(); });
  rebuildTrayMenu();
  return id;
}

function pinFromClipboard() {
  const img = clipboard.readImage();
  if (img.isEmpty()) {
    const hk = settings.hotkeys.pin;
    notify(`클립보드에 이미지가 없습니다.${hk ? ` (이미지를 복사한 뒤 ${hk})` : ''}`);
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const size = img.getSize();
  const w = Math.round(size.width / display.scaleFactor);
  const h = Math.round(size.height / display.scaleFactor);
  createPin(img.toDataURL(), w, h, cursor.x - w / 2, cursor.y - h / 2);
}

const BORDER_COLORS = [
  ['파랑', '#3b82f6'], ['빨강', '#ef4444'], ['초록', '#22c55e'],
  ['노랑', '#eab308'], ['검정', '#1e293b'], ['흰색', '#f8fafc'],
];

function popupPinMenu(id) {
  const p = pins.get(id);
  if (!p) return;
  const menu = Menu.buildFromTemplate([
    { label: '복사', accelerator: 'Ctrl+C', click: () => pinCopy(id) },
    { label: '저장…', accelerator: 'Ctrl+S', click: () => pinSave(id) },
    { type: 'separator' },
    {
      label: `크기 (${Math.round(p.scale * 100)}%) — 모퉁이를 끌어도 됩니다`,
      submenu: [33, 50, 100, 150, 200].map((pct) => ({
        label: `${pct}%`,
        type: 'radio', checked: Math.round(p.scale * 100) === pct,
        click: () => pinSetScale(id, pct / 100),
      })),
    },
    {
      label: `투명도 (${Math.round(p.opacity * 100)}%)`,
      submenu: [100, 80, 60, 40, 20].map((pct) => ({
        label: `${pct}%`,
        type: 'radio', checked: Math.round(p.opacity * 100) === pct,
        click: () => pinSetOpacity(id, pct / 100),
      })),
    },
    {
      label: '회전·반전',
      submenu: [
        { label: '시계 방향 90° (1)', click: () => pinRotate(id, 1) },
        { label: '반시계 방향 90° (2)', click: () => pinRotate(id, -1) },
        { label: '좌우 반전 (3)', click: () => pinFlip(id, 'h') },
        { label: '상하 반전 (4)', click: () => pinFlip(id, 'v') },
      ],
    },
    {
      label: '테두리',
      submenu: [
        {
          label: '테두리 표시', type: 'checkbox', checked: p.borderVisible,
          click: () => pinSetBorder(id, { visible: !p.borderVisible }),
        },
        { type: 'separator' },
        ...BORDER_COLORS.map(([name, color]) => ({
          label: name, type: 'radio', checked: p.borderColor === color,
          click: () => pinSetBorder(id, { color }),
        })),
      ],
    },
    { type: 'separator' },
    {
      label: '클릭 통과 (트레이에서 해제)',
      click: () => pinSetClickThrough(id, true),
    },
    { label: p.collapsed ? '펼치기' : '접기 (더블클릭)', click: () => pinToggleCollapse(id) },
    { label: '원래 크기·투명도 (0)', click: () => pinReset(id) },
    { type: 'separator' },
    { label: '닫기', accelerator: 'Esc', click: () => p.win.close() },
    { label: '모든 핀 닫기', click: closeAllPins },
  ]);
  menu.popup({ window: p.win });
}

function pinCopy(id) {
  const p = pins.get(id);
  if (!p) return;
  clipboard.writeImage(nativeImage.createFromDataURL(p.dataURL));
  notify('클립보드에 복사했습니다.');
}

function pinSave(id) {
  const p = pins.get(id);
  if (p) saveImageDialog(p.dataURL, p.win);
}

function pinSetScale(id, s) {
  const p = pins.get(id);
  if (!p || p.collapsed) return;
  p.scale = clamp(s, 0.1, 8);
  const [w, h] = effSize(p);
  resizePinCentered(p, w, h);
}

function pinSetOpacity(id, o) {
  const p = pins.get(id);
  if (!p) return;
  p.opacity = clamp(o, 0.15, 1);
  p.win.setOpacity(p.opacity);
}

function pinReset(id) {
  const p = pins.get(id);
  if (!p || p.collapsed) return;
  p.scale = 1;
  p.opacity = 1;
  p.rot = 0;
  p.flipH = false;
  p.flipV = false;
  p.win.setOpacity(1);
  const [w, h] = effSize(p);
  resizePinCentered(p, w, h);
  sendTransform(p);
}

function pinZoom(id, dir, ctrl) {
  const p = pins.get(id);
  if (!p || p.collapsed) return;
  if (ctrl) {
    pinSetOpacity(id, p.opacity + (dir > 0 ? 0.1 : -0.1));
    return;
  }
  const old = p.scale;
  p.scale = clamp(p.scale * (dir > 0 ? 1.1 : 1 / 1.1), 0.1, 8);
  if (p.scale === old) return;
  const [w, h] = effSize(p);
  resizePinCentered(p, w, h);
}

// 모퉁이를 끌어 크기 조절 (스니페이스트 방식). 원본 비율은 유지하고,
// 잡지 않은 쪽 모퉁이는 제자리에 남는다.
const pinResizeOrigins = new Map();   // id -> 드래그 시작 시점의 창 위치·크기·배율

function pinResizeStart(id, corner) {
  const p = pins.get(id);
  if (!p || p.collapsed) return;
  const b = p.win.getBounds();
  pinResizeOrigins.set(id, { corner, x: b.x, y: b.y, w: b.width, h: b.height, scale: p.scale });
}

function pinResizeMove(id, dx, dy) {
  const p = pins.get(id);
  const o = pinResizeOrigins.get(id);
  if (!p || !o || p.collapsed) return;

  // 회전을 반영한 배율 1일 때의 크기
  const bw = p.rot % 2 === 1 ? p.baseH : p.baseW;
  const bh = p.rot % 2 === 1 ? p.baseW : p.baseH;

  // 서쪽·북쪽 모퉁이는 끌는 방향이 반대다
  const sgnX = o.corner.includes('w') ? -1 : 1;
  const sgnY = o.corner.includes('n') ? -1 : 1;
  const wantW = o.w + dx * sgnX;
  const wantH = o.h + dy * sgnY;

  // 가로·세로 중 더 많이 끈 축을 따라가 비율을 유지한다
  const scale = clamp(
    Math.abs(wantW - o.w) >= Math.abs(wantH - o.h) ? wantW / bw : wantH / bh,
    0.1, 8);
  const w = Math.max(24, Math.round(bw * scale));
  const h = Math.max(24, Math.round(bh * scale));
  const x = o.corner.includes('w') ? o.x + (o.w - w) : o.x;
  const y = o.corner.includes('n') ? o.y + (o.h - h) : o.y;

  p.scale = scale;
  setBoundsForce(p.win, { x: Math.round(x), y: Math.round(y), width: w, height: h });
}

function pinRotate(id, delta) {
  const p = pins.get(id);
  if (!p || p.collapsed) return;
  p.rot = ((p.rot + delta) % 4 + 4) % 4;
  const [w, h] = effSize(p);
  resizePinCentered(p, w, h);
  sendTransform(p);
}

function pinFlip(id, axis) {
  const p = pins.get(id);
  if (!p || p.collapsed) return;
  if (axis === 'h') p.flipH = !p.flipH;
  else p.flipV = !p.flipV;
  sendTransform(p);
}

function pinSetBorder(id, { visible, color }) {
  const p = pins.get(id);
  if (!p) return;
  if (visible !== undefined) p.borderVisible = visible;
  if (color !== undefined) p.borderColor = color;
  sendTransform(p);
  // 마지막 선택을 새 핀의 기본값으로 저장
  settings.pinBorderVisible = p.borderVisible;
  settings.pinBorderColor = p.borderColor;
  saveSettings();
}

function pinSetClickThrough(id, on) {
  const p = pins.get(id);
  if (!p) return;
  p.clickThrough = on;
  p.win.setIgnoreMouseEvents(on);
  if (on) notify('클릭 통과 모드 — 트레이 메뉴에서 해제할 수 있습니다.');
  rebuildTrayMenu();
}

function releaseAllClickThrough() {
  for (const [id, p] of pins) {
    if (p.clickThrough) {
      p.clickThrough = false;
      p.win.setIgnoreMouseEvents(false);
    }
  }
  rebuildTrayMenu();
}

function pinToggleCollapse(id) {
  const p = pins.get(id);
  if (!p) return;
  if (!p.collapsed) {
    p.savedBounds = p.win.getBounds();
    setBoundsForce(p.win, { ...p.win.getBounds(), width: 150, height: 34 });
    p.collapsed = true;
  } else {
    const b = p.savedBounds || { width: p.baseW, height: p.baseH };
    setBoundsForce(p.win, { ...p.win.getBounds(), width: b.width, height: b.height });
    p.collapsed = false;
  }
  p.win.webContents.send('pin-collapse', { collapsed: p.collapsed });
}

function closeAllPins() {
  for (const p of [...pins.values()]) p.win.close();
}

function toggleAllPinsVisible() {
  pinsHidden = !pinsHidden;
  for (const p of pins.values()) {
    if (pinsHidden) p.win.hide();
    else p.win.show();
  }
  rebuildTrayMenu();
}

// ---------- IPC ----------

// 창 공통 드래그 이동 (핀·타이머)
ipcMain.on('win-drag-start', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) dragOrigins.set(e.sender.id, win.getPosition());
});
ipcMain.on('win-drag-move', (e, { dx, dy }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const origin = dragOrigins.get(e.sender.id);
  if (win && origin) win.setPosition(Math.round(origin[0] + dx), Math.round(origin[1] + dy));
});

ipcMain.on('pin-zoom', (e, { id, dir, ctrl }) => pinZoom(id, dir, ctrl));
ipcMain.on('pin-close', (e, id) => pins.get(id)?.win.close());
ipcMain.on('pin-copy', (e, id) => pinCopy(id));
ipcMain.on('pin-save', (e, id) => pinSave(id));
ipcMain.on('pin-reset', (e, id) => pinReset(id));
ipcMain.on('pin-toggle-collapse', (e, id) => pinToggleCollapse(id));
ipcMain.on('pin-rotate', (e, { id, delta }) => pinRotate(id, delta));
ipcMain.on('pin-flip', (e, { id, axis }) => pinFlip(id, axis));
ipcMain.on('pin-resize-start', (e, { id, corner }) => pinResizeStart(id, corner));
ipcMain.on('pin-resize-move', (e, { id, dx, dy }) => pinResizeMove(id, dx, dy));

// ---------- 트레이 ----------

function rebuildTrayMenu() {
  if (!tray) return;
  const login = app.getLoginItemSettings();
  const anyClickThrough = [...pins.values()].some((p) => p.clickThrough);
  const hk = settings.hotkeys;
  const menu = Menu.buildFromTemplate([
    { label: '📸 영역 캡처', accelerator: hk.capture || undefined, click: () => startCapture('capture') },
    { label: '📌 클립보드 이미지 핀', accelerator: hk.pin || undefined, click: pinFromClipboard },
    { label: '🔍 화면 확대·축소', accelerator: hk.zoom || undefined, click: () => toggleOverlay('zoom') },
    { label: '✏️ 판서 (화면에 그리기)', accelerator: hk.draw || undefined, click: () => toggleOverlay('draw') },
    { label: '⏱️ 타이머', accelerator: hk.timer || undefined, click: toggleTimer },
    { label: '🙈 가리개', accelerator: hk.cover || undefined, click: () => startCapture('cover') },
    { label: `🕘 최근 캡처 (${history.length})`, click: openHistory, enabled: history.length > 0 },
    { type: 'separator' },
    { label: pinsHidden ? '핀 모두 보이기' : '핀 모두 숨기기', click: toggleAllPinsVisible, enabled: pins.size > 0 || pinsHidden },
    { label: '핀 모두 닫기', click: closeAllPins, enabled: pins.size > 0 },
    { label: '가리개 모두 닫기', click: closeAllCovers, enabled: covers.size > 0 },
    { label: '클릭 통과 모두 해제', click: releaseAllClickThrough, enabled: anyClickThrough },
    { type: 'separator' },
    { label: '❓ 사용법·단축키', click: openHelp },
    { label: '⚙️ 설정 (단축키 변경·저장 폴더)', click: openSettings },
    {
      label: '퀵 실행바 표시',
      type: 'checkbox',
      checked: settings.quickbarVisible,
      click: (item) => setQuickbarVisible(item.checked),
    },
    {
      label: '컴퓨터 시작 시 자동 실행',
      type: 'checkbox',
      checked: login.openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: '업데이트 확인', click: checkUpdatesManually },
    { label: `스샷핀 v${app.getVersion()}`, enabled: false },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('스샷핀 — 아이콘을 우클릭하면 모든 기능과 설정을 볼 수 있어요');
  rebuildTrayMenu();
  tray.on('double-click', () => startCapture('capture'));
}

// ---------- 업데이트 ----------

// 업데이트 진행 상황을 설정 창에도 보여준다
let updateState = { status: 'idle', text: '' };
function setUpdateState(status, text) {
  updateState = { status, text };
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('update-state', updateState);
  }
}

function checkUpdatesManually() {
  if (!app.isPackaged) {
    setUpdateState('idle', '개발 모드에서는 업데이트를 확인할 수 없습니다.');
    return;
  }
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    setUpdateState('error', '업데이트 기능을 불러오지 못했습니다.');
    return;
  }
  // 리스너를 지우지 않으면 확인할 때마다 쌓여 알림이 여러 번 뜬다
  for (const ev of ['update-available', 'update-not-available', 'error',
                    'download-progress', 'update-downloaded']) {
    autoUpdater.removeAllListeners(ev);
  }
  autoUpdater.autoDownload = true;
  setUpdateState('checking', '새 버전을 확인하는 중…');

  autoUpdater.once('update-available', (info) =>
    setUpdateState('downloading', `새 버전 v${info.version}을 내려받는 중… 0%`));
  autoUpdater.on('download-progress', (p) =>
    setUpdateState('downloading', `내려받는 중… ${Math.round(p.percent)}%`));
  autoUpdater.once('update-not-available', () =>
    setUpdateState('latest', '지금이 최신 버전입니다.'));
  autoUpdater.once('update-downloaded', (info) => {
    setUpdateState('ready', `v${info.version} 준비 완료 — 다시 시작하면 적용됩니다.`);
    notify(`새 버전 v${info.version}을 받았습니다. 다시 시작하면 적용됩니다.`);
  });
  autoUpdater.once('error', (err) => {
    const net = /net::|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/.test(String(err && err.message));
    setUpdateState('error', net
      ? '인터넷에 연결되어 있는지 확인해주세요.'
      : '업데이트 확인에 실패했습니다. 잠시 후 다시 시도해주세요.');
  });

  autoUpdater.checkForUpdates().catch(() => { /* error 리스너가 처리 */ });
}

// 설정 창의 "지금 다시 시작" 버튼
ipcMain.on('update-restart', () => {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall();
  } catch (e) {
    notify('다시 시작하지 못했습니다. 프로그램을 직접 종료한 뒤 다시 실행해주세요.');
  }
});
ipcMain.on('update-check', () => checkUpdatesManually());

// ---------- 첫 실행 ----------

async function firstRunFlow() {
  if (settings.firstRunDone) return;
  settings.firstRunDone = true;
  saveSettings();

  openHelp();

  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: '스샷핀',
    message: '컴퓨터를 켤 때 스샷핀을 자동으로 실행할까요?',
    detail: `자동 실행을 켜두면 부팅 후 바로 ${settings.hotkeys.capture}(캡처), ${settings.hotkeys.pin}(핀)을 쓸 수 있습니다.\n트레이 메뉴에서 언제든 바꿀 수 있습니다.`,
    buttons: ['자동 실행 켜기 (추천)', '나중에'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    app.setLoginItemSettings({ openAtLogin: true });
    rebuildTrayMenu();
  }
}

// ---------- 앱 라이프사이클 ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () =>
    notify(`스샷핀이 이미 실행 중입니다. (${settings.hotkeys.capture} 캡처 / ${settings.hotkeys.pin} 핀)`));

  app.whenReady().then(() => {
    app.setAppUserModelId('com.sshotpin.app');
    createTray();
    if (settings.quickbarVisible) createQuickbar();

    const failures = registerHotkeys();
    if (failures.length) {
      notify(`단축키 충돌: ${failures.join(', ')} — 트레이 → ⚙️ 설정에서 바꿀 수 있어요.`);
    }
    if (hotkeysMigrated) {
      saveSettings();
      log('단축키를 새 기본값으로 자동 변경', JSON.stringify(settings.hotkeys));
      notify(`단축키가 바뀌었습니다. 캡처 ${settings.hotkeys.capture}, 핀 ${settings.hotkeys.pin}`);
    }

    // 첫 단축키가 곧바로 반응하도록 오버레이 창을 미리 만들어 둔다
    prewarmOverlay('capture');
    prewarmOverlay('overlay');

    ensureInApplicationsFolder().then(() => firstRunFlow());

    // 자동 업데이트 (설치 버전에서만) — GitHub Releases 확인
    if (app.isPackaged) {
      try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.on('error', () => { /* 네트워크 오류 등은 조용히 무시 */ });
        autoUpdater.checkForUpdatesAndNotify({
          title: '스샷핀 업데이트',
          body: '새 버전이 다운로드됐습니다. 프로그램을 다시 시작하면 적용됩니다.',
        });
      } catch (e) { /* 업데이트 실패는 조용히 무시 */ }
    }

    log(`스샷핀 v${app.getVersion()} 시작 — 단축키 ${JSON.stringify(settings.hotkeys)}`);
  });

  // 트레이 상주 앱: 창이 모두 닫혀도 종료하지 않음
  app.on('window-all-closed', () => {});

  app.on('will-quit', () => globalShortcut.unregisterAll());
}
