/**
 * IndexNow — 검색엔진에 「이 주소들이 바뀌었다」고 알린다.
 *
 *   npm run indexnow          사이트맵의 주소 전부
 *   npm run indexnow -- --dry 보내지 않고 목록만 본다
 *
 * ── 왜 이게 있나 ──
 * 네이버 서치어드바이저의 「웹페이지 수집 요청」은 사람이 손으로 넣는다.
 * IndexNow 는 네이버가 공식으로 여는 문이라 로그인 없이 한 번에 넣을 수 있다.
 * 새 버전을 배포해 페이지 내용(버전·다운로드 링크)이 바뀔 때마다 부르면 된다.
 *
 * ── 구글은 이 길이 없다 ──
 * 구글 Indexing API 는 채용공고(JobPosting)와 생중계(BroadcastEvent) 전용이다.
 * 다른 쪽을 넣는 것은 약관 위반이고 넣어도 그 신호를 버린다. 구글 쪽은
 * 사이트맵·내부 링크·시간, 그리고 서치콘솔에서 사람이 넣는 수밖에 없다.
 *
 * ── 키 ──
 * `web/<32자hex>.txt` 안에 같은 값이 들어 있고 배포되면
 * `https://sshot-pin.web.app/<키>.txt` 로 열린다. 검색엔진은 이 파일을 받아 보고
 * 「이 주소를 넣는 사람이 이 사이트 주인이 맞다」를 확인한다.
 * **키 파일이 먼저 배포돼 있어야 한다.** 아니면 통째로 거절당한다 —
 * 그래서 보내기 전에 키 파일부터 열어 보고, 안 열리면 멈춘다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'sshot-pin.web.app';
const BASE = `https://${HOST}`;

/*
 * 주소를 조심할 것 — 안내 글들이 흔히 적는 `api.searchadvisor.naver.com` 은
 * **없는 호스트**다(DNS 가 안 풀린다). `searchadvisor.naver.com/indexnow` 가 맞다.
 *
 * dropRoot: 네이버는 사이트 루트를 「Invalid urls」(422)로 거절하고, 한 개가 걸리면
 * 묶음이 통째로 422 가 된다. 루트는 어차피 이미 색인돼 있으므로 네이버에는 뺀다.
 * 공용 문은 루트를 받으므로 그대로 보낸다.
 */
const ENDPOINTS = [
  { name: '네이버', url: 'https://searchadvisor.naver.com/indexnow', dropRoot: true },
  { name: '공용(빙·야놉 등)', url: 'https://api.indexnow.org/indexnow', dropRoot: false },
];

const dry = process.argv.includes('--dry');

// 키 파일은 web/ 에 있는 「32자 hex + .txt」 하나뿐이다. 이름이 곧 키다.
const keyFile = readdirSync(join(root, 'web')).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) {
  console.error('web/ 에 IndexNow 키 파일이 없습니다.');
  console.error('32자리 hex 이름의 .txt 를 만들고 안에 같은 값을 넣으세요.');
  process.exit(1);
}
const key = keyFile.replace(/\.txt$/, '');
const keyLocation = `${BASE}/${keyFile}`;

// 보낼 주소는 사이트맵에서 읽는다. 목록을 따로 만들면 사이트맵과 어긋난다.
const sitemap = readFileSync(join(root, 'web', 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (!urls.length) {
  console.error('사이트맵에서 주소를 찾지 못했습니다.');
  process.exit(1);
}

const isRoot = (u) => u === `${BASE}/` || u === BASE;

console.log(`\n호스트   ${HOST}`);
console.log(`키       ${key}`);
console.log(`키 파일  ${keyLocation}`);
console.log(`보낼 것  ${urls.length}개`);

if (dry) {
  console.log('\n--dry 라 보내지 않았습니다. 목록:');
  for (const u of urls) console.log('   ' + u);
  process.exit(0);
}

// 키 파일이 실제로 열리는지 먼저 본다. 안 열리면 전부 거절이라 보낼 값어치가 없다.
const probe = await fetch(keyLocation).catch(() => null);
const probeText = probe?.ok ? (await probe.text()).trim() : null;
if (probeText !== key) {
  console.error(`\n키 파일이 아직 안 열립니다 (${probe ? probe.status : '연결 실패'}).`);
  console.error('배포부터 하세요 — 키 파일이 살아 있어야 검색엔진이 요청을 받습니다.');
  process.exit(1);
}
console.log(`키 확인  ✅ 키값을 그대로 돌려줍니다`);

async function submit(endpoint, urlList) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key, keyLocation, urlList }),
  }).catch((e) => ({ ok: false, status: 0, statusText: e.message, text: async () => '' }));
  const body = (await res.text().catch(() => '')).slice(0, 200);
  return { ok: res.ok, status: res.status, statusText: res.statusText || '', body };
}

let failed = 0;
for (const { name, url, dropRoot } of ENDPOINTS) {
  const list = dropRoot ? urls.filter((u) => !isRoot(u)) : urls;
  const dropped = urls.length - list.length;
  console.log(`\n── ${name}  ${list.length}개${dropped ? ' (루트는 거절당해서 뺐어요)' : ''}`);

  let r = await submit(url, list);
  /*
   * 공용 문은 키 파일을 막 올린 직후에 `SiteVerificationNotCompleted` 403 을 낸다.
   * 실패로 단정하지 말 것 — 잠시 뒤 다시 보내면 받아 준다.
   */
  if (r.status === 403) {
    console.log(`   ⏳ 403 (키 확인이 아직) — 20초 뒤 다시 보냅니다`);
    await new Promise((ok) => setTimeout(ok, 20000));
    r = await submit(url, list);
  }
  if (!r.ok) failed++;
  console.log(`   ${r.ok ? '✅' : '❌'} HTTP ${r.status} ${r.statusText}${r.body ? ' · ' + r.body : ''}`.trimEnd());
}

/*
 * 200·202 는 받았다는 뜻이지 색인했다는 뜻이 아니다. 실제로 들어갔는지는
 * 며칠 뒤 site: 질의나 서치어드바이저 수집 현황으로 세는 수밖에 없다.
 */
console.log('\n받았다는 응답이지 색인됐다는 뜻은 아닙니다. 며칠 뒤 확인하세요.\n');
process.exit(failed ? 1 : 0);
