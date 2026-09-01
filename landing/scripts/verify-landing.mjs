#!/usr/bin/env node
// verify-landing.mjs — politica fail-closed dos binarios da landing.
// Porta do ATLAS (politica-binarios.mjs) para o BTC Radar. Falha fecha o gate.
//
// Uso: node landing/scripts/verify-landing.mjs [saida]
// Sem argumento usa frontend/pages-dist (raiz do Cloudflare Pages).
//
// O que verifica:
//   1. Origem: cada binario declarado existe no disco, esta versionado no git
//      (git ls-files --error-unmatch, valido para arquivo staged), tem extensao
//      liberavel (png/webp), assinatura de magic bytes e tamanho minimo.
//   2. Saida: cada binario declarado chegou ao destino com assinatura, tamanho
//      e corpo nao-HTML. O index.html da raiz referencia so assets declarados.
//   3. Regiao publicada (raiz + assets/, excluindo painel/): nenhum binario
//      fora da allowlist pode existir. Declarado ausente aborta.
//   4. Intocados: painel/index.html e _redirects seguem como estao.
//   5. Texto em UTF-8 sem BOM (index.html, landing.css, auth.js, _headers).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const RAIZ = resolve(import.meta.dirname, '..', '..'); // raiz do repo btc-radar
const SAIDA = resolve(process.argv[2] || join(RAIZ, 'frontend', 'pages-dist'));

/* ── Regra de binarios ─────────────────────────────────────── */
const EXT_BINARIA_BARRADA =
  /\.(pdf|xlsx?|docx?|zip|png|jpe?g|webp|avif|gif|bmp|tiff?|mp4|webm|mov|m4v)$/i;

const ASSINATURA = {
  '.png': {
    contentType: 'image/png',
    minimo: 20_000,
    confere: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  '.webp': {
    contentType: 'image/webp',
    minimo: 4_000,
    confere: (b) =>
      b.length > 12 &&
      String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' &&
      String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP',
  },
};

const extensaoDe = (nome) => {
  const i = String(nome).lastIndexOf('.');
  return i < 0 ? '' : String(nome).slice(i).toLowerCase();
};

// Allowlist nominal. `minimo` sobrescreve o piso por extensao quando o caso
// legitimo foge (favicon e um PNG real de 145 bytes, bem abaixo dos 20 KB de
// uma arte; baixar o piso so dele e intencional, o resto segue a regra).
const BINARIOS = [
  { de: 'landing/assets/bg-desktop.webp', para: 'assets/bg-desktop.webp' },
  { de: 'landing/assets/bg-mobile.webp',  para: 'assets/bg-mobile.webp' },
  { de: 'landing/assets/cover.png',       para: 'assets/cover.png' },
  { de: 'landing/assets/favicon.png',     para: 'assets/favicon.png', minimo: 100 },
];

const TEXTO = [
  'landing/index.html',
  'landing/assets/landing.css',
  'landing/assets/auth.js',
  'landing/scripts/verify-landing.mjs',
  'landing/scripts/smoke-landing.mjs',
];

const falhas = [];
const ok = (msg) => console.log('  ok   ' + msg);
const falha = (msg) => falhas.push(msg) && console.log('  FALHA ' + msg);

/* ── Caminhos ──────────────────────────────────────────────── */
const deParaAbsoluto = (item) => ({
  origem: resolve(RAIZ, item.de),
  saida: resolve(SAIDA, item.para),
});

const versionado = (rel) => {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], {
      cwd: RAIZ, stdio: ['ignore', 'ignore', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
};

/* ── Check de origem ───────────────────────────────────────── */
console.log('Origem (landing/):');
for (const item of BINARIOS) {
  const { origem } = deParaAbsoluto(item);
  const ext = extensaoDe(item.para);
  if (!ASSINATURA[ext]) { falha(`${item.de}: extensao ${ext} fora da politica de liberacao`); continue; }
  if (!existsSync(origem)) { falha(`${item.de}: nao existe no disco`); continue; }
  if (!versionado(item.de)) { falha(`${item.de}: nao versionado no git (rode git add)`); continue; }
  const buf = readFileSync(origem);
  const sig = ASSINATURA[ext];
  if (!sig.confere(buf)) { falha(`${item.de}: magic bytes de ${ext} invalidos`); continue; }
  const minimo = item.minimo ?? sig.minimo;
  if (buf.length < minimo) { falha(`${item.de}: tamanho ${buf.length}B abaixo do piso ${minimo}B`); continue; }
  ok(`${item.de} (${buf.length}B, magic ok)`);
}

/* ── Check de saida ────────────────────────────────────────── */
console.log('Saida (publicada):');
if (!existsSync(join(SAIDA, 'index.html'))) falha('saida/index.html ausente');
const indexHtml = existsSync(join(SAIDA, 'index.html'))
  ? readFileSync(join(SAIDA, 'index.html'), 'utf8')
  : '';

const refs = [...indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
// landing.css e auth.js sao texto (nao binario); os demais /assets/* precisam
// estar na allowlist binaria.
const TEXTO_ASSETS = ['/assets/landing.css', '/assets/auth.js'];
const permitidos = new Set(BINARIOS.map((b) => '/' + b.para));
for (const ref of refs) {
  if (!permitidos.has(ref) && !TEXTO_ASSETS.includes(ref)) {
    falha(`index.html referencia ${ref}, fora da allowlist`);
  }
}

for (const item of BINARIOS) {
  const { saida } = deParaAbsoluto(item);
  const ext = extensaoDe(item.para);
  const sig = ASSINATURA[ext];
  if (!existsSync(saida)) { falha(`saida/${item.para} ausente (declarado mas nao publicado)`); continue; }
  const buf = readFileSync(saida);
  if (!sig.confere(buf)) { falha(`saida/${item.para}: magic bytes invalidos ou corpo HTML`); continue; }
  const minimo = item.minimo ?? sig.minimo;
  if (buf.length < minimo) { falha(`saida/${item.para}: tamanho ${buf.length}B abaixo do piso ${minimo}B`); continue; }
  ok(`saida/${item.para} (${buf.length}B, magic ok, nao-HTML)`);
}

for (const asset of TEXTO_ASSETS) {
  const caminho = resolve(SAIDA, asset.slice(1));
  if (!existsSync(caminho)) { falha(`saida${asset} ausente`); continue; }
  const b = readFileSync(caminho);
  if (b.length === 0) falha(`saida${asset} vazio`);
  else ok(`saida${asset} presente`);
}

/* ── Varredura da regiao publicada (raiz + assets/, sem painel) ── */
console.log('Varredura da regiao publicada:');
function binariosNaArvore(dir, raiz) {
  const achados = [];
  for (const nome of readdirSync(dir)) {
    if (nome === 'painel') continue; // SPA, fora da regiao desta publicacao
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) { achados.push(...binariosNaArvore(p, raiz)); continue; }
    if (EXT_BINARIA_BARRADA.test(nome)) achados.push(resolve(p).slice(raiz.length + 1));
  }
  return achados;
}
const declarados = new Set(BINARIOS.map((b) => b.para.replace(/\\/g, '/')));
for (const rel of binariosNaArvore(SAIDA, SAIDA)) {
  const relNorm = rel.replace(/\\/g, '/');
  if (!declarados.has(relNorm)) falha(`binario nao declarado na regiao publicada: ${relNorm}`);
}
if (existsSync(join(SAIDA, 'painel', 'index.html'))) ok('painel/index.html intocado');
else falha('painel/index.html ausente (SPA quebrada)');
if (existsSync(join(SAIDA, '_redirects'))) {
  const redir = readFileSync(join(SAIDA, '_redirects'), 'utf8');
  if (redir.includes('/painel')) ok('_redirects com mapeamento /painel');
  else falha('_redirects perdeu o mapeamento /painel');
} else falha('_redirects ausente');

/* ── UTF-8 sem BOM nos textos ──────────────────────────────── */
console.log('Encoding:');
for (const rel of TEXTO) {
  const p = resolve(RAIZ, rel);
  if (!existsSync(p)) continue;
  const b = readFileSync(p);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    falha(`${rel}: BOM no inicio`);
  } else ok(`${rel} UTF-8 sem BOM`);
}
for (const nome of ['_headers', '_redirects', 'index.html']) {
  const p = join(SAIDA, nome);
  if (!existsSync(p)) continue;
  const b = readFileSync(p);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    falha(`saida/${nome}: BOM no inicio`);
  }
}

console.log(falhas.length === 0 ? '\nVERIFY: PASS' : `\nVERIFY: FAIL (${falhas.length})`);
process.exit(falhas.length === 0 ? 0 : 1);
