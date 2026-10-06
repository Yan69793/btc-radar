// BTC Radar â€” Cron handler para coleta batch
// Executado pelo trigger no wrangler.toml: ["0 */1 * * *"]

import type { Env, FearGreedData } from "./types";
import { fetchOHLCVWithFallback, crossCheckOHLCV } from "./lib/ohlcv-providers";
import { fetchFearGreedToday } from "./lib/alternativeme";
import { fetchOnChainSnapshot } from "./lib/mempool";
import { fetchNewsAggregated } from "./lib/news-sources";
import { insertPriceQuery, insertFearGreedQuery, insertNewsQuery } from "./db/queries";

const OHLCV_INTERVALS = ["1h", "4h", "1d"] as const;

async function collectOHLCV(env: Env, interval: (typeof OHLCV_INTERVALS)[number]): Promise<number> {
  const bars = await fetchOHLCVWithFallback(interval, 2);
  // F11 anti-look-ahead: providers podem incluir o candle em FORMAÇÃO por último;
  // persiste o penúltimo = último FECHADO. Com 1 barra, usa a única disponível.
  const bar = bars.length > 1 ? bars[bars.length - 2] : bars[0];
  if (!bar) return 0;
  const ts = new Date(bar.timestamp).toISOString();
  await env.DB.prepare(insertPriceQuery()).bind(
    "BTC-USD", ts, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.interval, bar.source
  ).run();
  return bar.close;
}
export async function handleScheduled(
  _event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const startTime = Date.now();
  const hour = new Date().getUTCHours();
  const results: string[] = [];
  const errors: string[] = [];

  // â”€â”€â”€ Coleta OHLCV (toda hora): 1h, 4h, 1d via OKX com fallback CoinPaprika â”€â”€â”€
  // Nota: ticker de preÃ§o NÃƒO Ã© coletado aqui. O KV expira em 2 min e a rota
  // /api/price serve sob demanda com cache de 60s, cron de hora em hora nÃ£o
  // mantÃ©m dado fresco.
  // Prioridade OHLCV: Coinbase -> Binance -> Kraken -> OKX. Consultas serializadas para reduzir rate-limit.
  for (const interval of OHLCV_INTERVALS) {
    try {
      const close = await collectOHLCV(env, interval);
      if (close > 0) {
        results.push(`OHLCV ${interval}: close $${close.toLocaleString("en-US")}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "erro";
      console.error(`[cron] OHLCV ${interval}: ${msg}`);
      errors.push(`OHLCV ${interval}: ${msg}`);
    }
  }

  // â”€â”€â”€ Coleta Fear & Greed (a cada 6h: 00, 06, 12, 18 UTC) â”€â”€â”€
  // Cross-check independente: Coinbase BTC-USD x Binance BTC-USDT.
  try {
    const check = await crossCheckOHLCV("1h");
    await env.KV.put("btc:ohlcv:cross-check", JSON.stringify({ ...check, checked_at: new Date().toISOString() }), { expirationTtl: 7200 });
    if (check.divergence_pct !== null && !check.ok) {
      errors.push(`OHLCV cross-check: Coinbase x Binance divergence ${check.divergence_pct}%`);
    }
  } catch (err) {
    console.error(`[cron] OHLCV cross-check indisponivel: ${err instanceof Error ? err.message : err}`);
  }
  if (hour % 6 === 0) {
    try {
      const fg = await fetchFearGreedToday();
      // TTL de 6h, alinhado ao ciclo de coleta: cache nao fica vazio 5h de cada 6
      await env.KV.put("sentiment:fear-greed", JSON.stringify(fg), { expirationTtl: 21600 });

      const date = new Date().toISOString().slice(0, 10);
      await env.DB.prepare(insertFearGreedQuery())
        .bind(date, fg.value, fg.classification, fg.timestamp, "Alternative.me")
        .run();

      results.push(`Fear & Greed: ${fg.value} (${fg.classification})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "erro";
      console.error(`[cron] Fear & Greed: ${msg}`);
      errors.push(`Fear & Greed: ${msg}`);
    }
  }

  // â”€â”€â”€ Derivativos (funding rate + open interest, toda hora) â”€â”€â”€
  // Grava o MESMO shape da rota /api/derivatives para o cache ser intercambiÃ¡vel
  try {
    const [fundingRes, oiRes] = await Promise.all([
      fetch("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP"),
      fetch("https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP"),
    ]);

    const snapshot = {
      symbol: "BTC-USDT-SWAP",
      funding_rate: null as number | null,
      funding_rate_annualized: null as number | null,
      open_interest_usd: null as number | null,
      open_interest_btc: null as number | null,
      oi_change_24h_pct: null,
      long_short_ratio: null,
      timestamp: new Date().toISOString(),
      source: "OKX",
    };

    if (fundingRes.ok) {
      const fj = await fundingRes.json() as { code: string; data: Array<{ fundingRate: string }> };
      if (fj.code === "0" && fj.data?.[0]) {
        const rate = parseFloat(fj.data[0].fundingRate);
        snapshot.funding_rate = rate;
        snapshot.funding_rate_annualized = Math.round(rate * 3 * 365 * 100 * 100) / 100;
      }
    }

    if (oiRes.ok) {
      const oj = await oiRes.json() as {
        code: string;
        data: Array<{ oiCcy: string; oiUsd: string }>;
      };
      if (oj.code === "0" && oj.data?.[0]) {
        snapshot.open_interest_btc = parseFloat(oj.data[0].oiCcy);
        snapshot.open_interest_usd = parseFloat(oj.data[0].oiUsd);
      }
    }

    await env.KV.put("btc:derivatives:v1", JSON.stringify(snapshot), { expirationTtl: 600 });

    if (snapshot.funding_rate != null || snapshot.open_interest_usd != null) {
      results.push(
        `Derivativos: funding ${snapshot.funding_rate != null ? (snapshot.funding_rate * 100).toFixed(4) + "%" : "N/D"}, OI ${snapshot.open_interest_usd != null ? "$" + (snapshot.open_interest_usd / 1e9).toFixed(2) + "B" : "N/D"}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro";
    console.error(`[cron] Derivativos: ${msg}`);
    errors.push(`Derivativos: ${msg}`);
  }

  // â”€â”€â”€ On-chain (mempool.space, toda hora) â”€â”€â”€
  try {
    const snap = await fetchOnChainSnapshot();
    if (snap.block_height != null || snap.hash_rate != null || snap.avg_fee_sats != null) {
      await env.DB.prepare(
        `INSERT INTO onchain_snapshots
           (timestamp, hash_rate, difficulty, active_addresses, transaction_count,
            transaction_volume_usd, avg_fee_sats, block_height, circulating_supply, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        snap.timestamp,
        snap.hash_rate,
        snap.difficulty,
        snap.active_addresses,
        snap.transaction_count,
        snap.transaction_volume_usd,
        snap.avg_fee_sats,
        snap.block_height,
        snap.circulating_supply,
        snap.source
      ).run();

      await env.KV.put("btc:onchain:v2", JSON.stringify(snap), { expirationTtl: 3600 });

      results.push(`On-chain: bloco ${snap.block_height ?? "N/D"}, fee ${snap.avg_fee_sats ?? "N/D"} sats`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro";
    console.error(`[cron] On-chain: ${msg}`);
    errors.push(`On-chain: ${msg}`);
  }

  // â”€â”€â”€ Coleta de noticias (toda hora) â”€â”€â”€
  try {
    const news = await fetchNewsAggregated("hot", 20);
    await env.KV.put("news:v2:hot", JSON.stringify(news), { expirationTtl: 900 });

    if (news.length > 0) {
      const stmt = env.DB.prepare(insertNewsQuery());
      const batch: D1PreparedStatement[] = news.map((item) =>
        stmt.bind(item.published_at, item.title, item.url, item.source, item.sentiment, item.summary)
      );
      for (let i = 0; i < batch.length; i += 10) {
        await env.DB.batch(batch.slice(i, i + 10));
      }
    }

    results.push(`Noticias: ${news.length} coletadas`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro";
    console.error(`[cron] Noticias: ${msg}`);
    errors.push(`Noticias: ${msg}`);
  }

  // â”€â”€â”€ Briefing diario (19h BRT = 22h UTC) â”€â”€â”€
  if (hour === 22) {
    try {
      const { generateBriefing, storeBriefing } = await import("./lib/briefing");
      const briefing = await generateBriefing(env);
      const briefId = await storeBriefing(env, briefing);
      results.push(`Briefing: gerado #${briefId} (${briefing.date})`);

      // Push briefing via WhatsApp para assinantes
      try {
        const { notifyBriefing } = await import("./lib/notifier");
        const notification = await notifyBriefing(env, briefing.summary);
        if (notification.sent > 0) {
          results.push(`WhatsApp: briefing enviado para ${notification.sent} assinante(s)`);
        }
        if (notification.errors.length > 0) {
          errors.push(...notification.errors);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "erro";
        console.error(`[cron] WhatsApp Briefing: ${msg}`);
        errors.push(`WhatsApp Briefing: ${msg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "erro";
      console.error(`[cron] Briefing: ${msg}`);
      errors.push(`Briefing: ${msg}`);
    }
  }

  // â”€â”€â”€ Persistência do histórico prospectivo de sinais (Aureus, Fase 1) â”€â”€â”€
  // 1) Gera e salva sinais direcionais com metadados completos.
  //    Regra 7: não reabre oportunidades iguais enquanto abertas.
  // 2) Resolve os pendentes com a série de preços acumulada no D1.
  // Isso roda logo após a coleta de preços (já aconteceu acima) e ANTES do push
  // WhatsApp, para garantir que o sinal novo já esteja gravado quando enviado.
  try {
    const { persistSignals, resolvePendingSignals } = await import("./signal-history-service");
    const { collectProspectiveSignals } = await import("./prospective-signal-generator");
    const now = new Date().toISOString();
    const fgKv = (await env.KV.get("sentiment:fear-greed", "json")) as FearGreedData | null;
    const { rawSignals, allSignals, portfolioCandle, errors: signalErrors } = await collectProspectiveSignals(env.DB, fgKv, now);
    errors.push(...signalErrors);

    const persistResult = await persistSignals(env.DB, allSignals);
    results.push(
      `Histórico sinais: ${persistResult.inserted} inserido(s), ` +
      `${persistResult.skipped_same_direction_open} pulado(s) (mesma direção aberta), ` +
      `${persistResult.skipped_flat_or_no_entry} flat/sem-entry`,
    );

    const res = await resolvePendingSignals(env.DB);
    results.push(
      `Resolução sinais: ${res.resolved} 100% fechado(s), ${res.with_gap} com gap, ` +
      `${res.processed} processado(s), erros=${res.errors.length}`,
    );
    if (res.errors.length) {
      errors.push(...res.errors.slice(0, 10).map(e => "Resolução: " + e));
    }

    // Portfolio Engine Aureus: uma unica posicao agregada em BTC, controlada pelo consenso.
    // Idempotencia: um ciclo por candle timestamp. Reexecucao do cron nao reaplica exposicao.
    if (portfolioCandle) {
      const { computeConsensus } = await import("./lib/consensus");
      const { persistAureusPortfolioCycle } = await import("./aureus-portfolio-service");
      const consensus = computeConsensus(rawSignals) ?? {
        timeframe: "consensus" as const, market_date: now.slice(0, 10), generated_at: now,
        verdict: "AGUARDAR" as const, conviction: 0, raw_conviction: 0, divergence_penalty: 0, agreement: 0,
        weights: { short: 0.2, medium: 0.3, long: 0.5 },
        per_timeframe: { short: { verdict: "AGUARDAR" as const, conviction: 0 }, medium: { verdict: "AGUARDAR" as const, conviction: 0 }, long: { verdict: "AGUARDAR" as const, conviction: 0 } },
        rationale: "Sem sinais elegíveis. Carteira permanece marcada a mercado.", price: portfolioCandle.close,
      };
      if (consensus) {
        const portfolioRun = await persistAureusPortfolioCycle({
          DB: env.DB,
          consensus,
          signals: rawSignals,
          candle: portfolioCandle,
          evaluatedAt: now,
        });
        if (portfolioRun.skipped) {
          results.push(`Aureus Portfolio: ciclo ${portfolioRun.cycleKey} já persistido`);
        } else if (portfolioRun.result) {
          results.push(
            `Aureus Portfolio: ${consensus.verdict}, NAV ${portfolioRun.result.snapshot.nav.toFixed(4)}, ` +
            `exposição ${(portfolioRun.result.snapshot.exposure * 100).toFixed(2)}%`,
          );
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro";
    console.error(`[cron] Histórico sinais: ${msg}`);
    errors.push(`Histórico sinais: ${msg}`);
  }

  // â”€â”€â”€ Push de sinais via WhatsApp (toda hora) â”€â”€â”€
  try {
    const { notifyHighConvictionSignals } = await import("./lib/notifier");
    const notification = await notifyHighConvictionSignals(env);
    if (notification.sent > 0) {
      results.push(`WhatsApp: ${notification.sent} sinal(is) enviado(s)`);
    }
    if (notification.errors.length > 0) {
      errors.push(...notification.errors);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro";
    console.error(`[cron] WhatsApp Sinais: ${msg}`);
    errors.push(`WhatsApp Sinais: ${msg}`);
  }

  // â”€â”€â”€ Heartbeat: registra a execucao para operacao saber que aconteceu â”€â”€â”€
  try {
    const durationMs = Date.now() - startTime;
    await env.DB.prepare(
      `INSERT INTO cron_executions
         (run_at, duration_ms, success_count, error_count, successos_erros, freshness_json, has_errors)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        new Date().toISOString(),
        durationMs,
        results.length,
        errors.length,
        JSON.stringify({ ok: results, erros: errors }),
        JSON.stringify({ run_at: new Date().toISOString(), hour }),
        errors.length > 0 ? 1 : 0,
      )
      .run();
  } catch (err) {
    console.error(`[cron] heartbeat: ${err instanceof Error ? err.message : "erro"}`);
  }

  // â”€â”€â”€ Log â”€â”€â”€
  console.log(
    `[btc-radar cron] ${new Date().toISOString()} | OK: ${results.join(" | ")}` +
      (errors.length > 0 ? ` | ERROS: ${errors.join(" | ")}` : "")
  );
}


