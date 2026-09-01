// BTC Radar — Rotas de sentimento

import { Hono } from "hono";
import type { Env } from "../types";
import { fetchFearGreedToday, fetchFearGreedHistory } from "../lib/alternativeme";
import { kvGetJSON } from "../lib/kv-helpers";
import type { ApiResponse, FearGreedData } from "../types";

export const sentimentRoutes = new Hono<{ Bindings: Env }>();

sentimentRoutes.get("/fear-greed", async (c) => {
  try {
    const cached = await kvGetJSON<FearGreedData>(c.env.KV, "sentiment:fear-greed");
    if (cached) {
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      // Janela alinhada ao TTL de 3600s do KV: aceita ate 55 min
      if (cacheAge < 55 * 60_000) {
        return c.json({
          success: true,
          data: cached,
          timestamp: new Date().toISOString(),
        } satisfies ApiResponse<FearGreedData>);
      }
    }

    const data = await fetchFearGreedToday();
    await c.env.KV.put("sentiment:fear-greed", JSON.stringify(data), { expirationTtl: 3600 });

    return c.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse<FearGreedData>);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar Fear & Greed";
    return c.json(
      { success: false, data: null, error: message, timestamp: new Date().toISOString() },
      502
    );
  }
});

sentimentRoutes.get("/fear-greed/history", async (c) => {
  try {
    const days = Math.min(parseInt(c.req.query("days") || "30", 10), 365);

    // Historico muda devagar, cache de 6h
    const cacheKey = `sentiment:fg-history:${days}`;
    const cached = await kvGetJSON<{ data: FearGreedData[]; ts: string }>(c.env.KV, cacheKey);
    if (cached && Date.now() - new Date(cached.ts).getTime() < 6 * 3600_000) {
      return c.json({
        success: true,
        data: cached.data,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<FearGreedData[]>);
    }

    const data = await fetchFearGreedHistory(days);
    await c.env.KV.put(cacheKey, JSON.stringify({ data, ts: new Date().toISOString() }), {
      expirationTtl: 6 * 3600,
    });

    return c.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse<FearGreedData[]>);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar histórico Fear & Greed";
    return c.json(
      { success: false, data: null, error: message, timestamp: new Date().toISOString() },
      502
    );
  }
});
