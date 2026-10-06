# DIAGNÓSTICO — BTC Radar (auditoria completa)
**Data:** 2026-09-12 20:25 BRT
**Alvo:** https://btc-radar.pages.dev/painel/ + https://btc-radar.prospects-intel.workers.dev
**Método:** auditoria generalista completa (blocos A–F), incremental sobre DIAGNOSTICO-2026-08-30
**Raw:** diagnosticos/audit-raw-2026-09-12.json
**Repo:** `E:\Diretorio\Claude\ARQUIVO\Btc-radar\btc-radar` — `main`, HEAD `0aa2267` (2026-09-01), clean + 2 untracked desta auditoria

## 1. Descoberta e drift
- Frontend `frontend/` (`@sz/btc-radar-frontend`, React 19 + Vite, base `/painel/`) → Cloudflare Pages `btc-radar.pages.dev`. Raiz = landing estática, `/painel/` = app.
- Backend `worker/` (`@sz/btc-radar-worker`, Hono) → Worker `btc-radar`, D1 + KV, cron `0 */1 * * *`.
- `SERVICE_VERSION = 0.8.0` no código = `0.8.0` no `/api/health`. **Sem drift.**
- 13 rotas: price, sentiment, news, signals, onchain, trades, alerts, backtest, derivatives, portfolio, briefing, whatsapp, auth.

## 2. HTTP / APIs (todas GET 200)
| Endpoint | Resultado |
|---|---|
| /api/health | 200, cron 23:00Z, price age 29s |
| /api/price/latest | 200, BTC 77.266 |
| /api/signals | 200 (miss 4.2s gera, depois hit); veredictos AGUARDAR, convicção 1–3 — coerente com Greed 63 |
| /api/news | 200, 20 itens |
| /api/onchain | 200, bloco 966729, fee 1 sat (4 campos null — P3-003) |
| /api/sentiment/fear-greed | 200, 63 Greed de hoje |
| /api/derivatives | 200, funding +0.0056%, OI $2.12B (OKX real) |
| /api/backtest | 200, 30KB |
| /api/briefing | 200, último 11/09 (ontem — gap de 23d resolvido) |
| /api/trades, /alerts, /portfolio | 200 (vazios/zerados — sem posição do dono) |
| POST /api/signals sem sessão | 401 correto |
| GET /api/auth/me sem token | 401 correto |
| /api/price e /api/sentiment raiz | 404 (sub-rota exigida, não bug) |

## 3. UI
- **Lacuna:** automação browser indisponível (CDP recusado). Fallback por evidência estática: HTML 200 + 4 assets 200 (index 22KB, vendor 230KB, css 35KB — code splitting confirmado, sem bundle único), 9 rotas lazy + Suspense + ErrorBoundary + validação de token no servidor (`App.tsx`), login real contra `/api/auth` (`PasswordGate.tsx`, sem senha hardcoded — gate SHA da landing antiga foi substituído). 0 pageerror na rodada 30/08.
- Recomendação: re-rodar Bloco C com Playwright quando o Chrome de automação estiver no ar.

## 4. Segurança
- Pages: CSP forte (`default-src 'none'`, `connect-src` só o Worker), `DENY` + `nosniff` + `frame-ancestors 'none'`. HSTS ausente (P3-001).
- Worker: CORS fechado — preflight legítimo recebe `Allow-Origin: pages.dev`; origem evil recebe o primeiro permitido, sem reflexo (correto).
- `writeGuard` deny-by-default; escrita só com sessão admin (env `ADMIN_EMAILS`, não banco). Exceções: login/register/logout + webhook WhatsApp (HMAC quando o secret existir).
- Auth: PBKDF2 100k + salt, comparação em tempo constante, sessão 256-bit em KV (30d), rate limit 20/10min por IP, 409 em email duplicado.
- Nenhum secret hardcoded no código. `WHATSAPP_APP_SECRET` segue sem valor (webhook sem validação — aceito, sem assinantes em risco).
- P3-002: `register` 500 devolve `message` bruto do erro — trocar por mensagem genérica.

## 5. Infra
- Cron registrado e **coletando**: heartbeat persiste (em 31/08 estava vazio; hoje `last_cron_at` real). OHLCV OKX 3 intervalos + F&G 6h + derivativos + on-chain + notícias + briefing 22h UTC + push WhatsApp + heartbeat com `successos_erros`.
- D1 direto via token local segue 7403 (quirk conhecido desde 30/08) — leitura remota só via health/rotas.

## 6. Automação e testes
- `npm test` no worker: **5 arquivos, 38 testes, todos verdes** (auth, write-guard, consensus, walkforward, backtest-score).
- Nenhum Task Scheduler local (coleta é cron do Worker — correto).

## 7. Problemas
- **P2-001:** `last_cron_errors: 2` no último run, coleta fresca. Causa exata indisponível (D1 7403); confirmar via dashboard/`wrangler tail` após próxima hora cheia.
- **P3-001:** HSTS ausente. **P3-002:** `register` 500 com message bruto. **P3-003:** on-chain parcial (4 nulls do mempool).
- P0/P1: nenhum.

## 8. Resolvido desde 30/08 (confirmado hoje)
Price 502, cron sem trigger/heartbeat, CORS `*`, escrita sem auth, briefing 23d stale, bundle único, tests vazio.

## 9. Próximos passos
1. Detalhar os 2 erros do cron (dashboard ou tail na próxima hora cheia).
2. P3-002: mensagem genérica no 500 do register.
3. Re-rodar Bloco C Playwright quando possível.
4. Nada para deployar: prod = repo (0.8.0), frontend e worker saudáveis.
