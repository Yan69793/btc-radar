# Deploy do Pages do BTC Radar (raiz = landing, /painel = SPA do painel).
#
# O pages-dist e montado a mao: frontend/dist (build do Vite) entra em
# painel/, e a landing estatica (index.html + assets da raiz) fica por fora do
# build e nao pode ser sobrescrita por ele.
#
# Nao use `wrangler pages deploy dist`: isso publica o build cru na raiz e
# derruba a landing, alem de perder _headers, _redirects e painel/shell.
#
# ASCII only: script chamado por humano, mas o pre-commit reprova non-ASCII sem
# BOM, e nao vale a pena depender de BOM aqui.
$ErrorActionPreference = 'Continue'
$front = Split-Path -Parent $PSScriptRoot
$pd    = Join-Path $front 'pages-dist'

Write-Host "== build do painel ==" -ForegroundColor Cyan
Push-Location $front
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "build falhou" -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $pd 'index.html'))) {
    Pop-Location
    Write-Host "pages-dist/index.html (landing) ausente. Nao montar do zero aqui." -ForegroundColor Red
    exit 1
}

Write-Host "== sincronizando painel ==" -ForegroundColor Cyan
$dist = Join-Path $front 'dist'
$pp   = Join-Path $pd 'painel'

Copy-Item (Join-Path $dist 'index.html')  (Join-Path $pp 'index.html') -Force
# shell sem extensao: o _redirects nao pode apontar para .html, porque o Pages
# responde 308 nesse caminho e o rewrite nunca entrega corpo.
Copy-Item (Join-Path $dist 'index.html')  (Join-Path $pp 'shell')     -Force
Copy-Item (Join-Path $dist 'favicon.svg') (Join-Path $pp 'favicon.svg') -Force

$ppAssets = Join-Path $pp 'assets'
if (Test-Path $ppAssets) { Remove-Item $ppAssets -Recurse -Force }
Copy-Item (Join-Path $dist 'assets') $ppAssets -Recurse -Force

Write-Host "== publicando ==" -ForegroundColor Cyan
npx wrangler pages deploy $pd --project-name btc-radar
$code = $LASTEXITCODE
Pop-Location

if ($code -ne 0) { Write-Host "deploy falhou ($code)" -ForegroundColor Red; exit $code }

Write-Host "== conferindo ==" -ForegroundColor Cyan
foreach ($u in '/', '/painel/', '/painel/signals', '/painel/trades', '/painel/assets/film-pulso.png') {
    $r = curl.exe -s -o NUL -w "%{http_code} %{content_type}" "https://btc-radar.pages.dev$u"
    Write-Host ("{0,-38} {1}" -f $u, $r)
}
