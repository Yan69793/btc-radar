// BTC Radar — Rotas de noticias
// Fonte primaria: CoinGecko (API publica, sem auth)
// CryptoPanic descontinuado — bloqueia IPs de Cloudflare Workers (WAF)

import { Hono } from "hono";
import type { Env } from "../types";
import { fetchNewsAggregated } from "../lib/news-sources";
import { kvGetJSON } from "../lib/kv-helpers";
import type { ApiResponse, NewsItem } from "../types";

export const newsRoutes = new Hono<{ Bindings: Env }>();

newsRoutes.get("/", async (c) => {
  try {
    const filter = (c.req.query("filter") as "hot" | "bullish" | "bearish" | "important") || "hot";
    const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);

    const cacheKey = `news:v2:${filter}`;
    const cached = await kvGetJSON<NewsItem[]>(c.env.KV, cacheKey);
    if (cached && cached.length > 0) {
      return c.json({
        success: true,
        data: cached,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<NewsItem[]>);
    }

    const data = await fetchNewsAggregated(filter, limit);
    if (data.length > 0) {
      await c.env.KV.put(cacheKey, JSON.stringify(data), { expirationTtl: 900 });
    }

    return c.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    } satisfies ApiResponse<NewsItem[]>);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar noticias";

    // Fallback: cache expirado
    const stale = await kvGetJSON<NewsItem[]>(c.env.KV, "news:v2:hot");
    if (stale && stale.length > 0) {
      return c.json({
        success: true,
        data: stale,
        timestamp: new Date().toISOString(),
      } satisfies ApiResponse<NewsItem[]>);
    }

    return c.json(
      { success: false, data: null, error: message, timestamp: new Date().toISOString() },
      502
    );
  }
});
