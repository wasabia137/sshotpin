#!/usr/bin/env node
// package.json의 버전·artifactName에서 web/version.json을 만든다.
//
// 웹의 다운로드 버튼은 이 파일이 알려주는 주소를 그대로 쓴다. 파일 이름을
// 페이지에서 조립하지 않기 때문에, 릴리스 파일 이름 규칙이 바뀌어도
// (예: SshotPin- → Sshot-Pin-) 여기만 다시 만들면 9개 언어가 함께 따라온다.
//
// 릴리스 순서: 버전 올리기 → 빌드·업로드 → 이 스크립트 → 웹 배포
// (자산이 깃허브에 올라가기 전에 웹을 배포하면 그동안 링크가 404가 된다)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const { owner, repo } = pkg.build.publish[0];
const base = `https://github.com/${owner}/${repo}/releases/latest/download/`;

// artifactName 템플릿(${version} · ${arch} · ${ext})을 실제 이름으로 채운다
const fill = (tpl, vars) =>
  tpl.replace(/\$\{(\w+)\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`artifactName에 모르는 변수 \${${k}} — ${tpl}`);
    return vars[k];
  });

const winName = fill(pkg.build.artifactName, { version, ext: 'exe' });
const macName = (arch) => fill(pkg.build.mac.artifactName, { version, arch, ext: 'dmg' });

const out = {
  version,
  releaseDate: new Date().toISOString().slice(0, 10),
  win: base + winName,
  macArm: base + macName('arm64'),
  macX64: base + macName('x64'),
};

writeFileSync(join(root, 'web', 'version.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`web/version.json 갱신 — v${version}`);
for (const k of ['win', 'macArm', 'macX64']) console.log(`  ${k}: ${out[k].slice(base.length)}`);

// HTML에 박혀 있는 값도 같이 맞춘다.
// 다운로드 링크는 version.json을 못 읽었을 때 쓰는 예비값이고, JSON-LD의
// softwareVersion·downloadUrl은 검색엔진이 읽는다. 손으로 고치면 9개 언어 중
// 하나는 반드시 빠지므로 여기서 함께 처리한다.
const LANGS = ['', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ru'];
let touched = 0;
for (const lang of LANGS) {
  const file = join(root, 'web', lang, 'index.html');
  const before = readFileSync(file, 'utf8');
  let after = before
    .replace(/"softwareVersion": "[^"]*"/, `"softwareVersion": "${version}"`)
    .replace(/"downloadUrl": "[^"]*"/, `"downloadUrl": "${out.win}"`)
    .replace(/(id="dlBtn" href=")[^"]*/, `$1${out.win}`)
    .replace(/(id="dlMacArm" href=")[^"]*/, `$1${out.macArm}`)
    .replace(/(id="dlMacX64" href=")[^"]*/, `$1${out.macX64}`)
    .replace(/(<span id="ver">)[^<]*/, `$1v${version}`);
  if (after !== before) { writeFileSync(file, after); touched++; }
}
console.log(`\n웹 페이지 ${touched}/${LANGS.length}개의 예비 링크·버전 표기 갱신`);

// 고쳐야 할 곳이 남아 있으면 알린다 (조용히 지나가면 그 언어만 옛 버전이 된다)
for (const lang of LANGS) {
  const file = join(root, 'web', lang, 'index.html');
  const stale = readFileSync(file, 'utf8').match(/\d+\.\d+\.\d+/g) || [];
  const other = [...new Set(stale)].filter((v) => v !== version);
  if (other.length) console.log(`  ! /${lang || ''} 에 다른 버전 문자열: ${other.join(', ')}`);
}

console.log('\n이 이름의 자산이 깃허브 릴리스에 올라가 있는지 확인한 뒤 웹을 배포하세요.');
