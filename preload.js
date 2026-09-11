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
  // 표시 언어 (ko·en·ja·zh·es·fr·de·pt·ru 중 하나) — 창이 열릴 때 메인에서 받아온다
  locale: ipcRenderer.sendSync('get-locale'),
  log: (msg) => ipcRenderer.send('renderer-log', String(msg)),
  // 창 공통 드래그 이동
  winDragStart: () => ipcRenderer.send('win-drag-start'),
  winDragMove: (dx, dy) => ipcRenderer.send('win-drag-move', { dx, dy }),

  // 퀵 실행바
  quickbarAction: (action) => ipcRenderer.send('quickbar-action', action),
  onQuickbarState: (cb) => ipcRenderer.on('quickbar-state', (e, d) => cb(d)),

  // 시작 알림 (잠깐 떴다 사라지는 실행 표시)
  onToastData: (cb) => ipcRenderer.on('toast-data', (e, d) => cb(d)),
  toastClose: () => ipcRenderer.send('toast-close'),
  // 알약 너비를 알려 창을 그 크기로 줄인다 (빈 자리가 클릭을 삼키지 않게)
  toastMeasured: (w) => ipcRenderer.send('toast-measured', w),
  toastOpenHelp: () => ipcRenderer.send('toast-open-help'),

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
  openSupport: () => ipcRenderer.send('open-support'),
  onUpdateState: (cb) => ipcRenderer.on('update-state', (e, d) => cb(d)),
  checkUpdate: () => ipcRenderer.send('update-check'),
  restartForUpdate: () => ipcRenderer.send('update-restart'),

  // 업데이트 창 (진행 상황·준비 완료·업데이트 완료)
  updateClose: () => ipcRenderer.send('update-close'),
  updateNotes: () => ipcRenderer.send('update-notes'),
  // 카드 높이를 알려 창을 그 크기로 맞춘다 (언어마다 글 길이가 다르다)
  updateMeasured: (h) => ipcRenderer.send('update-measured', h),

  // 최근 캡처
  onHistoryState: (cb) => ipcRenderer.on('history-state', (e, d) => cb(d)),
  historyPin: (id) => ipcRenderer.send('history-pin', id),
  historyCopy: (id) => ipcRenderer.send('history-copy', id),
  historySave: (id) => ipcRenderer.send('history-save', id),
  historyDelete: (id) => ipcRenderer.send('history-delete', id),
  historyClear: () => ipcRenderer.send('history-clear'),

  // 오버레이가 첫 그림을 마쳤음을 알림 (그 뒤에 창을 띄워 번쩍임을 없앤다)
  overlayPainted: () => ipcRenderer.send('overlay-painted'),

  // 캡처 오버레이
  onCaptureInit: (cb) => ipcRenderer.on('capture-init', (e, d) => cb(d)),
  captureAutoCopy: (dataURL) => ipcRenderer.send('capture-autocopy', dataURL),
  captureFinish: (payload) => ipcRenderer.send('capture-finish', payload),

  // 확대·판서 오버레이
  onOverlayInit: (cb) => ipcRenderer.on('overlay-init', (e, d) => cb(d)),
  // 창이 실제로 화면에 뜬 순간 (확대 애니메이션 시작 신호)
  onOverlayShown: (cb) => ipcRenderer.on('overlay-shown', () => cb()),
  // F5: 화면을 새로 찍어 배경만 갈아끼우기
  overlayRefresh: () => ipcRenderer.send('overlay-refresh'),
  onOverlayRefresh: (cb) => ipcRenderer.on('overlay-refresh-data', (e, d) => cb(d)),
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
  pinResizeStart: (id, corner) => ipcRenderer.send('pin-resize-start', { id, corner }),
  pinResizeMove: (id, dx, dy) => ipcRenderer.send('pin-resize-move', { id, dx, dy }),
});
