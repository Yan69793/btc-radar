# Deploy do Pages do BTC Radar (raiz = landing, /painel = SPA do painel).
#
# O pages-dist e montado a mao: frontend/dist (build do Vite) entra em
# painel/, e a landing estatica (index.html + assets da raiz) fica por fora do
# build e nao pode ser sobrescrita por ele.
#
# Nao use `wrangler pages deploy dist`: isso publica o build cru na raiz e
# derruba a landing, alem de perder _headers, _redirects e painel/shell.
#
# O _headers e o _redirects NAO sao mantidos a mao dentro de pages-dist (que e
# gitignored): eles vem de frontend/public/, copiados pelo Vite para dist/ no
# build. Este script instala dist/_headers e dist/_redirects em pages-dist/ em
# toda execucao, para o CSP do /painel/ (liberacao do TradingView) e as rotas
# explicitas do SPA sobreviverem a regeneracao da arvore.
#
# -SkipDeploy: faz build + sincronizacao de pages-dist sem publicar. Use para
# validar o artefato gerado (smoke/preview local) sem tocar a producao.
#
# ASCII only: script chamado por humano, mas o pre-commit reprova non-ASCII sem
# BOM, e nao vale a pena depender de BOM aqui.
param(
    [switch]$SkipDeploy
)

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

Write-Host "== sincronizando _headers e _redirects ==" -ForegroundColor Cyan
# Fontes da verdade rastreadas: frontend/public/_headers e frontend/public/_redirects,
# que o Vite copia para dist/ no build. Sem estas copias, pages-dist volta a ter
# arquivos nao versionados e o CSP do /painel/ (TradingView) e as rotas explicitas
# do SPA se perdem na proxima regeneracao.
foreach ($nome in @('_headers', '_redirects')) {
    $src = Join-Path $dist $nome
    if (-not (Test-Path $src)) {
        Pop-Location
        Write-Host "dist/$nome ausente: falta frontend/public/$nome no fonte." -ForegroundColor Red
        exit 1
    }
    Copy-Item $src (Join-Path $pd $nome) -Force
}

if ($SkipDeploy) {
    Pop-Location
    Write-Host "== -SkipDeploy: pages-dist sincronizado, nada publicado ==" -ForegroundColor Yellow
    exit 0
}

Write-Host "== publicando ==" -ForegroundColor Cyan
npx wrangler pages deploy $pd --project-name btc-radar --branch main
$code = $LASTEXITCODE
Pop-Location

if ($code -ne 0) { Write-Host "deploy falhou ($code)" -ForegroundColor Red; exit $code }

Write-Host "== conferindo ==" -ForegroundColor Cyan
foreach ($u in '/', '/painel/', '/painel/signals', '/painel/trades', '/painel/assets/film-pulso.png') {
    $r = curl.exe -s -o NUL -w "%{http_code} %{content_type}" "https://btc-radar.pages.dev$u"
    Write-Host ("{0,-38} {1}" -f $u, $r)
}
