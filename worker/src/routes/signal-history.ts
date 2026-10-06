// Aureus — Rota de histórico prospectivo de sinais (track record)
// Leitura PÚBLICA: não requer autenticação. Escrita = cron só (insert via service).
//
// Endpoints:
//   GET /api/signals/history/summary — métricas agregadas (nulls honestos)
//   GET /api/signals/history?limit=&offset= — lista de oportunidades com status

import { Hono } from "hono";
import type { Env } from "../types";
import {
  getTrackRecordSummary,
  listTrackRecordSignals,
} from "../signal-history-service";
import { HISTORY_STRATEGY_VERSION, HISTORY_RESOLVER_VERSION } from "../lib/signal-history";

const app = new Hono<{ Bindings: Env }>();

app.get("/summary", async (c) => {
  const summary = await getTrackRecordSummary(c.env.DB);
  return c.json({
    ok: true,
    timestamp: new Date().toISOString(),
    methodology: {
      strategy_version: summary.strategy_version,
      engine_version: summary.engine_version,
      resolver_version: HISTORY_RESOLVER_VERSION,
      methodology_version: summary.methodology_version,
      notes: [
        "Métricas calculadas somente sobre oportunidades 100% resolvidas (closed_fraction >= 0.9999).",
        "Ausência de amostra é retornada como null — nunca zero artificial.",
        "Profit_factor = null significa nenhuma perda registrada ainda (infinito simbólico).",
      ],
    },
    counts: {
      total: summary.total,
      resolved: summary.resolved,
      pending: summary.pending,
    },
    period: {
      start: summary.period_start,
      end: summary.period_end,
    },
    n_strategy_versions: summary.n_strategy_versions,
    last_resolver_version: summary.last_resolver_version,
    metrics: {
      win_rate: summary.win_rate,
      avg_net_pct: summary.avg_net_pct,
      avg_gross_pct: summary.avg_gross_pct,
      expectancy_pct: summary.expectancy_pct,
      profit_factor: summary.profit_factor,
      best_net_pct: summary.best_net_pct,
      worst_net_pct: summary.worst_net_pct,
    },
  });
});

app.get("/", async (c) => {
  const limit = Math.max(1, Math.min(200, parseInt(c.req.query("limit") || "50", 10)));
  const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10));
  const rows = await listTrackRecordSignals(c.env.DB, limit, offset);
  return c.json({
    ok: true,
    timestamp: new Date().toISOString(),
    limit,
    offset,
    history_strategy_version: HISTORY_STRATEGY_VERSION,
    data: rows.map(r => ({
      signal_id: r.signal_id,
      strategy: r.strategy,
      timeframe: r.timeframe,
      direction: r.direction,
      verdict: r.verdict,
      generated_at: r.generated_at,
      expires_at: r.expires_at,
      entry_price: r.entry_price,
      stop_loss: r.stop_loss,
      target_1: r.target_1,
      target_2: r.target_2,
      conviction: r.conviction,
      risk_reward: r.risk_reward,
      strategy_version: r.strategy_version,
      engine_version: r.engine_version,
      price_source: r.price_source,
      price_interval: r.price_interval,
      closed_fraction: (r as any).closed_fraction ?? 0,
      overall_status: (r as any).overall_status ?? "unknown",
      outcomes: (() => {
        try {
          const raw = (r as any).outcomes;
          return raw ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      })(),
    })),
  });
});

export const signalHistoryRoutes = app;
