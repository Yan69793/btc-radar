// BTC Radar — Rotas de derivativos
// GET /api/derivatives — funding rate, open interest, long/short ratio (OKX)

import { Hono } from "hono";
import type { Env } from "../types";

export const derivativesRoutes = new Hono<{ Bindings: Env }>();

interface DerivativesSnapshot {
  symbol: string;
  funding_rate: number | null;
  funding_rate_annualized: number | null;
  open_interest_usd: number | null;
  open_interest_btc: number | null;
  oi_change_24h_pct: number | null;
  long_short_ratio: number | null;
  timestamp: string;
  source: string;
}

derivativesRoutes.get("/", async (c) => {
  try {
    const cacheKey = "btc:derivatives:v1";
    const cached = await c.env.KV.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      const age = Date.now() - new Date(data.timestamp).getTime();
      // Janela alinhada ao TTL de 600s: aceita ate 9 min
      if (age < 540_000) {
        return c.json({ success: true, data, timestamp: new Date().toISOString() });
      }
    }

    const now = new Date().toISOString();
    const snapshot: DerivativesSnapshot = {
      symbol: "BTC-USDT-SWAP",
      funding_rate: null,
      funding_rate_annualized: null,
      open_interest_usd: null,
      open_interest_btc: null,
      oi_change_24h_pct: null,
      long_short_ratio: null,
      timestamp: now,
      source: "OKX",
    };

    // Funding rate + Open Interest em paralelo (2 chamadas OKX, sem serial)
    const [frJson, oiJson] = await Promise.allSettled([
      fetch("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP").then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`funding-rate HTTP ${r.status}`))
      ),
      fetch("https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP").then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`open-interest HTTP ${r.status}`))
      ),
    ]);

    if (frJson.status === "fulfilled") {
      const j = frJson.value as { code: string; data: Array<{ fundingRate: string }> };
      if (j.code === "0" && j.data?.[0]) {
        const rate = parseFloat(j.data[0].fundingRate);
        snapshot.funding_rate = rate;
        // Funding rate a cada 8h → 3x por dia → anualizado
        snapshot.funding_rate_annualized = Math.round(rate * 3 * 365 * 100 * 100) / 100;
      }
    }

    if (oiJson.status === "fulfilled") {
      const j = oiJson.value as {
        code: string;
        data: Array<{ oi: string; oiCcy: string; oiUsd: string }>;
      };
      if (j.code === "0" && j.data?.[0]) {
        const oi = j.data[0];
        // oi = contratos (ex: 3.1M), oiCcy = BTC (ex: 31.8k), oiUsd = USD (ex: $2.0B)
        snapshot.open_interest_btc = parseFloat(oi.oiCcy);
        snapshot.open_interest_usd = parseFloat(oi.oiUsd);
      }
    }

    // L/S ratio nao disponivel via OKX public API (requer conta)
    // Dados de funding rate + OI ja fornecem boa leitura do mercado de futuros

    await c.env.KV.put(cacheKey, JSON.stringify(snapshot), { expirationTtl: 600 });

    return c.json({ success: true, data: snapshot, timestamp: now });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar derivativos";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 502);
  }
});
