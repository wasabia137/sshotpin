// 스샷핀 공용 선 아이콘. 이모지는 윈도우에서 뭉개져 보여 SVG로 그린다.
// <body> 바로 아래에서 <script src="icons.js"> 로 불러오면 그 자리에 심볼 묶음이 들어가고,
// 페이지 어디서든 <svg viewBox="0 0 24 24"><use href="#i-pen"/></svg> 로 쓴다.
(function () {
  const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    // 그리기 도구
    'i-pen': `<g ${S} stroke-width="1.7"><path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5 4 20z"/><path d="M13.5 7l3 3"/></g>`,
    'i-arrow': `<g ${S} stroke-width="1.8"><path d="M5 19L19 5"/><path d="M10 5h9v9"/></g>`,
    'i-rect': `<g ${S} stroke-width="1.7"><rect x="4" y="6" width="16" height="12" rx="1.5"/></g>`,
    'i-ellipse': `<g ${S} stroke-width="1.7"><ellipse cx="12" cy="12" rx="8" ry="6"/></g>`,
    'i-highlight': `<g ${S} stroke-width="1.7"><path d="M6 16l9-9a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3l-9 9H6v-3z"/><path d="M3 21h10"/></g>`,
    'i-mosaic': `<g ${S} stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16"/><path fill="currentColor" stroke="none" opacity=".35" d="M4 4h5.33v5.33H4zM9.33 9.33h5.34v5.34H9.33zM14.67 4H20v5.33h-5.33zM4 14.67h5.33V20H4zM14.67 14.67H20V20h-5.33z"/></g>`,
    'i-step': `<g ${S} stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M12.5 16V8.5l-2 1.5"/></g>`,
    'i-laser': `<g ${S} stroke-width="1.7"><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></g>`,
    'i-undo': `<g ${S} stroke-width="1.7"><path d="M5 10h10a4.5 4.5 0 0 1 0 9H9"/><path d="M8.5 6.5L5 10l3.5 3.5"/></g>`,
    'i-trash': `<g ${S} stroke-width="1.7"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l.8 12.5h10.4L18 7"/><path d="M10 11v5M14 11v5"/></g>`,
    'i-board-white': `<g ${S} stroke-width="1.7"><rect x="3.5" y="4.5" width="17" height="12" rx="1.5"/><path d="M9 20.5h6M12 16.5v4"/></g>`,
    'i-board-black': `<g ${S} stroke-width="1.7"><rect x="3.5" y="4.5" width="17" height="12" rx="1.5" fill="currentColor"/><path d="M9 20.5h6M12 16.5v4"/></g>`,
    'i-minus': `<g ${S} stroke-width="1.8"><path d="M5 12h14"/></g>`,
    'i-plus': `<g ${S} stroke-width="1.8"><path d="M12 5v14M5 12h14"/></g>`,
    // 실행·내보내기
    'i-pin': `<g ${S} stroke-width="1.7"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z"/><path d="M12 14v7"/></g>`,
    'i-copy': `<g ${S} stroke-width="1.7"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></g>`,
    'i-save': `<g ${S} stroke-width="1.7"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H16l4 4v10.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/></g>`,
    'i-cover': `<g ${S} stroke-width="1.7"><path d="M3 3l18 18"/><path d="M10.5 5.3c.5-.1 1-.1 1.5-.1 5 0 8.6 4 9.8 6.8-.5 1.1-1.3 2.4-2.5 3.6M6.6 6.6C4.5 8 3 10.2 2.2 12c1.2 2.8 4.8 6.8 9.8 6.8 1.6 0 3.1-.4 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></g>`,
    'i-close': `<g ${S} stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></g>`,
    // 퀵바·창
    'i-grip': `<g fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></g>`,
    'i-camera': `<g ${S} stroke-width="1.7"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.3-2h5.4L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/></g>`,
    'i-zoom': `<g ${S} stroke-width="1.7"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/><path d="M8.5 11h5M11 8.5v5"/></g>`,
    'i-timer': `<g ${S} stroke-width="1.7"><circle cx="12" cy="13.5" r="7"/><path d="M12 9.5v4l2.5 1.5"/><path d="M10 3h4M12 3v3.5"/></g>`,
    'i-history': `<g ${S} stroke-width="1.7"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4h4"/><path d="M12 8v4.5l3 1.8"/></g>`,
    'i-help': `<g ${S} stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1 .9-1 1.7"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/></g>`,
    'i-gear': `<g ${S} stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></g>`,
    'i-download': `<g ${S} stroke-width="2"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></g>`,
    'i-restart': `<g ${S} stroke-width="1.8"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3v5h-5"/></g>`,
    'i-doc': `<g ${S} stroke-width="1.7"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/></g>`,
    'i-coffee': `<g ${S} stroke-width="1.7"><path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M16 11h1.5a2 2 0 0 1 0 4H16"/><path d="M7 3.5v2M10 3.5v2M13 3.5v2"/></g>`,
    'i-check': `<g ${S} stroke-width="2.2"><path d="M5 12.5l4.5 4.5L19 7.5"/></g>`,
  };
  let defs = '';
  for (const [id, body] of Object.entries(ICONS)) defs += `<symbol id="${id}" viewBox="0 0 24 24">${body}</symbol>`;
  const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${defs}</svg>`;
  const here = document.currentScript;
  if (here) here.insertAdjacentHTML('afterend', sprite);
  else document.addEventListener('DOMContentLoaded', () => document.body.insertAdjacentHTML('afterbegin', sprite));
})();
