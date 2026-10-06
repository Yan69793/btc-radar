import { Hono } from "hono";
import type { Env } from "../types";

export interface TrackSnapshotRow {
  timestamp: string;
  nav: number;
  cash: number;
  position_value: number;
  exposure: number;
  quantity: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_fees: number;
  cycle: number;
}

export interface TrackRecordData {
  available: boolean;
  reason: string | null;
  metrics: {
    nav: number | null;
    cumulative_return_pct: number | null;
    max_drawdown_pct: number | null;
    exposure_pct: number | null;
    realized_pnl: number | null;
    unrealized_pnl: number | null;
    total_fees: number | null;
    cycle: number | null;
  };
  state: {
    cash: number;
    position: unknown | null;
    realized_pnl: number;
    total_fees: number;
    cycle: number;
    engine_version: string;
    updated_at: string;
  } | null;
  series: Array<TrackSnapshotRow & { drawdown_pct: number }>;
  recent_cycles: unknown[];
  recent_events: unknown[];
  benchmark: { available: false; series: null; reason: string };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function computeTrackRecord(rows: TrackSnapshotRow[]): Pick<TrackRecordData, "available" | "reason" | "metrics" | "series" | "benchmark"> {
  const clean = rows
    .filter((r) => Boolean(r.timestamp) && finite(Number(r.nav)) && Number(r.nav) > 0)
    .map((r) => ({
      ...r,
      nav: Number(r.nav),
      cash: Number(r.cash),
      position_value: Number(r.position_value),
      exposure: Number(r.exposure),
      quantity: Number(r.quantity),
      realized_pnl: Number(r.realized_pnl),
      unrealized_pnl: Number(r.unrealized_pnl),
      total_fees: Number(r.total_fees),
      cycle: Number(r.cycle),
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const benchmark = {
    available: false as const,
    series: null,
    reason: "Benchmark BTC indisponível sem série canônica alinhada aos mesmos timestamps.",
  };

  if (clean.length === 0) {
    return {
      available: false,
      reason: "Ainda não há snapshots válidos do Portfolio Engine.",
      metrics: {
        nav: null, cumulative_return_pct: null, max_drawdown_pct: null, exposure_pct: null,
        realized_pnl: null, unrealized_pnl: null, total_fees: null, cycle: null,
      },
      series: [],
      benchmark,
    };
  }

  const first = clean[0]!;
  let peak = first.nav;
  let maxDrawdown = 0;
  const series = clean.map((row) => {
    peak = Math.max(peak, row.nav);
    const dd = peak > 0 ? ((row.nav / peak) - 1) * 100 : 0;
    maxDrawdown = Math.min(maxDrawdown, dd);
    return { ...row, drawdown_pct: dd };
  });
  const last = series[series.length - 1]!;

  return {
    available: true,
    reason: null,
    metrics: {
      nav: last.nav,
      cumulative_return_pct: ((last.nav / first.nav) - 1) * 100,
      max_drawdown_pct: maxDrawdown,
      exposure_pct: last.exposure * 100,
      realized_pnl: last.realized_pnl,
      unrealized_pnl: last.unrealized_pnl,
      total_fees: last.total_fees,
      cycle: last.cycle,
    },
    series,
    benchmark,
  };
}

export const aureusTrackRecordRoutes = new Hono<{ Bindings: Env }>();

aureusTrackRecordRoutes.get("/", async (c) => {
  try {
    const [snapshots, state, cycles, events] = await Promise.all([
      c.env.DB.prepare(
        "SELECT timestamp,nav,cash,position_value,exposure,quantity,realized_pnl,unrealized_pnl,total_fees,cycle FROM aureus_portfolio_snapshots ORDER BY timestamp ASC LIMIT 2000"
      ).all<TrackSnapshotRow>(),
      c.env.DB.prepare(
        "SELECT cash,position_json,realized_pnl,total_fees,cycle,engine_version,updated_at FROM aureus_portfolio_state WHERE id=1"
      ).first<any>(),
      c.env.DB.prepare(
        "SELECT cycle_key,evaluated_at,candle_timestamp,action,engine_version,created_at FROM aureus_portfolio_cycles ORDER BY evaluated_at DESC LIMIT 30"
      ).all(),
      c.env.DB.prepare(
        "SELECT id,cycle_key,event_index,event_type,event_json,created_at FROM aureus_portfolio_events ORDER BY id DESC LIMIT 50"
      ).all(),
    ]);

    const computed = computeTrackRecord(snapshots.results ?? []);
    const parsedState = state ? {
      cash: Number(state.cash),
      position: state.position_json ? JSON.parse(state.position_json) : null,
      realized_pnl: Number(state.realized_pnl),
      total_fees: Number(state.total_fees),
      cycle: Number(state.cycle),
      engine_version: String(state.engine_version),
      updated_at: String(state.updated_at),
    } : null;

    return c.json({
      success: true,
      data: {
        ...computed,
        state: parsedState,
        recent_cycles: cycles.results ?? [],
        recent_events: (events.results ?? []).map((e: any) => ({
          ...e,
          event: (() => { try { return JSON.parse(e.event_json); } catch { return null; } })(),
          event_json: undefined,
        })),
      } satisfies TrackRecordData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return c.json({
      success: false,
      data: null,
      error: error instanceof Error ? error.message : "Falha ao carregar Track Record.",
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

