const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 창 공통 드래그 이동
  winDragStart: () => ipcRenderer.send('win-drag-start'),
  winDragMove: (dx, dy) => ipcRenderer.send('win-drag-move', { dx, dy }),

  // 퀵 실행바
  quickbarAction: (action) => ipcRenderer.send('quickbar-action', action),

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
