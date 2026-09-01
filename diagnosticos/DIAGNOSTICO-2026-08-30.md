# DIAGNÓSTICO — BTC Radar

**Data:** 2026-08-30 12:35 BRT
**Alvo:** https://btc-radar.pages.dev (frontend Pages) + https://btc-radar.prospects-intel.workers.dev (API Worker)
**Método:** auditoria generalista (blocos A–F) + análise de otimização por subagente + pesquisa web
**Raw:** diagnosticos/audit-raw-20260830_123020.json (UI) e diagnosticos/audit-raw-2026-08-30.json (HTTP/API)

## 1. Descoberta e drift

- Projeto em `ARQUIVO\Btc-radar\btc-radar` (worker + frontend + results + scripts vazio). Nada versionado no git do monorepo (`git ls-files` vazio no caminho). Sem CLAUDE.md, memory/, PENDENCIAS.md ou vault no projeto. Última atividade em disco: 26/07/2026.
- Worker local `package.json` version 0.1.0. `/api/health` em produção reporta `version: "0.5.0"` hardcoded em `index.ts:38`. Divergência de nomenclatura, P3.
- Últimos deploys do Worker: 26/07/2026 02:10–02:19 UTC (3 deploys, 100% na última versão). Nenhum deploy há 35 dias.
- Frontend Pages: `og:updated_time` 2026-07-26T00:00:00Z, index.html 2.308 bytes, CSS 32 KB, bundle JS único 351,7 KB, og-image 91 KB.

## 2. HTTP / APIs

Smoke de 11 endpoints em produção (2026-08-30 15:22–15:34 UTC):

| Endpoint | Resultado | Latência |
|----------|-----------|----------|
| /api/health | 200 ok | rápido |
| /api/price/latest | **502 agora** | 715 ms |
| /api/price/current | **502 agora** | 410 ms |
| /api/signals | 200, miss de cache | **16.237 ms** |
| /api/signals (2ª chamada) | 200, cache hit | 73 ms |
| /api/derivatives | 200 | 1.351 ms |
| /api/onchain | 200 | 2.442 ms |
| /api/sentiment/fear-greed | 200 | 961 ms |
| /api/backtest | 200 (30 KB) | 899 ms |
| /api/briefing | 200, último 07/08 | rápido |
| /api/news, /api/portfolio, /api/trades, /api/alerts | 200 | rápido |

- **502 do preço, causa raiz:** corpo do erro `"OKX ticker error: 429 Too Many Requests"`. OKX devolve 429 para o IP do Worker; da máquina local a OKX responde 200 com BTC 78.822,5 no mesmo minuto. O código não tem fallback para 429 (`lib/okx.ts` lança erro e `routes/price.ts:49-55` devolve 502 mesmo com dado recente no KV).
- `/api/price` e `/api/sentiment` sem subpath respondem 404 (paths corretos: `/api/price/latest`, `/api/sentiment/fear-greed`).
- Briefing parado: último `2026-08-07`, 23 dias de gap.

## 3. UI / Playwright

Script `audit-ui.py` em 1280x800 (2026-08-30 15:30 UTC):

- `pageerrors`: 0. JS não morre no load.
- Console: 1 erro `Failed to load resource: the server responded with a status of 502 ()` — a chamada de preço que falha no load inicial.
- Checks chips/th-sort: não aplicáveis (0 chips, 0 tabelas no design atual).
- Screenshot: `diagnosticos/audit-ui-20260830_123020.png` (não inspecionado visualmente nesta sessão, Read de PNG falhou; JSON de evidência em `audit-raw-20260830_123020.json`).

## 4. Segurança

- CORS `origin: "*"` com métodos GET/POST/PUT/DELETE liberados (`index.ts:27`). A variável `CORS_ORIGINS` está declarada em `wrangler.toml` e nunca é usada. P2.
- Rotas de escrita (trades, alerts, portfolio, whatsapp) sem auth. P2.
- Nenhuma credencial hardcoded em `worker/src` (grep de padrões de secret limpo). `.env.production` contém só a URL da API.
- Secrets no Cloudflare (via `wrangler secret list`): `CRYPTOPANIC_API_KEY` e `OPENROUTER_API_KEY` existem, mas nenhum dos dois tem leitor no código atual (`lib/cryptopanic.ts` é dead code, briefing virou template determinístico). Secrets vivos sem uso. P3.

## 5. Infra

- Worker `btc-radar`, D1 `btc-radar` (database_id local, mascarado por repo público), KV local (id mascarado por repo público).
- `wrangler deployments list` funciona com a auth local. `wrangler d1 execute --remote` falha com code 7403 (account not authorized) — lacuna do token; o plugin Cloudflare bindings respondeu e foi a via usada.
- D1 remoto (via plugin bindings, 2026-08-30):
  - `briefings`: 3 linhas, última 07/08.
  - `onchain_snapshots`: **0 linhas**. `prices`: **0 linhas**. `fear_greed`: **0 linhas**. `signals`: **0 linhas**.
- `wrangler.toml` local **sem bloco `[triggers]`/`crons`**; o comentário em `cron.ts:2` cita trigger `["0 */1 * * *"]` que não existe no config. Cron de coleta não está registrado no deploy atual, e o D1 vazio mostra que a coleta horária nunca rodou de fato.

## 6. Automação

- Task Scheduler local: nenhuma tarefa com "btc". `scripts/` vazio. Sem pipeline de deploy ou coleta documentado.
- `results/backtest_20260726_003955.json`: 5 estratégias, todas com retorno negativo em período de bear (buy & hold -43%), mas alpha positivo vs buy & hold em 4 de 5 (melhor: MACD alpha 40,58).
- Artefatos soltos na raiz do projeto: `temp_price.json`, `temp_signals.json` (25/07).

## 7. Problemas (P0/P1/P2/P3)

**P1**

- P1-001 — API de preço fora do ar: 429 da OKX sem fallback, 502 com dado recente no KV disponível (`routes/price.ts:49-55`).
  - **RESOLVIDO (verificado 2026-08-31):** fallback CoinPaprika no 429, stale do KV em outage, `btc:price:v3` unificado. `/api/price/latest` retorna 200 com preço real (USD 77.529) e dominância real (57.06) nesta rodada.
- P1-002 — Automação de coleta ausente: wrangler.toml sem triggers, D1 vazio, briefing 23 dias stale.
  - **RESOLVIDO (verificado 2026-08-31):** `[triggers] crons = ["0 */1 * * *"]` registrado no deploy, cron coletando OHLCV (3 intervalos), F&G (6h), derivativos, onchain e notícias. Backfill D1 executado (200 barras por intervalo). Heartbeat de execução agora gravado em `cron_executions`.

**P2**

- P2-001 — CORS `*` com escrita (`index.ts:27`), var `CORS_ORIGINS` morta.
- P2-002 — `/api/signals` 16 s no miss de cache por sleeps seriais e retries sem jitter (`routes/signals.ts:55-100`).
- P2-003 — Rotas de escrita sem auth.
- P2-004 — Caches duplicados e divergentes: `btc:price` (cron) vs `btc:price:v3` (rota), `btc:onchain:v1` vs `v2`, 3 famílias de `btc:signals` com chave órfã `btc:signals:all`.
- P2-005 — Notifier reenvia os mesmos sinais toda hora (sem dedup por `signal_id` em `whatsapp_messages`).

**P3**

- Bundle frontend único de 351,7 KB sem code splitting (recharts/d3 carregam na home).
- Secrets `CRYPTOPANIC_API_KEY`/`OPENROUTER_API_KEY` vivos sem uso; dead code (`lib/binance.ts`, `lib/cryptopanic.ts`, exports órfãos em `db/queries.ts`).
- `tests/` vazio com vitest configurado; version hardcoded no health; `market_cap = price * 19_800_000` e `btc_dominance = 0` hardcoded; portfolio devolve zeros silenciosos quando ticker falha; backtest O(n²) sem cache; temp files soltos.

## 8. OK sem ação

- `/api/health` ok; frontend carrega sem pageerror; news/sentiment/derivatives/onchain/trades/alerts/backtest respondem 200; nenhum segredo no repo; WhatsApp sem assinantes cadastrados (sem risco de vazamento de envio).

## 9. Próximos passos

1. Religar o cron: adicionar `[triggers] crons = ["0 */1 * * *"]` ao wrangler.toml e `npx wrangler triggers deploy` (ou deploy completo). Sem isso nada coleta.
2. Consertar o preço: fallback para 429 da OKX (CoinPaprika funcional hoje), servir stale do KV em vez de 502, e janela de cache alinhada com TTL.
3. Aplicar as 5 prioridades de otimização do relatório anexo (ver `OPTIMIZACAO-2026-08-30.md` no mesmo diretório se gerado, senão seção abaixo).

## Otimizações priorizadas (análise de código + pesquisa web)

Top 5 por impacto, com evidência em arquivo:linha:

1. **Sinais em paralelo sem sleeps** — `routes/signals.ts:55-100`. Os 3 timeframes são buscados em série com `setTimeout(2500)` entre eles. Miss de cache medido: 16,2 s. Com `Promise.all` + F&G do KV cai para ~1 s. Nunca cachear resultado vazio (hoje grava lixo por 600 s, linha 109).
2. **Dedup do push WhatsApp** — `lib/notifier.ts:128-152`. Mesmo `signal_id` estável o dia inteiro é reenviado a cada execução horária. Consultar `whatsapp_messages` antes de enviar.
3. **Popular `prices` com OKX nos 3 intervalos no cron** — `cron.ts:60` grava só 1d da CoinPaprika (free tier esgotado, `routes/price.ts:63`), então o notifier nasce capado a 1 timeframe e a tabela `signals` nunca recebe INSERT.
4. **Backtest O(n²) → pré-ordenação + busca binária** — `lib/backtest-score.ts:122-130,209-219`. `percentileRank` re-sort 5x por run; ~3×10^8 ops por request de `/score/distribution`, sem cache.
5. **Unificar caches** — cron e rota compartilharem `btc:price:v3` e `btc:onchain:v2`; eliminar `btc:price`, `btc:onchain:v1`, `btc:signals:all`.

Secundárias: cache KV escalonado para histórico de preço (`routes/price.ts:64` busca direto toda vez); `Promise.all` nos fetches de derivativos/onchain do cron; `env.DB.batch` nos updates de alerts (`routes/alerts.ts:242-244`) e webhook do WhatsApp (`routes/whatsapp.ts:82-95`); fechar CORS para `CORS_ORIGINS`; code splitting lazy por rota no frontend (recharts só na página de gráfico); remover dead code e secrets sem uso.

Referências pesquisadas: limite de 1.000 subrequests por invocação ([dev.to relato](https://dev.to/riversea/400-ad-accounts-x-3-subrequests-silent-data-loss-in-cloudflare-workers-and-how-i-fixed-it-43ie)), cache de subrequest via `Request.cache` ([docs Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/fetch/), [changelog cache no-store](https://developers.cloudflare.com/changelog/post/2024-11-11-cache-no-store/)), troubleshooting de cron triggers ([docs Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [PR triggers.crons=[] deleta schedules](https://github.com/cloudflare/workers-sdk/pull/9266)), code splitting com Vite/React ([dev.to lazy load](https://dev.to/sperez927/slice-your-js-lazy-load-components-with-react-vite-dynamic-imports-mp8), [tutorial lazy+code splitting](https://asoasis.tech/articles/2026-03-19-1453-react-lazy-loading-code-splitting-tutorial/)).

## 10. Estado final após correções (2026-08-30, sessão de otimização)

Todas as correções do PLANO-OTIMIZACAO foram aplicadas, revisadas em 2 rodadas adversariais (20 achados, todos corrigidos) e deployadas. Execução completa em PLANO-OTIMIZACAO-2026-08-30.md.

**Deploy e verificação (saída real):**

- Worker redeployado com triggers: saída do deploy confirmou schedule `0 */1 * * *` registrado. Cron volta a coletar na próxima hora cheia.
- `/api/health` 200. `/api/price/latest`: miss 1.116 ms com dado fresco da OKX, hit 104 ms, sem 502. Dominância 56,9 real (merge CoinPaprika) com OKX saudável.
- `/api/signals`: miss 2.271 ms (era 16.237 ms).
- onchain/sentiment/derivatives respondendo com dado real de produção.

**Backfill D1 (via plugin Cloudflare bindings, wrangler d1 execute falha com 7403):**

600 barras OKX inseridas com `INSERT OR REPLACE`, candles fechados, timestamps normalizados `.000Z` (padrão do cron):

| Intervalo | Linhas | De | Até |
|-----------|--------|-----|------|
| 1h | 200 | 2026-08-22T08:00Z | 2026-08-30T15:00Z |
| 4h | 200 | 2026-07-28T08:00Z | 2026-08-30T12:00Z |
| 1d | 200 | 2026-02-11T16:00Z | 2026-08-29T16:00Z |

Notifier tinha piso de 50 barras por timeframe, sem backfill ficaria mudo semanas. Resolvido.

**Pendências registradas:**

- **Pages deploy bloqueado por token**: autenticação falhou com código 10000, o token local cobre Workers mas não Pages (padrão conhecido, ver memória `cloudflare-api-token`). Comando pronto: `npx wrangler pages deploy dist --project-name btc-radar` a partir de `frontend/` com token com permissão Pages. Frontend em produção segue na versão de 26/07.
- **WHATSAPP_APP_SECRET não configurado**: webhook valida HMAC quando o secret existir, loga warning enquanto não existir. Aplicação funciona sem ele, mas o POST do webhook não valida assinatura. Setar via `wrangler secret put WHATSAPP_APP_SECRET` quando possível.

**Landing page com senha (resolvido em 30/08 noite, via Higgsfield):**

Pedido do Yan atendido com landing no Higgsfield: `https://btc-radar.higgsfield.app` (template scroll-scrub, site id `1702c540-7686-40e0-8afc-e75dcd1bbafd`). Senha `Coragem@10` com hash SHA-256 no bundle e sessionStorage. Filme em 3 clipes de 4s renderizado proceduralmente (PIL + ffmpeg, 119 candles 1H reais da OKX, visual azul e dourado), capítulos Pulso/Sinais/Ação com CTA para o painel. Geração por modelo de IA ficou fora por saldo de 0,07 credits (clipes custam 7,5+). Prova de navegador (Playwright com Chrome local): gate, senha, 3 capítulos, vídeos scrubando, zero pageerror. O gate também já está implementado no frontend do Pages (`frontend/src/components/PasswordGate.tsx`), aguardando só o deploy bloqueado por token.
