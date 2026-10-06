# BTC Radar — contexto do projeto

Dashboard Bitcoin (painel + API). Produção: Pages `https://btc-radar.pages.dev/painel/` + Worker `https://btc-radar.prospects-intel.workers.dev`. Repo: `E:\Diretorio\Claude\ARQUIVO\Btc-radar\btc-radar`, remote `github.com/Yan69793/btc-radar` (público).

## Estrutura
- `frontend/` — React 19 + Vite, `base: '/painel/'`, rotas lazy. Build padrão sai em `dist/`; o deploy atual usa `frontend/pages-dist/` (landing na raiz + painel em `/painel/`, gerada manualmente, não pelo build).
- `worker/` — API Hono no Cloudflare Workers (`src/index.ts`), D1 `btc-radar` + KV, cron `0 */1 * * *` (`src/cron.ts`). Versão única em `src/version.ts` (`SERVICE_VERSION`, reportada no `/api/health`).
- Auth: PBKDF2 + sessão em KV; escrita exige admin (`ADMIN_EMAILS` no `wrangler.toml`, nunca no banco). Ver `src/lib/write-guard.ts`.
- Nunca editar `frontend/pages-dist/painel/assets/*` (bundle gerado). `npm run build` + deploy de `dist` sobrescreve a raiz e desfaz o formato raiz=landing.

## Comandos
- Testes worker: `cd worker && npm test` (vitest, 38 testes).
- Typecheck worker: `cd worker && npx tsc --noEmit`.
- Deploy worker: `cd worker && npx wrangler deploy` (triggers de cron vão junto).
- Deploy Pages: `pwsh ./frontend/scripts/deploy-pages.ps1` (faz build, sincroniza `pages-dist` e publica). Nunca `wrangler pages deploy dist`: isso joga o build cru na raiz e derruba a landing.
- D1 remoto via token local falha (7403, sem escopo). Leitura remota: `/api/health` (freshness) ou OAuth do wrangler.

## Pitfalls do Pages (custaram caro, não repetir)
- O painel roda em `/painel/` (base do Vite). Asset em `public/assets` vai para `/painel/assets/`, então caminho absoluto `/assets/...` no código do painel devolve o fallback do Pages com status 200 e **HTML no lugar da imagem** (ícone quebrado no browser). Use `asset()` de `src/lib/assets.ts`, que prefixa `BASE_URL`.
- O alvo do rewrite em `_redirects` não pode terminar em `.html`: o Pages responde 308 nesse caminho, o rewrite não entrega corpo e o pedido cai no fallback da raiz. Por isso o SPA é servido por `/painel/shell` (sem extensão) com o MIME declarado no `_headers`.
- `_redirects` vence asset estático. Catch-all `/painel/*` engole `/painel/assets/*` e quebra o painel inteiro. As rotas do SPA são listadas uma a uma.
- `_headers` casa com o caminho **pedido**, não com o arquivo servido. Sem `Content-Type` declarado nas rotas, o browser baixa o HTML em vez de renderizar.
- Toda rota nova do painel precisa de entrada nos dois arquivos: `_redirects` (rewrite) e `_headers` (MIME).

## Pendências abertas
Estado vivo em `diagnosticos/DIAGNOSTICO-2026-09-12.md` (seção 7 + 9). Posição em 12/09/2026 (sessão de resolução):
- Resolvido no código, **aguardando deploy**: P3-002 (500 genérico no register/login), P2-001 diagnóstico (health expõe `last_cron_error_detail`), P3-001 (HSTS + CSP do `/painel/*` em `frontend/pages-dist/_headers`, arquivo gitignored, sai do disco no deploy).
- Aceito como limitação documentada: P3-003 (on-chain parcial, ver comentário em `src/lib/mempool.ts`).
- Precisam do Yan: `WHATSAPP_APP_SECRET` (valor), decisão secrets `CRYPTOPANIC/OPENROUTER`, confirmação migrations 0002/0003 (D1 7403 no token local), aprovação de deploy (worker + Pages) e commit destas mudanças.
