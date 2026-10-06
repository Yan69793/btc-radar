# PLANO DE OTIMIZAÇÃO — BTC Radar (2026-08-30)

Fonte: DIAGNOSTICO-2026-08-30.md + análise de código (subagente) + pesquisa web.

## Escopo

1. Consertar os 2 P1 (cron sem trigger, price 502 por 429 OKX).
2. Aplicar top 5 de otimização (sinais paralelos, dedup WhatsApp, prices com OKX, backtest binário, unificar caches).
3. Fechar P2 de segurança e cache (CORS, batch D1, janelas de cache).
4. Frontend: lazy routes + manualChunks.
5. Testes vitest mínimos nas funções puras alteradas.
6. Deploy worker + frontend, verificação por curl.

## Arquivos (quem mexe)

**Main (eu):**
- `worker/wrangler.toml` — adicionar `[triggers] crons = ["0 */1 * * *"]`
- `worker/src/index.ts` — CORS fechado via `CORS_ORIGINS`
- `worker/src/routes/price.ts` — fallback 429, stale KV, unificar `btc:price:v3`, cache de /history escalonado, /current composto
- `worker/src/routes/signals.ts` — Promise.all sem sleeps, F&G do KV, sem cache de vazio
- `worker/src/routes/sentiment.ts` — janela=TTL, cache do histórico
- `worker/src/routes/derivatives.ts` — janela alinhada, Promise.all
- `worker/src/cron.ts` — OKX nos 3 intervalos para prices, gravar `btc:price:v3`, onchain unificado via fetchOnChainSnapshot, Promise.all, log de fallbacks
- `worker/src/lib/notifier.ts` — dedup por signal_id, batch D1, pool de envio

**Subagente A (coding-agent):** `lib/backtest-score.ts` pré-ordenação + busca binária, `routes/backtest.ts` cache KV da distribuição, teste vitest de percentil.

**Subagente B (coding-agent):** batch em `routes/alerts.ts` e `routes/whatsapp.ts`, `routes/trades.ts` LIMIT + agregação SQL, migração `0003_trades_index.sql`, remover dead code (`lib/binance.ts`, `lib/cryptopanic.ts`, exports mortos em `db/queries.ts` e `lib/coinpaprika.ts`, vars mortas em `types.ts`). Garantir typecheck.

**Subagente C (coding-agent):** frontend lazy routes + Suspense em `src/App.tsx`, `manualChunks` em `vite.config.ts`.

## Fora do escopo (registrado, não será feito)

- Briefing serial → Promise.allSettled (roda 1x/dia, sem impacto de request).
- Auth nas rotas de escrita (decisão de produto, não otimização).
- SMA incremental (irrelevante no volume atual).
- Secrets CRYPTOPANIC/OPENROUTER: remover do código mas manter secrets no Cloudflare até decisão do Yan.

## Verificação (antes de declarar pronto)

1. `tsc --noEmit` limpo no worker.
2. `vitest run` passa.
3. Frontend `npm run build` limpo.
4. Deploy worker + `wrangler triggers deploy`; deploy Pages.
5. curl: `/api/health` 200, `/api/price/latest` 200 (sem 502), `/api/signals` miss < 3s, latências medidas.
6. D1: após próxima hora cheia, `prices` deve ter linhas (verificação posterior do Yan, anotada).

## Execução (2026-08-30)

**Feito e verificado em produção:**

- P1-001 corrigido: fallback CoinPaprika em 429 da OKX, stale do KV em outage total, merge de dominância/market cap com OKX saudável, KV `btc:price:v3` com wrapper `{data, cached_at}` (janela de 60 s contra a idade do cache, não do dado da fonte). Medido: miss 1.116 ms, hit 104 ms, sem 502.
- P1-002 corrigido: `[triggers] crons = ["0 */1 * * *"]` no wrangler.toml, deploy confirmou o schedule.
- Sinais paralelos sem sleeps com deduped em voo e fallback CP: miss 16.237 ms → 2.271 ms.
- Dedup do notifier: janela de 24 h por `signal_id:verdict` no conteúdo de `whatsapp_messages`, pool de envio por assinante, batch D1 em pedaços de 10.
- Cron reescrito: OHLCV OKX nos 3 intervalos com `bars[0]` (barra fechada), timestamps normalizados `.toISOString()` para bater o UNIQUE, CP pulando 4h (mapeia para 6h), F&G TTL 21600, onchain unificado em `btc:onchain:v2`.
- Backtest: pré-ordenação + busca binária no percentil, cache KV da distribuição (TTL 3600), 12 testes vitest.
- Batch D1 em alerts/whatsapp/trades, agregação SQL em /performance, migração 0003 de índice, dead code removido (`lib/binance.ts`, `lib/cryptopanic.ts`, exports mortos).
- Frontend: 9 rotas lazy com Suspense, manualChunks vendor/charts, build limpo.
- CORS fechado via `CORS_ORIGINS` callback.
- Webhook WhatsApp: verificação HMAC-SHA256 quando `WHATSAPP_APP_SECRET` existe (warning quando não), verify token sem default (403 fail-high).
- Revisão adversarial em 2 rodadas, 20 achados, todos corrigidos (destaques: dominância sempre 0 com OKX saudável, reenvio de 6 em 6 h e supressão de reversão de veredito, cron gravando candle em formação, chave órfã v1 no briefing, timestamp sem ms quebrando UNIQUE, retry sem sleep e fallback diário re-chamando OKX).
- `tsc --noEmit` limpo, `vitest run` verde, `npm run build` do frontend limpo.
- Backfill D1 executado: 200 barras por intervalo (1h, 4h, 1d), OKX, candles fechados, `.000Z`. Notifier tem o piso de 50 barras por timeframe desde já.

**Pendente (bloqueado fora do escopo):**

- Pages deploy: token local sem permissão Pages (erro 10000). Comando pronto: `npx wrangler pages deploy dist --project-name btc-radar` em `frontend/`.
- `WHATSAPP_APP_SECRET`: setar o secret para ativar a validação HMAC do webhook.
- `CRYPTOPANIC_API_KEY`/`OPENROUTER_API_KEY`: remoção dos secrets no Cloudflare fica para decisão do Yan.
