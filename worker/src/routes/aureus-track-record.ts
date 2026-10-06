import { Hono } from "hono";
import type { Env } from "../types";
import { DEFAULT_AUREUS_POLICY } from "../lib/aureus-portfolio";

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
const validTime = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
function validateSnapshot(row: TrackSnapshotRow): TrackSnapshotRow {
  if (!validTime(row.timestamp)) throw new Error("Timestamp de snapshot inválido");
  for (const field of ["nav", "cash", "position_value", "exposure", "quantity", "realized_pnl", "unrealized_pnl", "total_fees", "cycle"] as const) {
    if (!finite(row[field])) throw new Error(`Snapshot inválido, campo ${field}`);
  }
  if (row.nav <= 0 || row.cash < 0 || row.position_value < 0 || row.quantity < 0 || row.total_fees < 0 || row.exposure < 0 || row.exposure > 1 || !Number.isSafeInteger(row.cycle) || row.cycle < 0) throw new Error("Snapshot fora dos limites financeiros");
  return row;
}

function parseState(state: any): TrackRecordData["state"] {
  if (!state) return null;
  for (const field of ["cash", "realized_pnl", "total_fees", "cycle"]) if (!finite(state[field])) throw new Error("Estado financeiro inválido");
  if (state.cash < 0 || state.total_fees < 0 || !Number.isSafeInteger(state.cycle) || state.cycle < 0 || !validTime(state.updated_at) || typeof state.engine_version !== "string" || !state.engine_version) throw new Error("Estado inválido");
  const position = state.position_json === null ? null : JSON.parse(state.position_json);
  if (position !== null) {
    if (typeof position !== "object" || Array.isArray(position)) throw new Error("Posição inválida");
    for (const key of ["quantity", "originalQuantity", "entryExecPrice", "stopLoss"]) if (!finite(position[key]) || position[key] <= 0) throw new Error("Posição financeira inválida");
    for (const key of ["target1", "target2"]) if (position[key] !== null && (!finite(position[key]) || position[key] <= 0)) throw new Error("Alvo inválido");
    if (!validTime(position.openedAt) || typeof position.target1Done !== "boolean" || position.quantity > position.originalQuantity || (position.entryFeeRemaining !== undefined && (!finite(position.entryFeeRemaining) || position.entryFeeRemaining < 0))) throw new Error("Posição inválida");
  }
  return { cash: state.cash, position, realized_pnl: state.realized_pnl, total_fees: state.total_fees, cycle: state.cycle, engine_version: state.engine_version, updated_at: state.updated_at };
}

// Paginação por chave estável, com limite superior fixado no início da leitura.
export async function loadTrackSnapshots(db: D1Database): Promise<TrackSnapshotRow[]> {
  const upper = await db.prepare("SELECT timestamp,cycle_key FROM aureus_portfolio_snapshots ORDER BY timestamp DESC,cycle_key DESC LIMIT 1").first<{timestamp:string;cycle_key:string}>();
  if (!upper) return [];
  const rows: TrackSnapshotRow[] = [];
  let timestamp = "", key = "";
  for (;;) {
    const page = await db.prepare("SELECT timestamp,nav,cash,position_value,exposure,quantity,realized_pnl,unrealized_pnl,total_fees,cycle,cycle_key FROM aureus_portfolio_snapshots WHERE (timestamp > ? OR (timestamp = ? AND cycle_key > ?)) AND (timestamp < ? OR (timestamp = ? AND cycle_key <= ?)) ORDER BY timestamp ASC,cycle_key ASC LIMIT 1000")
      .bind(timestamp, timestamp, key, upper.timestamp, upper.timestamp, upper.cycle_key).all<TrackSnapshotRow & {cycle_key:string}>();
    if (!page.success) throw new Error("Falha na leitura dos snapshots");
    const result = page.results ?? [];
    rows.push(...result.map(({cycle_key: _key, ...row}) => row));
    if (result.length < 1000) return rows;
    timestamp = result[result.length - 1]!.timestamp;
    key = result[result.length - 1]!.cycle_key;
  }
}

export function computeTrackRecord(rows: TrackSnapshotRow[]): Pick<TrackRecordData, "available" | "reason" | "metrics" | "series" | "benchmark"> {
  const clean = rows.map(validateSnapshot)
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

  let peak = DEFAULT_AUREUS_POLICY.initialNav;
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
      cumulative_return_pct: ((last.nav / DEFAULT_AUREUS_POLICY.initialNav) - 1) * 100,
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
      loadTrackSnapshots(c.env.DB),
      Promise.resolve().then(() => c.env.DB.prepare(
        "SELECT cash,position_json,realized_pnl,total_fees,cycle,engine_version,updated_at FROM aureus_portfolio_state WHERE id=1"
      ).first<any>()),
      Promise.resolve().then(() => c.env.DB.prepare(
        "SELECT cycle_key,evaluated_at,candle_timestamp,action,engine_version,created_at FROM aureus_portfolio_cycles ORDER BY evaluated_at DESC LIMIT 30"
      ).all()),
      Promise.resolve().then(() => c.env.DB.prepare(
        "SELECT id,cycle_key,event_index,event_type,event_json,created_at FROM aureus_portfolio_events ORDER BY id DESC LIMIT 50"
      ).all()),
    ]);

    const computed = computeTrackRecord(snapshots);
    const parsedState = parseState(state);
    if (!cycles.success || !events.success) throw new Error("Falha na leitura do histórico");

    return c.json({
      success: true,
      data: {
        ...computed,
        state: parsedState,
        recent_cycles: cycles.results ?? [],
        recent_events: (events.results ?? []).map((e: any) => ({
          ...e,
          event: (() => { const event = JSON.parse(e.event_json); if (!event || typeof event !== "object" || Array.isArray(event) || !validTime(e.created_at)) throw new Error("Evento inválido"); return event; })(),
          event_json: undefined,
        })),
      } satisfies TrackRecordData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Falha interna no Track Record", error);
    return c.json({
      success: false,
      data: null,
      error: "Falha ao carregar Track Record.",
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

