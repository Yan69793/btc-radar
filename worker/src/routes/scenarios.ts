import { Hono } from "hono";
import type { Env, OHLCV } from "../types";
import { computeForwardScenarios } from "../lib/forward-scenarios";

export const scenarioRoutes = new Hono<{ Bindings: Env }>();

scenarioRoutes.get("/", async (c) => {
  try {
    const result = await c.env.DB.prepare(
      `SELECT timestamp, open, high, low, close, volume, interval, source
       FROM prices
       WHERE interval = '1d'
       ORDER BY timestamp ASC
       LIMIT 4000`
    ).all<OHLCV>();

    const candles = (result.results ?? []).map((row) => ({
      timestamp: String(row.timestamp),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      interval: "1d" as const,
      source: String(row.source),
    }));

    const scenarios = computeForwardScenarios(candles);

    return c.json({
      success: true,
      schema: "sz.btc-scenarios.v2",
      generated_at: new Date().toISOString(),
      data: scenarios,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao calcular cenarios empiricos";
    return c.json({
      success: false,
      schema: "sz.btc-scenarios.v2",
      generated_at: new Date().toISOString(),
      data: null,
      error: message,
    }, 500);
  }
});
