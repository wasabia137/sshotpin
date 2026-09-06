/**
 * 가이드 페이지 생성기 — 검색 유입용 콘텐츠를 한 틀에서 찍어낸다.
 *
 *   npm run guides        content/guides/ → web/guide/ 생성 + 사이트맵 갱신
 *
 * ── 왜 손으로 안 만드나 ──
 * 페이지마다 canonical·OG·GA·JSON-LD·빵부스러기·푸터가 똑같이 들어가야 하는데,
 * 손으로 복사하면 한 곳은 반드시 어긋난다. 사이트맵에 넣는 것도 잊는다.
 * 글 내용(content/guides/<슬러그>.html)만 쓰면 나머지는 여기서 붙인다.
 *
 * ── 주소를 한글로 안 쓰는 이유 ──
 * 맥에서 만든 한글 폴더 이름은 자모가 분리된 형태(NFD)로 저장되는데 브라우저는
 * 합쳐진 형태(NFC)로 요청한다. 파이어베이스에 올리면 이것 때문에 404가 날 수 있다.
 * 주소에 한글이 들어가서 얻는 검색 이득은 거의 없으므로 영문 슬러그를 쓴다.
 *
 * ── 한국어부터 ──
 * 영어권 "screenshot tool"은 경쟁이 극심하다. 교실·발표 쪽 한국어 검색어가
 * 훨씬 승산이 있어 한국어만 먼저 만든다. 통하는 글이 생기면 그때 /en/guide/ 로 옮긴다.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'content', 'guides');
const OUT = join(root, 'web', 'guide');
const BASE = 'https://sshot-pin.web.app';
const GA = 'G-9XBNQ9KQQQ';

const index = JSON.parse(readFileSync(join(SRC, 'index.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 글마다 똑같이 들어가는 머리·꼬리. 디자인 토큰은 본 페이지와 같은 값을 쓴다. */
const STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #f8fafc; --card: #ffffff; --text: #1e293b; --muted: #64748b;
    --line: #e2e8f0; --blue: #2563eb; --chip: #f1f5f9;
    --key-top: #ffffff; --key-bot: #eef2f7; --key-line: #cbd5e1;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --muted: #94a3b8;
      --line: #334155; --blue: #3b82f6; --chip: #334155;
      --key-top: #3b4a61; --key-bot: #27354a; --key-line: #475569;
    }
  }
  body {
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', -apple-system, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.75;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 20px; }
  .topbar { border-bottom: 1px solid var(--line); padding: 14px 0; margin-bottom: 30px; }
  .topbar .wrap { display: flex; align-items: center; gap: 10px; }
  .topbar img { width: 26px; height: 26px; }
  .topbar a { color: var(--text); text-decoration: none; font-weight: 700; }
  .topbar .sp { margin-left: auto; }
  .topbar .sp a { color: var(--blue); font-weight: 600; font-size: 14px; }
  .crumb { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
  .crumb a { color: var(--muted); }
  h1 { font-size: 30px; line-height: 1.35; letter-spacing: -.02em; margin-bottom: 12px; }
  .lead { color: var(--muted); font-size: 16px; margin-bottom: 8px; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 34px; }
  h2 { font-size: 20px; margin: 38px 0 12px; padding-left: 11px; border-left: 4px solid var(--blue); }
  h3 { font-size: 16px; margin: 24px 0 6px; }
  p { margin-bottom: 14px; }
  ul, ol { margin: 0 0 16px 20px; }
  li { margin-bottom: 6px; }
  a { color: var(--blue); }
  table { width: 100%; border-collapse: collapse; font-size: 14.5px; margin-bottom: 18px;
          background: var(--card); border-radius: 10px; overflow: hidden; }
  th, td { padding: 9px 13px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { background: var(--chip); color: var(--muted); font-weight: 600; white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  kbd {
    display: inline-block; padding: 1px 7px; margin: 0 1px; font-size: 12.5px;
    background: linear-gradient(180deg, var(--key-top), var(--key-bot));
    border: 1px solid var(--key-line); border-bottom-width: 2px; border-radius: 5px;
  }
  .note { background: var(--chip); border-radius: 10px; padding: 13px 16px; margin-bottom: 18px; font-size: 14.5px; }
  .cta { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
         padding: 22px; margin: 40px 0 10px; }
  .cta h3 { margin-top: 0; font-size: 17px; }
  .cta p { font-size: 14.5px; color: var(--muted); margin-bottom: 14px; }
  .cta a.btn { display: inline-block; background: var(--blue); color: #fff; text-decoration: none;
               font-weight: 700; padding: 10px 20px; border-radius: 999px; font-size: 15px; }
  .more { margin: 34px 0 0; }
  .more h2 { margin-top: 0; }
  .more ul { list-style: none; margin-left: 0; }
  .more li { margin-bottom: 9px; }
  .more .d { color: var(--muted); font-size: 13.5px; }
  footer { border-top: 1px solid var(--line); margin-top: 46px; padding: 22px 0 40px;
           color: var(--muted); font-size: 13px; text-align: center; }
`;

function head({ title, description, keywords, url }) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="keywords" content="${esc(keywords)}">
<meta name="author" content="스샷핀(Sshot-Pin)">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="스샷핀(Sshot-Pin)">
<meta property="og:locale" content="ko_KR">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${BASE}/og.png">
<meta name="robots" content="index, follow">
<link rel="alternate" type="application/rss+xml" title="스샷핀 가이드" href="${BASE}/rss.xml">
<link rel="icon" type="image/png" href="${BASE}/icon.png">
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA}');
</script>
<!-- Google AdSense -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4886665901652063"
     crossorigin="anonymous"></script>
<style>${STYLE}</style>`;
}

const topbar = `<div class="topbar">
  <div class="wrap">
    <img src="${BASE}/icon.png" alt="">
    <a href="${BASE}/">스샷핀 Sshot-Pin</a>
    <span class="sp"><a href="${BASE}/">내려받기 →</a></span>
  </div>
</div>`;

const footer = `<footer>
  <div class="wrap">
    화면 캡처 · 고정 · 확대 · 판서 · 가리개 · 모자이크 · 타이머<br>
    <a href="${BASE}/">스샷핀 홈</a> ·
    <a href="${BASE}/guide/">가이드</a> ·
    <a href="${BASE}/privacy.html">개인정보처리방침</a> ·
    <a href="https://github.com/wasabia137/sshotpin" rel="noopener">GitHub</a>
  </div>
</footer>`;

/* 빵부스러기는 검색결과에 경로로 표시되고, 글의 소속을 검색엔진에 알려준다. */
function breadcrumbLd(items) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, item: it.url,
    })),
  });
}

function articleLd(a, url) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.description,
    inLanguage: 'ko',
    datePublished: a.date,
    dateModified: a.updated || a.date,
    author: { '@type': 'Organization', name: '스샷핀(Sshot-Pin)', url: BASE + '/' },
    publisher: { '@type': 'Organization', name: '스샷핀(Sshot-Pin)', url: BASE + '/' },
    mainEntityOfPage: url,
    image: BASE + '/og.png',
  });
}

/* 글 아래에 다른 글로 가는 길을 둔다. 내부 링크가 있어야 크롤러가 새 글을 찾는다. */
function relatedBlock(current) {
  const others = index.articles.filter((a) => a.slug !== current).slice(0, 4);
  if (!others.length) return '';
  return `<div class="more">
    <h2>이어서 읽기</h2>
    <ul>${others.map((a) => `
      <li><a href="${BASE}/guide/${a.slug}/">${esc(a.title)}</a><br>
          <span class="d">${esc(a.description)}</span></li>`).join('')}
    </ul>
  </div>`;
}

const cta = `<div class="cta">
  <h3>스샷핀으로 해보기</h3>
  <p>캡처를 화면 맨 위에 고정해두고, 확대하고, 그 위에 바로 그립니다. 윈도우·맥 무료.</p>
  <a class="btn" href="${BASE}/">내려받기</a>
</div>`;

mkdirSync(OUT, { recursive: true });
const written = [];

/* ── 글 페이지 ── */
for (const a of index.articles) {
  const url = `${BASE}/guide/${a.slug}/`;
  const body = readFileSync(join(SRC, `${a.slug}.html`), 'utf8').trim();
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
${head({ title: a.title, description: a.description, keywords: a.keywords, url })}
<script type="application/ld+json">${articleLd(a, url)}</script>
<script type="application/ld+json">${breadcrumbLd([
    { name: '스샷핀', url: BASE + '/' },
    { name: '가이드', url: BASE + '/guide/' },
    { name: a.title, url },
  ])}</script>
</head>
<body>
${topbar}
<div class="wrap">
  <div class="crumb"><a href="${BASE}/">스샷핀</a> › <a href="${BASE}/guide/">가이드</a></div>
  <h1>${esc(a.h1 || a.title)}</h1>
  <p class="lead">${esc(a.lead || a.description)}</p>
  <div class="meta">${a.date} 작성${a.updated && a.updated !== a.date ? ` · ${a.updated} 고침` : ''}</div>
  ${body}
  ${cta}
  ${relatedBlock(a.slug)}
</div>
${footer}
</body>
</html>
`;
  mkdirSync(join(OUT, a.slug), { recursive: true });
  writeFileSync(join(OUT, a.slug, 'index.html'), html);
  written.push(url);
}

/* ── 허브 ── */
const hubUrl = `${BASE}/guide/`;
const hub = `<!DOCTYPE html>
<html lang="ko">
<head>
${head({ title: index.hub.title, description: index.hub.description, keywords: index.hub.keywords, url: hubUrl })}
<script type="application/ld+json">${breadcrumbLd([
  { name: '스샷핀', url: BASE + '/' },
  { name: '가이드', url: hubUrl },
])}</script>
</head>
<body>
${topbar}
<div class="wrap">
  <div class="crumb"><a href="${BASE}/">스샷핀</a></div>
  <h1>${esc(index.hub.h1)}</h1>
  <p class="lead">${esc(index.hub.lead)}</p>
  <div class="meta"></div>
  <div class="more" style="margin-top:0">
    <ul>${index.articles.map((a) => `
      <li><a href="${BASE}/guide/${a.slug}/">${esc(a.title)}</a><br>
          <span class="d">${esc(a.description)}</span></li>`).join('')}
    </ul>
  </div>
  ${cta}
</div>
${footer}
</body>
</html>
`;
writeFileSync(join(OUT, 'index.html'), hub);
written.unshift(hubUrl);

/* ── 사이트맵 ── */
// 기존 항목은 그대로 두고 가이드 주소만 갈아 끼운다. 사이트맵과 실제 페이지가
// 어긋나면 구글이 없는 주소를 물고 늘어지므로 여기서 함께 처리한다.
const smPath = join(root, 'web', 'sitemap.xml');
let sm = readFileSync(smPath, 'utf8');
sm = sm.replace(/\n  <!-- guide -->[\s\S]*?<!-- \/guide -->/g, '');
const today = new Date().toISOString().slice(0, 10);
const block = '\n  <!-- guide -->' + written.map((u) => `
  <url>
    <loc>${u}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('') + '\n  <!-- /guide -->';
sm = sm.replace('</urlset>', block + '\n</urlset>');
writeFileSync(smPath, sm);

/* ── RSS ──
 * 네이버 서치어드바이저는 사이트맵과 별개로 RSS 를 따로 받는다. 새 글이 올라온 것을
 * 알리는 통로라 사이트맵보다 반영이 빠르다. 글 목록이 곧 항목이므로 여기서 함께 만든다.
 * (2026-09-06 가이드 여덟 편이 생기면서 붙였다. 그전에는 담을 글이 없어 만들지 않았다)
 */
const rssDate = (d) => new Date(d + 'T09:00:00+09:00').toUTCString();
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>스샷핀 가이드</title>
    <link>${BASE}/guide/</link>
    <atom:link href="${BASE}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>${esc(index.hub.description)}</description>
    <language>ko</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${index.articles.map((a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${BASE}/guide/${a.slug}/</link>
      <guid isPermaLink="true">${BASE}/guide/${a.slug}/</guid>
      <description>${esc(a.description)}</description>
      <pubDate>${rssDate(a.updated || a.date)}</pubDate>
    </item>`).join('\n')}
  </channel>
</rss>
`;
writeFileSync(join(root, 'web', 'rss.xml'), rss);

console.log(`가이드 ${index.articles.length}편 + 허브 생성 → web/guide/`);
for (const u of written) console.log('   ' + u);
console.log(`\n사이트맵에 ${written.length}개 주소 반영 (총 ${(sm.match(/<loc>/g) || []).length}개)`);
console.log(`RSS ${index.articles.length}편 → web/rss.xml`);
console.log('\n배포한 뒤 `npm run indexnow` 로 알리세요.');
