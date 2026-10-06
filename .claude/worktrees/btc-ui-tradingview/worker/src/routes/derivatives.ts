// BTC Radar — Rotas de derivativos
// GET /api/derivatives — funding rate, open interest, long/short ratio e liquidações (OKX)

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
  liquidation_recent_count: number | null;
  liquidation_recent_long_count: number | null;
  liquidation_recent_short_count: number | null;
  liquidation_recent_oldest_ts: string | null;
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
      liquidation_recent_count: null,
      liquidation_recent_long_count: null,
      liquidation_recent_short_count: null,
      liquidation_recent_oldest_ts: null,
      timestamp: now,
      source: "OKX",
    };

    const fetchOk = (url: string) =>
      fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));

    // Funding + OI + L/S ratio + liquidações, em paralelo (sem dependência entre si)
    const [frJson, oiJson, lsJson, liqJson] = await Promise.allSettled([
      fetchOk("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP"),
      fetchOk("https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP"),
      fetchOk("https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1H"),
      fetchOk("https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&instId=BTC-USDT-SWAP&state=filled"),
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
        snapshot.open_interest_btc = parseFloat(oi.oiCcy);
        snapshot.open_interest_usd = parseFloat(oi.oiUsd);
      }
    }

    if (lsJson.status === "fulfilled") {
      const j = lsJson.value as { code: string; data: Array<[string, string]> };
      if (j.code === "0" && Array.isArray(j.data) && j.data[0]?.[1]) {
        const ratio = parseFloat(j.data[0][1]);
        if (Number.isFinite(ratio)) snapshot.long_short_ratio = ratio;
      }
    }

    if (liqJson.status === "fulfilled") {
      const j = liqJson.value as {
        code: string;
        data: Array<{ details?: Array<{ posSide?: string; ts?: string }> }>;
      };
      const details = (j.code === "0" && j.data?.[0]?.details) || [];
      if (details.length > 0) {
        snapshot.liquidation_recent_count = details.length;
        snapshot.liquidation_recent_long_count = details.filter((d) => d.posSide === "long").length;
        snapshot.liquidation_recent_short_count = details.filter((d) => d.posSide === "short").length;
        const times = details
          .map((d) => (d.ts ? Number(d.ts) : NaN))
          .filter((t) => Number.isFinite(t));
        if (times.length > 0) {
          snapshot.liquidation_recent_oldest_ts = new Date(Math.min(...times)).toISOString();
        }
      }
    }

    await c.env.KV.put(cacheKey, JSON.stringify(snapshot), { expirationTtl: 600 });

    return c.json({ success: true, data: snapshot, timestamp: now });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar derivativos";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 502);
  }
});
