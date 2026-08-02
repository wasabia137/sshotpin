const { contextBridge, ipcRenderer } = require('electron');

// 창 안에서 발생한 오류를 메인 프로세스 로그로 보냄 (문제 진단용)
window.addEventListener('error', (e) => {
  ipcRenderer.send('renderer-log',
    `[${location.pathname.split('/').pop()}] ${e.message} @ ${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  ipcRenderer.send('renderer-log',
    `[${location.pathname.split('/').pop()}] unhandled: ${e.reason}`);
});

contextBridge.exposeInMainWorld('api', {
  log: (msg) => ipcRenderer.send('renderer-log', String(msg)),
  // 창 공통 드래그 이동
  winDragStart: () => ipcRenderer.send('win-drag-start'),
  winDragMove: (dx, dy) => ipcRenderer.send('win-drag-move', { dx, dy }),

  // 퀵 실행바
  quickbarAction: (action) => ipcRenderer.send('quickbar-action', action),

  // 사용법 창
  onHelpState: (cb) => ipcRenderer.on('help-state', (e, d) => cb(d)),

  // 설정 창
  onSettingsState: (cb) => ipcRenderer.on('settings-state', (e, d) => cb(d)),
  setHotkey: (key, accel) => ipcRenderer.send('settings-set-hotkey', { key, accel }),
  resetHotkeys: () => ipcRenderer.send('settings-reset-hotkeys'),
  setFlag: (key, value) => ipcRenderer.send('settings-set-flag', { key, value }),
  pickSaveDir: () => ipcRenderer.invoke('settings-pick-dir'),
  resetSaveDir: () => ipcRenderer.send('settings-reset-dir'),
  openSaveDir: () => ipcRenderer.send('settings-open-dir'),
  openHelpFromSettings: () => ipcRenderer.send('settings-open-help'),
  openLogs: () => ipcRenderer.send('settings-open-logs'),

  // 최근 캡처
  onHistoryState: (cb) => ipcRenderer.on('history-state', (e, d) => cb(d)),
  historyPin: (id) => ipcRenderer.send('history-pin', id),
  historyCopy: (id) => ipcRenderer.send('history-copy', id),
  historySave: (id) => ipcRenderer.send('history-save', id),
  historyDelete: (id) => ipcRenderer.send('history-delete', id),
  historyClear: () => ipcRenderer.send('history-clear'),

  // 캡처 오버레이
  onCaptureInit: (cb) => ipcRenderer.on('capture-init', (e, d) => cb(d)),
  captureFinish: (payload) => ipcRenderer.send('capture-finish', payload),

  // 확대·판서 오버레이
  onOverlayInit: (cb) => ipcRenderer.on('overlay-init', (e, d) => cb(d)),
  overlayFinish: (payload) => ipcRenderer.send('overlay-finish', payload),

  // 정답 가리개
  onCoverInit: (cb) => ipcRenderer.on('cover-init', (e, d) => cb(d)),
  onCoverToggle: (cb) => ipcRenderer.on('cover-toggle', () => cb()),
  onCoverStyle: (cb) => ipcRenderer.on('cover-style', (e, d) => cb(d)),
  coverClose: (id) => ipcRenderer.send('cover-close', id),

  // 핀 창
  onPinInit: (cb) => ipcRenderer.on('pin-init', (e, d) => cb(d)),
  onPinCollapse: (cb) => ipcRenderer.on('pin-collapse', (e, d) => cb(d)),
  onPinTransform: (cb) => ipcRenderer.on('pin-transform', (e, d) => cb(d)),
  pinZoom: (id, dir, ctrl) => ipcRenderer.send('pin-zoom', { id, dir, ctrl }),
  pinClose: (id) => ipcRenderer.send('pin-close', id),
  pinCopy: (id) => ipcRenderer.send('pin-copy', id),
  pinSave: (id) => ipcRenderer.send('pin-save', id),
  pinReset: (id) => ipcRenderer.send('pin-reset', id),
  pinToggleCollapse: (id) => ipcRenderer.send('pin-toggle-collapse', id),
  pinRotate: (id, delta) => ipcRenderer.send('pin-rotate', { id, delta }),
  pinFlip: (id, axis) => ipcRenderer.send('pin-flip', { id, axis }),
});
