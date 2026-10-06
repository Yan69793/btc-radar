// BTC Radar — Cron handler para coleta batch
// Executado pelo trigger no wrangler.toml: ["0 */1 * * *"]

import type { Env } from "./types";
import { fetchOHLCV } from "./lib/coinpaprika";
import { fetchOKXOHLCV } from "./lib/okx";
import { fetchFearGreedToday } from "./lib/alternativeme";
import { fetchOnChainSnapshot } from "./lib/mempool";
import { fetchNewsAggregated } from "./lib/news-sources";
import { insertPriceQuery, insertFearGreedQuery, insertNewsQuery } from "./db/queries";

const OHLCV_INTERVALS = ["1h", "4h", "1d"] as const;

async function collectOHLCV(env: Env, interval: (typeof OHLCV_INTERVALS)[number]): Promise<number> {
  let bar;
  try {
    // limit 2: OKX devolve em ordem cronologica e a ultima barra e a em formacao
    // (confirm=0). A penultima (bars[0]) e a barra fechada.
    const bars = await fetchOKXOHLCV(interval, 2);
    bar = bars[0];
  } catch (err) {
    // CoinPaprika mapeia 4h para 6h; gravar barra de 6h como 4h distorce EMA/RSI
    // e intercala timestamps 00/06/12/18 com os 00/04/08/12 do OKX. Pula o 4h.
    if (interval === "4h") {
      console.error(`[cron] OKX OHLCV 4h falhou e CoinPaprika nao tem 4h: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
    console.error(`[cron] OKX OHLCV ${interval} falhou, usando CoinPaprika: ${err instanceof Error ? err.message : err}`);
    const bars = await fetchOHLCV(interval, 2);
    bar = bars[0];
  }

  if (!bar) return 0;

  // Normaliza timestamp para ISO com .000Z: o CoinPaprika manda sem milissegundos,
  // string diferente da OKX, e o UNIQUE(timestamp, interval) nao colidiria
  const ts = new Date(bar.timestamp).toISOString();

  // INSERT OR REPLACE: upsert por (timestamp, interval), sem duplicar
  await env.DB.prepare(insertPriceQuery())
    .bind(
      "BTC-USD",
      ts,
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      bar.volume,
      bar.interval,
      bar.source
    )
    .run();

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

  // ─── Coleta OHLCV (toda hora): 1h, 4h, 1d via OKX com fallback CoinPaprika ───
  // Nota: ticker de preço NÃO é coletado aqui. O KV expira em 2 min e a rota
  // /api/price serve sob demanda com cache de 60s, cron de hora em hora não
  // mantém dado fresco.
  const ohlcvResults = await Promise.allSettled(
    OHLCV_INTERVALS.map(async (interval) => {
      try {
        const close = await collectOHLCV(env, interval);
        if (close > 0) {
          results.push(`OHLCV ${interval}: close $${close.toLocaleString("en-US")}`);
        }
      } catch (err) {
        errors.push(`OHLCV ${interval}: ${err instanceof Error ? err.message : "erro"}`);
      }
    })
  );
  for (const r of ohlcvResults) {
    if (r.status === "rejected") {
      console.error(`[cron] OHLCV: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    }
  }

  // ─── Coleta Fear & Greed (a cada 6h: 00, 06, 12, 18 UTC) ───
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

  // ─── Derivativos (funding rate + open interest, toda hora) ───
  // Grava o MESMO shape da rota /api/derivatives para o cache ser intercambiável
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

  // ─── On-chain (mempool.space, toda hora) ───
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

  // ─── Coleta de noticias (toda hora) ───
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

  // ─── Briefing diario (19h BRT = 22h UTC) ───
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

  // ─── Push de sinais via WhatsApp (toda hora) ───
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

  // ─── Heartbeat: registra a execucao para operacao saber que aconteceu ───
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

  // ─── Log ───
  console.log(
    `[btc-radar cron] ${new Date().toISOString()} | OK: ${results.join(" | ")}` +
      (errors.length > 0 ? ` | ERROS: ${errors.join(" | ")}` : "")
  );
}
