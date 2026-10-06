// BTC Radar — Rotas de microestrutura BTC/BRL
// GET /api/market — best bid/ask, midpoint, spread, depth e prêmio vs referência global.
// Fonte local: Mercado Bitcoin (book público). Referência global: CoinPaprika/OKX.

import { Hono } from "hono";
import type { Env } from "../types";
import { fetchMBOrderBook, computeMicrostructure, computeBrlPremium } from "../lib/mercadobitcoin";
import { fetchBRLPrice, fetchTicker as fetchCPTicker } from "../lib/coinpaprika";
import { fetchOKXTicker } from "../lib/okx";
import { qualityScore } from "../lib/market-structure";
import { kvGetJSON } from "../lib/kv-helpers";

export const marketRoutes = new Hono<{ Bindings: Env }>();

const MARKET_KEY = "btc:market:v1";
const FRESH_MS = 30_000; // hot data: book muda rápido
const STALE_MS = 300_000; // último valor válido sobrevive 5 min em outage

interface CachedMarket {
  data: unknown;
  cached_at: string;
}

function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const m = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[m]! : (clean[m - 1]! + clean[m]!) / 2;
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

marketRoutes.get("/", async (c) => {
  const now = Date.now();
  const iso = () => new Date().toISOString();

  const cached = await kvGetJSON<CachedMarket>(c.env.KV, MARKET_KEY);
  const cachedAge = cached ? now - new Date(cached.cached_at).getTime() : Infinity;

  const build = async (): Promise<unknown> => {
    // Book MB + referências globais (BRL e USD) em paralelo, sem dependência.
    const [mbRaw, cpBrl, cpUsd, okxUsd] = await Promise.allSettled([
      fetchMBOrderBook(5000),
      fetchBRLPrice(),
      fetchCPTicker(),
      fetchOKXTicker(),
    ]);

    const book = mbRaw.status === "fulfilled" ? mbRaw.value : null;
    const micro = book
      ? computeMicrostructure(book, 10, iso())
      : computeMicrostructure({ asks: [], bids: [] }, 10, iso());

    const brlPrice = cpBrl.status === "fulfilled" ? cpBrl.value.price : null;
    const cpUsdPrice = cpUsd.status === "fulfilled" ? cpUsd.value.price : null;
    const okxUsdPrice = okxUsd.status === "fulfilled" ? okxUsd.value.price : null;

    const globalUsd = median([cpUsdPrice, okxUsdPrice].filter((v): v is number => v != null));
    const premiumPct = computeBrlPremium(micro.midpoint, brlPrice);

    // Divergência entre as duas fontes globais (para quality score)
    const usdSources = [cpUsdPrice, okxUsdPrice].filter((v): v is number => v != null);
    let discrepancyPct: number | null = null;
    if (usdSources.length >= 2) {
      const lo = Math.min(...usdSources);
      const hi = Math.max(...usdSources);
      const mid = (lo + hi) / 2;
      if (mid > 0) discrepancyPct = ((hi - lo) / mid) * 100;
    }

    const validSources = [book, brlPrice, cpUsdPrice, okxUsdPrice].filter(
      (v) => v != null
    ).length;

    const ageSeconds = micro.midpoint != null ? 0 : null;

    const quality = qualityScore({
      sources: validSources,
      ageSeconds: ageSeconds ?? 0,
      maxAgeSeconds: FRESH_MS / 1000,
      discrepancyPct,
      hasBook: book != null && micro.bestBid != null && micro.bestAsk != null,
      hasDerivatives: false, // derivativos vêm de rota separada (/api/derivatives)
      timestampRegressed: false,
    });

    const status = (ageSeconds ?? 0) > STALE_MS / 1000 ? "stale" : "fresh";

    return {
      asset: "BTC",
      quote: "BRL",
      timestamp: iso(),
      micro: {
        ...micro,
        status,
      },
      global: {
        referenceUsd: globalUsd != null ? Math.round(globalUsd * 100) / 100 : null,
        coinpaprikaUsd: cpUsdPrice,
        okxUsd: okxUsdPrice,
      },
      premium: {
        pct: premiumPct,
        localMid: micro.midpoint,
        referenceBrl: brlPrice,
        source: "CoinPaprika (BRL)",
      },
      quality: {
        score: quality,
        validSources,
        discrepancyPct: discrepancyPct != null ? Math.round(discrepancyPct * 100) / 100 : null,
      },
    };
  };

  if (cached && cachedAge < FRESH_MS) {
    return c.json({
      success: true,
      data: cached.data,
      cached: true,
      timestamp: iso(),
    });
  }

  try {
    const data = await build();
    await c.env.KV.put(MARKET_KEY, JSON.stringify({ data, cached_at: iso() }), {
      expirationTtl: STALE_MS / 1000,
    });
    return c.json({ success: true, data, timestamp: iso() });
  } catch (err) {
    if (cached) {
      return c.json({
        success: true,
        data: { ...(cached.data as object), stale: true },
        cached: true,
        timestamp: iso(),
      });
    }
    const message = err instanceof Error ? err.message : "Erro ao buscar microestrutura";
    return c.json({ success: false, data: null, error: message, timestamp: iso() }, 502);
  }
});
