import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const front = fileURLToPath(new URL('../', import.meta.url))
const dist = path.join(front, 'dist')
const shell = await readFile(path.join(dist, 'index.html'), 'utf8')
const redirects = await readFile(path.join(dist, '_redirects'), 'utf8')
const headers = await readFile(path.join(dist, '_headers'), 'utf8')
const router = await readFile(path.join(front, 'src/App.tsx'), 'utf8')
assert.match(router, /basename=["']\/painel["']/)
assert.match(router, /path=["']\/?track-record["']/)
assert.match(shell, /id="root"/)
const entryPath = shell.match(/src="(\/painel\/assets\/[^" ]+\.js)"/)?.[1]
assert.ok(entryPath, 'Shell deve carregar entrypoint /painel/assets')
const entry = await readFile(path.join(dist, entryPath.replace('/painel/', '')), 'utf8')
assert.match(entry, /track-record/)
const trackFiles = (await readdir(path.join(dist, 'assets'))).filter(f => /^TrackRecord-.*\.js$/.test(f))
assert.equal(trackFiles.length, 1, 'Build deve produzir chunk TrackRecord único')
const trackChunk = await readFile(path.join(dist, 'assets', trackFiles[0]), 'utf8')
assert.match(trackChunk, /\/api\/aureus-track-record/)
assert.match(trackChunk, /Carteira simulada/)
assert.match(trackChunk, /Fees acumuladas/)
// F13: disclosure financeiro integral — simulado, NAV inicial, long-only, execução
// modelada, fees × slippage distinguidos, sem implicar patrimônio/ordens reais.
assert.match(trackChunk, /NAV inicial/)
assert.match(trackChunk, /long-only/)
assert.match(trackChunk, /slippage/)
assert.match(trackChunk, /conta real/)
assert.match(trackChunk, /simulad/)
for (const url of ['/painel/track-record', '/painel/track-record/']) {
  const rules = redirects.split(/\r?\n/).map(l => l.trim().split(/\s+/))
  assert.ok(rules.some(r => r[0] === url && r[1] === '/painel/shell' && r[2] === '200'), `Rewrite ausente ${url}`)
  assert.ok(headers.includes(`${url}\n  Content-Type: text/html`) || headers.includes(`${url}\r\n  Content-Type: text/html`), `MIME ausente ${url}`)
}
// Emula somente o rewrite documentado do Pages, sem gravar a árvore publicada.
const landing = '<!doctype html><html><body>LANDING_SENTINEL</body></html>'
const server = createServer(async (req, res) => {
  try {
    const requested = new URL(req.url, 'http://localhost').pathname
    const rule = redirects.split(/\r?\n/).map(l => l.trim().split(/\s+/)).find(r => r[0] === requested)
    if (requested === '/') {res.setHeader('Content-Type','text/html');res.end(landing);return}
    if (requested === '/painel/' || rule?.[1] === '/painel/shell') {res.setHeader('Content-Type','text/html');res.end(shell);return}
    if (requested.startsWith('/painel/assets/')) {res.setHeader('Content-Type', 'text/javascript');res.end(await readFile(path.join(dist, requested.replace('/painel/', ''))));return}
    res.statusCode=404;res.end('Ausente')
  } catch {res.statusCode=500;res.end('Erro')}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  const base = `http://127.0.0.1:${server.address().port}`
  for (const url of ['/painel/', '/painel/track-record', '/painel/track-record/']) {
    const response = await fetch(base + url)
    assert.equal(response.status,200)
    const body = await response.text()
    assert.equal(body,shell,`Rota ${url} deve servir o shell React`)
    assert.ok(!body.includes('LANDING_SENTINEL'), 'Rota não pode servir landing')
  }
  assert.equal(await (await fetch(base + '/')).text(),landing)
  assert.equal(await (await fetch(base + entryPath)).text(),entry)
  console.log('PASS local dist smoke: shell React, direct route/refresh rewrite, MIME, router, TrackRecord chunk, API e disclosure. Landing preservada em memória. Sem deploy ou sincronização pages-dist.')
} finally {await new Promise(resolve => server.close(resolve))}