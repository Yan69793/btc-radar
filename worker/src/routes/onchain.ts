// BTC Radar — Rotas on-chain
// GET /api/onchain — snapshot on-chain atual
// GET /api/onchain/history — últimos snapshots do D1

import { Hono } from "hono";
import type { Env } from "../types";
import { fetchOnChainSnapshot } from "../lib/mempool";
import { kvGetJSON } from "../lib/kv-helpers";
import type { OnChainSnapshot } from "../types";

export const onchainRoutes = new Hono<{ Bindings: Env }>();

onchainRoutes.get("/", async (c) => {
  try {
    const cacheKey = "btc:onchain:v2";

    // Cache KV: aceita ate 55 min, alinhado ao TTL de 3600 que o cron grava
    // (com janela de 10 min, o cache do cron quase nunca era aceito)
    const cached = await kvGetJSON<OnChainSnapshot>(c.env.KV, cacheKey);
    if (cached) {
      const age = Date.now() - new Date(cached.timestamp).getTime();
      if (age < 55 * 60_000) {
        return c.json({
          success: true,
          data: cached,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const snapshot = await fetchOnChainSnapshot();
    await c.env.KV.put(cacheKey, JSON.stringify(snapshot), { expirationTtl: 900 });

    return c.json({
      success: true,
      data: snapshot,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar dados on-chain";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 502);
  }
});
