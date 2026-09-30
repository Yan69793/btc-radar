#!/usr/bin/env node
// smoke-landing.mjs — smoke local da landing publicada.
// Sobe um http server de mentira que replica o comportamento do Cloudflare
// Pages para esta arvore (assets reais primeiro, _redirects para as rotas do
// painel, _headers aplicados por caminho) e valida de ponta a ponta:
//   1. Cada asset publicado: HTTP 200 + Content-Type do formato + magic bytes
//      + tamanho minimo + corpo nao-HTML.
//   2. Raiz: HTML com a CSP restritiva (default-src 'none', connect-src com a
//      origem da API).
//   3. /painel/*: CSP propria (nao herda a da raiz) liberando exatamente o
//      TradingView exigido pelo widget, com o baseline restritivo intacto.
//   4. Rotas do SPA: _redirects presente, as 8 rotas explicitas para
//      /painel/shell com status 200, sem catch-all /painel/* (que engole os
//      assets e quebra o clean URL do Pages) e sem alvo .html, alem do corpo
//      servido ser o do painel (nunca a landing).
//   5. Rota de imagem inexistente: nunca 200 com HTML no lugar.
//
// Uso: node landing/scripts/smoke-landing.mjs [saida]

import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..', '..');
const SAIDA = resolve(process.argv[2] || join(RAIZ, 'frontend', 'pages-dist'));

const CONTENT_TYPE = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

const falhas = [];
const ok = (msg) => console.log('  ok   ' + msg);
const falha = (msg) => falhas.push(msg) && console.log('  FALHA ' + msg);

/* ── _headers: secoes "path" + linhas "Header: value" ─────── */
function parseHeaders() {
  const arq = join(SAIDA, '_headers');
  if (!existsSync(arq)) return [];
  const secoes = [];
  let atual = null;
  for (const linha of readFileSync(arq, 'utf8').split(/\r?\n/)) {
    if (!linha.trim()) { atual = null; continue; }
    if (/^\s/.test(linha)) {
      if (!atual) continue;
      const i = linha.indexOf(':');
      if (i > 0) atual.headers[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
    } else {
      atual = { path: linha.trim(), headers: {} };
      secoes.push(atual);
    }
  }
  return secoes;
}
const SECOES = parseHeaders();
const headersPara = (path) => {
  let out = {};
  for (const s of SECOES) {
    const match = s.path.endsWith('/*')
      ? path.startsWith(s.path.slice(0, -1))
      : path === s.path;
    if (match) out = { ...out, ...s.headers };
  }
  return out;
};

/* ── _redirects: linhas "de para status" (comentarios com #) ── */
function parseRedirects() {
  const arq = join(SAIDA, '_redirects');
  if (!existsSync(arq)) return [];
  const regras = [];
  for (const linha of readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const [de, para, status] = limpa.split(/\s+/);
    regras.push({ de, para, status: Number(status) || 302 });
  }
  return regras;
}
const REGRAS = parseRedirects();
const ROTAS_SPA = [
  '/painel/signals', '/painel/briefing', '/painel/backtest', '/painel/alerts',
  '/painel/onchain', '/painel/portfolio', '/painel/trades', '/painel/settings',
];

/* ── Servidor replica o Pages (asset real primeiro, redirects depois) ── */
const arquivoDe = (pathname) => {
  const rel = pathname.replace(/^\/+/, '');
  const p = resolve(SAIDA, rel);
  if (!p.startsWith(SAIDA)) return null;
  if (existsSync(p) && statSync(p).isFile()) return p;
  // Diretorio com index (raiz e subpastas): serve o index como o Pages faz.
  if (existsSync(p) && statSync(p).isDirectory()) {
    const idx = join(p, 'index.html');
    return existsSync(idx) ? idx : null;
  }
  // Rewrite do _redirects (status 200) para as rotas do SPA: o asset real ja foi
  // tentado acima, na mesma ordem do Pages. Sem catch-all, rota fora da lista
  // nao resolve -- e isso e proposital.
  const regra = REGRAS.find((r) =>
    r.status === 200 &&
    (r.de.endsWith('/*') ? pathname.startsWith(r.de.slice(0, -1)) : pathname === r.de));
  if (regra) {
    const alvo = resolve(SAIDA, regra.para.replace(/^\/+/, ''));
    if (alvo.startsWith(SAIDA) && existsSync(alvo) && statSync(alvo).isFile()) return alvo;
  }
  return null;
};

const server = createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const arq = arquivoDe(pathname);
  const headers = headersPara(pathname);
  if (!arq) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const buf = readFileSync(arq);
  const ext = arq.slice(arq.lastIndexOf('.')).toLowerCase();
  const type = CONTENT_TYPE[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, ...headers });
  res.end(buf);
});

/* ── Assinaturas e pisos (mesma politica do verify) ───────── */
const ASSINATURA = {
  '.png': {
    contentType: 'image/png', minimo: 20_000,
    confere: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  '.webp': {
    contentType: 'image/webp', minimo: 4_000,
    confere: (b) =>
      b.length > 12 &&
      String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' &&
      String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP',
  },
};
const BINARIOS = [
  { para: 'assets/bg-desktop.webp' },
  { para: 'assets/bg-mobile.webp' },
  { para: 'assets/cover.png' },
  { para: 'assets/favicon.png', minimo: 100 },
];

const ehHtml = (buf) => {
  const s = buf.slice(0, 256).toString('latin1').trimStart().toLowerCase();
  return s.startsWith('<!doctype html') || s.startsWith('<html');
};

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    /* 1. Assets publicados */
    console.log('Assets publicados:');
    for (const item of BINARIOS) {
      const res = await fetch(`${base}/${item.para}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = '.' + item.para.split('.').pop();
      const sig = ASSINATURA[ext];
      if (res.status !== 200) { falha(`${item.para}: status ${res.status}`); continue; }
      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith(sig.contentType)) falha(`${item.para}: Content-Type ${ct} != ${sig.contentType}`);
      if (!sig.confere(buf)) falha(`${item.para}: magic bytes invalidos ou corpo HTML`);
      const minimo = item.minimo ?? sig.minimo;
      if (buf.length < minimo) falha(`${item.para}: ${buf.length}B abaixo do piso ${minimo}B`);
      if (ehHtml(buf)) falha(`${item.para}: corpo parece HTML`);
      else ok(`${item.para} -> ${res.status}, ${ct}, ${buf.length}B, nao-HTML`);
    }
    for (const asset of ['assets/landing.css', 'assets/auth.js']) {
      const res = await fetch(`${base}/${asset}`);
      if (res.status !== 200) { falha(`${asset}: status ${res.status}`); continue; }
      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith(asset.endsWith('.css') ? 'text/css' : 'text/javascript')) {
        falha(`${asset}: Content-Type ${ct} inesperado`);
      }
      ok(`${asset} -> ${res.status}, ${ct}`);
    }

    /* 2. Raiz com CSP restritiva */
    console.log('Raiz e /painel:');
    const raiz = await fetch(`${base}/`);
    const raizCsp = raiz.headers.get('content-security-policy') || '';
    if (raiz.status !== 200) falha('raiz: status nao-200');
    if (!raizCsp.includes("default-src 'none'")) falha('raiz: CSP sem default-src none');
    if (!raizCsp.includes("connect-src 'self' https://btc-radar.prospects-intel.workers.dev")) {
      falha('raiz: CSP sem a origem da API no connect-src');
    }
    if (!raizCsp.includes("script-src 'self'")) falha('raiz: CSP sem script-src self');
    if (raiz.headers.get('x-content-type-options') !== 'nosniff') falha('raiz: sem X-Content-Type-Options');
    if (raiz.headers.get('x-frame-options') !== 'DENY') falha('raiz: sem X-Frame-Options');
    if (raiz.headers.get('referrer-policy') !== 'no-referrer') falha('raiz: sem Referrer-Policy');
    const robots = raiz.headers.get('x-robots-tag') || '';
    if (/noindex|nofollow/i.test(robots)) falha(`raiz: X-Robots-Tag bloqueia indexacao (${robots})`);
    ok(`raiz CSP restritiva + headers de seguranca (${raiz.headers.get('content-type')})`);

    /* /painel/ tem CSP propria (nao herda a da raiz) e ela precisa liberar o
       TradingView exigido pelo widget Advanced Chart -- nem mais, nem menos.
       Guarda de regressao do CSP que vive em frontend/public/_headers. */
    const painel = await fetch(`${base}/painel/`);
    const painelCsp = painel.headers.get('content-security-policy') || '';
    if (painel.status !== 200) falha('/painel/: status nao-200');
    if (!painelCsp) falha('/painel/: sem Content-Security-Policy propria');
    if (!painelCsp.includes("default-src 'none'")) falha("/painel/: CSP sem default-src 'none'");
    if (!painelCsp.includes("script-src 'self' https://s3.tradingview.com")) {
      falha('/painel/: CSP nao libera o script do TradingView (s3.tradingview.com)');
    }
    if (!painelCsp.includes('frame-src https://www.tradingview-widget.com https://s.tradingview.com')) {
      falha('/painel/: CSP nao libera os frames do widget do TradingView');
    }
    if (/tradingview/.test(/connect-src ([^;]*)/.exec(painelCsp)?.[1] || '')) {
      falha('/painel/: connect-src com host de TradingView (o embed nao faz XHR)');
    }
    if (painelCsp.includes("'unsafe-eval'")) falha("/painel/: CSP com 'unsafe-eval'");
    if (/\*/.test(painelCsp)) falha('/painel/: CSP com curinga de host');
    else if (painelCsp) ok('/painel/: CSP propria com o TradingView minimo e baseline restritivo');

    /* 4. Rotas do SPA: _redirects rastreado, 8 rotas explicitas para
       /painel/shell, sem catch-all amplo e sem alvo .html. Guarda de regressao
       do _redirects que vive em frontend/public/_redirects. */
    console.log('Rotas do SPA (_redirects):');
    if (!existsSync(join(SAIDA, '_redirects'))) falha('_redirects ausente na arvore publicada');
    // Catch-all amplo (ex: /painel/*) engole /painel/assets/* e quebra o painel.
    const amplas = REGRAS.filter((r) => r.de.endsWith('/*') && ROTAS_SPA[0].startsWith(r.de.slice(0, -1)));
    if (amplas.length) falha(`_redirects com catch-all amplo: ${amplas.map((r) => r.de).join(', ')}`);
    for (const rota of ROTAS_SPA) {
      const antes = falhas.length;
      const regra = REGRAS.find((r) => r.de === rota);
      if (!regra) falha(`_redirects: ${rota} sem regra`);
      else {
        if (regra.para !== '/painel/shell') falha(`_redirects: ${rota} -> ${regra.para} (esperado /painel/shell)`);
        if (regra.status !== 200) falha(`_redirects: ${rota} status ${regra.status} (esperado 200)`);
        if (regra.para.endsWith('.html')) falha(`_redirects: ${rota} -> alvo .html (Pages responde 308 e nao entrega corpo)`);
      }
      const res = await fetch(`${base}${rota}`);
      const ct = res.headers.get('content-type') || '';
      const corpo = await res.text();
      if (res.status !== 200) falha(`${rota}: status ${res.status}`);
      if (!ct.startsWith('text/html')) falha(`${rota}: Content-Type ${ct}`);
      if (corpo.includes('landing.css')) falha(`${rota}: serviu a landing no lugar do painel`);
      if (!corpo.includes('/painel/assets/')) falha(`${rota}: corpo sem asset do painel`);
      if (falhas.length === antes) ok(`${rota} -> ${res.status}, ${ct}, SPA do painel`);
    }
    // Asset do painel nao pode ser engolido pelas regras do _redirects.
    const dirAssets = join(SAIDA, 'painel', 'assets');
    const js = existsSync(dirAssets) ? readdirSync(dirAssets).find((f) => f.endsWith('.js')) : null;
    if (!js) falha('painel/assets: nenhum .js publicado');
    else {
      const res = await fetch(`${base}/painel/assets/${js}`);
      const ct = res.headers.get('content-type') || '';
      const corpo = await res.text();
      if (res.status !== 200 || !ct.startsWith('text/javascript')) {
        falha(`/painel/assets/${js}: ${res.status}, ${ct}`);
      } else if (corpo.trimStart().toLowerCase().startsWith('<')) {
        falha(`/painel/assets/${js}: corpo HTML no lugar do JS`);
      } else ok(`/painel/assets/${js} -> ${res.status}, ${ct}, nao-HTML`);
    }

    /* 5. Cache-Control nos assets */
    const assetRes = await fetch(`${base}/assets/bg-desktop.webp`);
    const cc = assetRes.headers.get('cache-control') || '';
    if (!cc.includes('max-age=86400')) falha('assets: Cache-Control sem max-age=86400');
    else ok('assets: Cache-Control public, max-age=86400');

    /* 6. Rota de imagem inexistente nunca devolve HTML 200 */
    console.log('Rota inexistente:');
    const fake = await fetch(`${base}/assets/nao-existe.webp`);
    if (fake.status === 200) falha('imagem inexistente respondeu 200 (fallback HTML?!)');
    else {
      const buf = Buffer.from(await fake.arrayBuffer());
      if (ehHtml(buf)) falha('imagem inexistente devolveu HTML');
      else ok(`imagem inexistente -> ${fake.status}, nao-HTML`);
    }
  } finally {
    server.close();
    console.log(falhas.length === 0 ? '\nSMOKE: PASS' : `\nSMOKE: FAIL (${falhas.length})`);
    process.exit(falhas.length === 0 ? 0 : 1);
  }
});
