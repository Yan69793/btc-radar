// BTC Radar — Rotas de preço
// Fonte primária: OKX (ticker, alta/baixa/volume 24h)
// Fallback: CoinPaprika (preço, market cap, dominância) — OKX devolve 429 para IP de datacenter
// Cache KV unificado: btc:price:v3, com stale servido quando todas as fontes falham

import { Hono } from "hono";
import type { Env } from "../types";
import { fetchTicker as fetchCPTicker, fetchOHLCV } from "../lib/coinpaprika";
import { fetchOKXTicker, fetchOKXOHLCV } from "../lib/okx";
import { fetchFearGreedToday } from "../lib/alternativeme";
import { kvGetJSON, deduped } from "../lib/kv-helpers";
import type { ApiResponse, PriceSnapshot, OHLCV } from "../types";

export const priceRoutes = new Hono<{ Bindings: Env }>();

const PRICE_KEY = "btc:price:v3";
const PRICE_FRESH_MS = 60_000; // janela de aceite: idade do CACHE, nao do dado da fonte

interface CachedPrice {
  data: PriceSnapshot;
  cached_at: string;
}

// TTL de cache por intervalo de OHLCV (1h muda a cada hora, 1d a cada dia)
const OHLCV_TTL: Record<string, number> = {
  "1h": 300,
  "4h": 900,
  "1d": 3600,
  "1w": 7200,
};

async function fetchTickerWithFallback(): Promise<PriceSnapshot> {
  try {
    const ticker = await deduped("okx:ticker", () => fetchOKXTicker());

    // OKX nao fornece dominancia (0 fixo) nem market cap real (supply hardcoded).
    // Merge dos dois campos via CoinPaprika; preco/24h seguem da OKX.
    if (ticker.btc_dominance === 0) {
      try {
        const cp = await deduped("cp:ticker", () => fetchCPTicker());
        ticker.market_cap = cp.market_cap;
        ticker.btc_dominance = cp.btc_dominance;
      } catch (err) {
        console.error(`[price] merge CoinPaprika falhou: ${err instanceof Error ? err.message : err}`);
      }
    }
    return ticker;
  } catch (err) {
    // OKX pode devolver 429 para o IP do Worker. CoinPaprika cobre preço + market cap + dominância.
    console.error(`[price] OKX falhou, usando CoinPaprika: ${err instanceof Error ? err.message : err}`);
    return await deduped("cp:ticker", () => fetchCPTicker());
  }
}

async function getCachedPrice(kv: KVNamespace): Promise<{ data: PriceSnapshot; cacheAge: number } | null> {
  const entry = await kvGetJSON<CachedPrice>(kv, PRICE_KEY);
  if (!entry || !entry.data) return null;
  return { data: entry.data, cacheAge: Date.now() - new Date(entry.cached_at).getTime() };
}

async function putCachedPrice(kv: KVNamespace, ticker: PriceSnapshot): Promise<void> {
  // TTL longo (1h) + janela de frescor curta (60s): o KV so reescreve quando
  // ha dado novo, mas o ultimo valor sobrevive 1h para servir de stale em outage
  await kv.put(PRICE_KEY, JSON.stringify({ data: ticker, cached_at: new Date().toISOString() }), {
    expirationTtl: 3600,
  });
}

priceRoutes.get("/latest", async (c) => {
  const respondStale = (cached: PriceSnapshot | null) => {
    if (cached) {
      return c.json({
        success: true,
        data: { ...cached, stale: true },
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<PriceSnapshot & { stale?: boolean }>);
    }
    return c.json(
      { success: false, data: null, error: "Fontes de preço indisponíveis", timestamp: new Date().toISOString() },
      502
    );
  };

  try {
    // Cache KV fresco evita fetch externo
    const cached = await getCachedPrice(c.env.KV);
    if (cached && cached.cacheAge < PRICE_FRESH_MS) {
      return c.json({
        success: true,
        data: cached.data,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<PriceSnapshot>);
    }

    // OKX primária, CoinPaprika fallback (market cap e dominância já vêm dela)
    let ticker: PriceSnapshot;
    try {
      ticker = await fetchTickerWithFallback();
    } catch (err) {
      console.error(`[price] todas as fontes falharam: ${err instanceof Error ? err.message : err}`);
      return respondStale(cached?.data ?? null);
    }

    await putCachedPrice(c.env.KV, ticker);

    return c.json({
      success: true,
      data: ticker,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse<PriceSnapshot>);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar preço";
    return c.json(
      { success: false, data: null, error: message, timestamp: new Date().toISOString() },
      502
    );
  }
});

priceRoutes.get("/history", async (c) => {
  try {
    const interval = (c.req.query("interval") || "1d") as "1h" | "4h" | "1d" | "1w";
    const limit = Math.min(parseInt(c.req.query("limit") || "30", 10), 365);

    // Cache KV escalonado por intervalo
    const ttl = OHLCV_TTL[interval] ?? 3600;
    const cacheKey = `btc:ohlcv:${interval}:${limit}`;
    const cached = await kvGetJSON<{ data: OHLCV[]; ts: string }>(c.env.KV, cacheKey);
    if (cached) {
      const age = Date.now() - new Date(cached.ts).getTime();
      if (age < ttl * 1000) {
        return c.json({
          success: true,
          data: cached.data,
          timestamp: new Date().toISOString(),
        } satisfies ApiResponse<OHLCV[]>);
      }
    }

    let data: OHLCV[];
    try {
      data = await deduped(`okx:ohlcv:${interval}:${limit}`, () => fetchOKXOHLCV(interval, limit));
    } catch (err) {
      // Fallback: CoinPaprika
      console.error(`[price] OKX OHLCV falhou, usando CoinPaprika: ${err instanceof Error ? err.message : err}`);
      data = await deduped(`cp:ohlcv:${interval}:${limit}`, () => fetchOHLCV(interval, limit));
    }

    await c.env.KV.put(cacheKey, JSON.stringify({ data, ts: new Date().toISOString() }), {
      expirationTtl: ttl,
    });

    return c.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse<OHLCV[]>);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar histórico";
    return c.json(
      { success: false, data: null, error: message, timestamp: new Date().toISOString() },
      502
    );
  }
});

priceRoutes.get("/current", async (c) => {
  try {
    // Compõe de cache primeiro; busca só o que faltar
    const cachedPrice = await getCachedPrice(c.env.KV);
    const cachedFg = await kvGetJSON<{ value: number; classification: string; timestamp: string }>(
      c.env.KV, "sentiment:fear-greed"
    );

    const priceFresh = cachedPrice && cachedPrice.cacheAge < PRICE_FRESH_MS;
    const fgFresh = cachedFg &&
      Date.now() - new Date(cachedFg.timestamp).getTime() < 55 * 60_000;

    const [ticker, fg] = await Promise.all([
      priceFresh
        ? Promise.resolve(cachedPrice.data)
        : fetchTickerWithFallback().then(async (t) => {
            await putCachedPrice(c.env.KV, t);
            return t;
          }).catch(() => cachedPrice?.data ?? null),
      fgFresh
        ? Promise.resolve(cachedFg)
        : fetchFearGreedToday().then(async (f) => {
            await c.env.KV.put("sentiment:fear-greed", JSON.stringify(f), { expirationTtl: 3600 });
            return f;
          }).catch(() => cachedFg),
    ]);

    if (!ticker) {
      return c.json(
        { success: false, data: null, error: "Fontes de preço indisponíveis", timestamp: new Date().toISOString() },
        502
      );
    }

    return c.json({
      success: true,
      data: {
        ...ticker,
        fear_greed: fg,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar snapshot";
    return c.json(
      { success: false, data: null, error: message, timestamp: new Date().toISOString() },
      502
    );
  }
});
