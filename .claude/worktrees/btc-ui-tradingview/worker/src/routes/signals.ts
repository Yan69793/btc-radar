// BTC Radar — Rotas de sinais
// GET /api/signals — gera sinais para todos os timeframes (paralelo, sem sleeps)
// GET /api/signals/:strategy — filtra por estratégia (reusa cache v2)

import { Hono } from "hono";
import type { Env, SignalDocument, Timeframe, FearGreedData, OHLCV } from "../types";
import { fetchOKXOHLCV } from "../lib/okx";
import { fetchOHLCV as fetchCPOHLCV } from "../lib/coinpaprika";
import { fetchFearGreedToday } from "../lib/alternativeme";
import { generateSignals } from "../lib/signal-engine";
import { computeConsensus } from "../lib/consensus";
import { kvGetJSON, deduped } from "../lib/kv-helpers";

export const signalRoutes = new Hono<{ Bindings: Env }>();

const TIMEFRAMES: { tf: Timeframe; interval: "1h" | "4h" | "1d"; limit: number }[] = [
  { tf: "short", interval: "1h", limit: 72 },
  { tf: "medium", interval: "4h", limit: 180 },
  { tf: "long", interval: "1d", limit: 200 },
];

const CACHE_TTL = 600; // 10 min
const CACHE_FRESH_MS = 300_000; // 5 min de aceite

async function getFearGreed(kv: KVNamespace): Promise<FearGreedData | null> {
  // KV primeiro, fetch ao vivo só em miss
  const cached = await kvGetJSON<FearGreedData>(kv, "sentiment:fear-greed");
  if (cached && Date.now() - new Date(cached.timestamp).getTime() < 55 * 60_000) {
    return cached;
  }
  try {
    const fresh = await fetchFearGreedToday();
    await kv.put("sentiment:fear-greed", JSON.stringify(fresh), { expirationTtl: 3600 });
    return fresh;
  } catch {
    return cached; // stale serve
  }
}

async function fetchWithRetry(interval: "1h" | "4h" | "1d" | "1w", limit: number): Promise<OHLCV[]> {
  // deduped: dois requests simultaneos com cache miss (RecommendationPanel + pagina
  // Signals chamam /api/signals) compartilham a mesma chamada em voo
  const okxKey = `okx:ohlcv:${interval}:${limit}`;

  // 2 tentativas OKX com 2s entre elas (nao socar a janela de 20 req/2s da OKX)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await deduped(okxKey, () => fetchOKXOHLCV(interval, limit));
      if (result.length > 0) return result;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Fallback CoinPaprika: mesma OKX que acabou de falhar nao ajuda
  try {
    const cp = await deduped(`cp:ohlcv:${interval}:${limit}`, () => fetchCPOHLCV(interval, limit));
    if (cp.length > 0) return cp;
  } catch (err) {
    console.error(`[signals] CoinPaprika ${interval} falhou: ${err instanceof Error ? err.message : err}`);
  }
  return [];
}

async function processTimeframe(
  tf: Timeframe,
  interval: "1h" | "4h" | "1d",
  limit: number,
  fearGreed: FearGreedData | null,
  debugInfo: Record<string, unknown>
): Promise<SignalDocument[]> {
  try {
    const candles = await fetchWithRetry(interval, limit);
    debugInfo[`${tf}_candles`] = candles.length;

    if (candles.length < 20) {
      debugInfo[`${tf}_error`] = `so ${candles.length} candles`;
      return [];
    }

    const signals = generateSignals({ candles, fearGreed, timeframe: tf });
    debugInfo[`${tf}_signals`] = signals.length;
    return signals;
  } catch (err) {
    debugInfo[`${tf}_error`] = err instanceof Error ? err.message : String(err);
    return [];
  }
}

signalRoutes.get("/", async (c) => {
  try {
    const filterTf = c.req.query("timeframe") as Timeframe | undefined;
    const nocache = c.req.query("nocache") === "1";
    const debug = c.req.query("debug") === "1";

    // Cache KV de 10 minutos
    const cacheKey = `btc:signals:v2:${filterTf || "all"}`;
    if (!nocache) {
      const cached = await kvGetJSON<{ signals: SignalDocument[]; generated_at: string }>(
        c.env.KV, cacheKey
      );
      if (cached) {
        const age = Date.now() - new Date(cached.generated_at).getTime();
        if (age < CACHE_FRESH_MS) {
          return c.json({ success: true, data: cached, timestamp: new Date().toISOString() });
        }
      }
    }

    const fearGreed = await getFearGreed(c.env.KV);

    // Timeframes em paralelo, sem sleeps: 3 chamadas OKX ficam bem abaixo do limite de 20 req/2s
    const timeframesToProcess = filterTf
      ? TIMEFRAMES.filter((t) => t.tf === filterTf)
      : TIMEFRAMES;
    const debugInfo: Record<string, unknown> = {};
    const results = await Promise.allSettled(
      timeframesToProcess.map(({ tf, interval, limit }) =>
        processTimeframe(tf, interval, limit, fearGreed, debugInfo)
      )
    );

    const allSignals = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

    // Consenso multi-timeframe sobre os sinais coletados (aditivo, nao quebra shape)
    const consensus = computeConsensus(allSignals);

    const result = {
      signals: allSignals,
      generated_at: new Date().toISOString(),
      ...(consensus ? { consensus } : {}),
      ...(debug ? { _debug: debugInfo } : {}),
    };

    // Nunca cachear vazio: miss repetido gera de novo em vez de servir nada por 10 min
    if (allSignals.length > 0) {
      await c.env.KV.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
    }

    return c.json({ success: true, data: result, timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao gerar sinais";
    return c.json(
      { success: false, data: null, error: message, timestamp: new Date().toISOString() },
      500
    );
  }
});

signalRoutes.get("/:strategy", async (c) => {
  try {
    const strategy = c.req.param("strategy");
    const filterTf = c.req.query("timeframe") as Timeframe | undefined;

    // Reusa cache v2 dos sinais completos (mesma chave que a rota principal escreve)
    const cacheKey = `btc:signals:v2:all`;
    const cached = await kvGetJSON<{ signals: SignalDocument[]; generated_at: string }>(
      c.env.KV, cacheKey
    );

    let signals: SignalDocument[];
    if (cached && Date.now() - new Date(cached.generated_at).getTime() < CACHE_FRESH_MS) {
      signals = cached.signals;
    } else {
      // Miss: gera direto (paralelo, sem sleeps)
      const fearGreed = await getFearGreed(c.env.KV);
      const debugInfo: Record<string, unknown> = {};
      const results = await Promise.allSettled(
        TIMEFRAMES.map(({ tf, interval, limit }) =>
          processTimeframe(tf, interval, limit, fearGreed, debugInfo)
        )
      );
      signals = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

      if (signals.length > 0) {
        await c.env.KV.put(
          cacheKey,
          JSON.stringify({ signals, generated_at: new Date().toISOString() }),
          { expirationTtl: CACHE_TTL }
        );
      }
    }

    const filtered = signals.filter((s) => {
      const matchStrategy = s.strategy === strategy;
      const matchTf = !filterTf || s.timeframe === filterTf;
      return matchStrategy && matchTf;
    });

    return c.json({
      success: true,
      data: { signals: filtered, generated_at: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao filtrar sinais";
    return c.json(
      { success: false, data: null, error: message, timestamp: new Date().toISOString() },
      500
    );
  }
});
