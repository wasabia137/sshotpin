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

// 디스플레이 전체 스크린샷 → dataURL
// 화면 기록 권한이 없거나 시스템이 응답하지 않으면 무한정 기다리지 않고 끊는다.
async function grabDisplay(display) {
  const { width, height } = display.bounds;
  const scale = display.scaleFactor;
  const job = desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  });
  const sources = await Promise.race([
    job,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('화면을 읽는 데 너무 오래 걸립니다')), 8000)),
  ]);
  const source =
    sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) return null;
  return source.thumbnail.toDataURL();
}

// 오버레이 창을 띄우고 실제로 보이는 것까지 확인한다.
// did-finish-load를 놓치는 경우가 있어 로드 완료·타임아웃 양쪽으로 보호한다.
function showOverlayWhenReady(win, channel, payload) {
  let shown = false;
  const reveal = () => {
    if (shown || !win || win.isDestroyed()) return;
    shown = true;
    win.webContents.send(channel, payload);
    win.show();
    win.focus();
  };
  win.webContents.once('did-finish-load', reveal);
  // 이벤트를 놓쳐도 창이 뜨도록 하는 안전장치
  setTimeout(reveal, 1200);
}

// 전체 화면 오버레이 창 공통 옵션
function fullscreenOverlayWindow(display) {
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    resizable: false,
    movable: false,
    fullscreen: !isMac,
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
  if (isMac) win.setBounds({ x, y, width, height });
  return win;
}

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

// 캡처 직전에 퀵바를 잠시 숨겨 스크린샷에 찍히지 않게 함
async function hideQuickbarForGrab() {
  if (quickbarWin && quickbarWin.isVisible()) {
    quickbarWin.hide();
    await new Promise((r) => setTimeout(r, 150));
  }
}

function reshowQuickbar() {
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
  if (captureWin) { captureWin.close(); return; }
  // 창 변수가 채워지기 전(화면 읽는 사이)에 다시 눌리면 오버레이가 두 겹 생기고,
  // Esc가 최신 창만 닫아 그림이 남은 유령 창이 생긴다 — 여기서 차단
  if (captureBusy) return;
  captureBusy = true;
  try {
    if (overlayWin) {
      // 확대·판서 창이 화면에서 실제로 사라진 뒤에 찍어야 오버레이가 함께 찍히지 않는다
      overlayWin.close();
      await new Promise((r) => setTimeout(r, 150));
    }

    if (!ensureScreenAccess()) return;

    const display = cursorDisplay();
    await hideQuickbarForGrab();
    let dataURL;
    try {
      dataURL = await grabDisplay(display);
    } catch (err) {
      log('캡처 실패', err.message);
      notify(`화면을 읽지 못했습니다. ${err.message}`);
      reshowQuickbar();
      return;
    }
    if (!dataURL) {
      log('캡처 실패 — 빈 화면');
      notify('화면을 캡처하지 못했습니다. 잠시 후 다시 시도해주세요.');
      reshowQuickbar();
      return;
    }

    captureDisplay = { ...display.bounds };
    captureWin = fullscreenOverlayWindow(display);
    captureWin.loadFile(path.join(__dirname, 'src', 'capture.html'));
    showOverlayWhenReady(captureWin, 'capture-init', { dataURL, mode });
    captureWin.on('closed', () => { captureWin = null; reshowQuickbar(); });
  } finally {
    captureBusy = false;
  }
}

// 맥은 화면 기록 권한이 없으면 캡처가 조용히 실패한다 — 미리 걸러서 안내한다.
// 단, 아직 한 번도 물어보지 않은 상태(not-determined)는 통과시킨다.
// 여기서 막으면 OS의 권한 요청 팝업이 뜰 기회가 없어
// 사용자가 시스템 설정에서 손으로 앱을 추가해야 하기 때문이다.
function ensureScreenAccess() {
  if (!isMac) return true;
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted' || status === 'not-determined') return true;
  log('화면 기록 권한 없음:', status);
  notify('화면 기록 권한이 필요합니다. 시스템 설정에서 스샷핀을 허용해주세요.');
  shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  reshowQuickbar();
  return false;
}

ipcMain.on('capture-finish', (e, payload) => {
  const disp = captureDisplay;
  // 보낸 창 자신을 닫는다 — captureWin 변수가 다른 창을 가리키게 된 경우에도
  // Esc(취소)가 항상 자기 창을 닫을 수 있도록
  const sender = BrowserWindow.fromWebContents(e.sender);
  if (sender && !sender.isDestroyed()) sender.close();
  if (captureWin && captureWin !== sender) captureWin.close();
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
  if (overlayWin) { overlayWin.close(); return; }
  if (captureWin || overlayBusy) return;
  overlayBusy = true;
  try {
    if (!ensureScreenAccess()) return;

    const display = cursorDisplay();
    await hideQuickbarForGrab();
    let dataURL;
    try {
      dataURL = await grabDisplay(display);
    } catch (err) {
      log('확대·판서 실패', err.message);
      notify(`화면을 읽지 못했습니다. ${err.message}`);
      reshowQuickbar();
      return;
    }
    if (!dataURL) {
      notify('화면을 캡처하지 못했습니다. 잠시 후 다시 시도해주세요.');
      reshowQuickbar();
      return;
    }

    overlayDisplay = { ...display.bounds };
    overlayWin = fullscreenOverlayWindow(display);
    overlayWin.loadFile(path.join(__dirname, 'src', 'screen.html'));
    // 확대는 마우스 위치를 중심으로 시작해야 한다 (ZoomIt과 동일)
    const cur = screen.getCursorScreenPoint();
    showOverlayWhenReady(overlayWin, 'overlay-init', {
      dataURL, mode,
      cursor: { x: cur.x - display.bounds.x, y: cur.y - display.bounds.y },
    });
    overlayWin.on('closed', () => { overlayWin = null; reshowQuickbar(); });
  } finally {
    overlayBusy = false;
  }
}

ipcMain.on('overlay-finish', (e, payload) => {
  const disp = overlayDisplay;
  // 보낸 창 자신을 닫는다 — 변수가 다른 창을 가리켜도 Esc가 항상 통하게
  const sender = BrowserWindow.fromWebContents(e.sender);
  const closeSender = () => {
    if (sender && !sender.isDestroyed()) sender.close();
    if (overlayWin && overlayWin !== sender) overlayWin.close();
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
  win.on('closed', () => { pins.delete(id); rebuildTrayMenu(); });
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
      label: `확대/축소 (${Math.round(p.scale * 100)}%)`,
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

function checkUpdatesManually() {
  if (!app.isPackaged) {
    notify('개발 모드에서는 업데이트 확인을 지원하지 않습니다.');
    return;
  }
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.removeAllListeners('update-available');
    autoUpdater.removeAllListeners('update-not-available');
    // error 리스너도 지운다 — 안 지우면 확인할 때마다 쌓여 오류 한 번에 알림이 여러 개 뜬다
    autoUpdater.removeAllListeners('error');
    autoUpdater.once('update-available', (info) =>
      notify(`새 버전 v${info.version}을 내려받는 중입니다. 완료되면 알려드려요.`));
    autoUpdater.once('update-not-available', () => notify('지금이 최신 버전입니다. 👍'));
    autoUpdater.once('error', () => notify('업데이트 확인에 실패했습니다. 잠시 후 다시 시도해주세요.'));
    autoUpdater.checkForUpdatesAndNotify({
      title: '스샷핀 업데이트',
      body: '새 버전이 다운로드됐습니다. 프로그램을 다시 시작하면 적용됩니다.',
    });
  } catch (e) {
    notify('업데이트 확인에 실패했습니다.');
  }
}

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

    firstRunFlow();

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
