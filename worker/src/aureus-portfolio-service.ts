import type { D1Database } from "@cloudflare/workers-types";
import {
  AUREUS_PORTFOLIO_VERSION,
  DEFAULT_AUREUS_POLICY,
  evaluatePortfolioCycle,
  initialPortfolioState,
  type CycleInput,
  type CycleResult,
  type PortfolioAction,
  type PortfolioState,
} from "./lib/aureus-portfolio";
import type { ConsensusResult } from "./lib/consensus";
import type { SignalDocument } from "./types";

interface StateRow {
  cash: number;
  position_json: string | null;
  realized_pnl: number;
  total_fees: number;
  cycle: number;
}

export interface AureusCyclePersistResult {
  skipped: boolean;
  reason?: "duplicate" | "stale";
  cycleKey: string;
  result: CycleResult | null;
}

export function chooseExecutionSignal(
  signals: SignalDocument[],
  action: PortfolioAction,
): SignalDocument | null {
  if (action !== "COMPRAR") return null;
  const eligible = signals
    .filter((s) => s.verdict === "COMPRAR" && s.entry_price != null && s.stop_loss != null)
    .sort((a, b) => b.conviction - a.conviction || a.signal_id.localeCompare(b.signal_id));
  return eligible[0] ?? null;
}

export function buildPortfolioCycleKey(candleTimestamp: string): string {
  return "aureus:" + candleTimestamp;
}

export async function loadAureusPortfolioState(DB: D1Database): Promise<PortfolioState> {
  const row = await DB.prepare(
    "SELECT cash, position_json, realized_pnl, total_fees, cycle FROM aureus_portfolio_state WHERE id = 1"
  ).first<StateRow>();
  if (!row) return initialPortfolioState();
  return {
    cash: Number(row.cash),
    position: row.position_json ? JSON.parse(row.position_json) : null,
    realizedPnl: Number(row.realized_pnl),
    totalFees: Number(row.total_fees),
    cycle: Number(row.cycle),
  };
}

export async function persistAureusPortfolioCycle(opts: {
  DB: D1Database;
  consensus: ConsensusResult;
  signals: SignalDocument[];
  candle: CycleInput["candle"];
  evaluatedAt: string;
}): Promise<AureusCyclePersistResult> {
  const { DB, consensus, signals, candle, evaluatedAt } = opts;
  const action = consensus.verdict as PortfolioAction;
  const cycleKey = buildPortfolioCycleKey(candle.timestamp);

  const execSignal = chooseExecutionSignal(signals, action);
  const input: CycleInput = {
    timestamp: evaluatedAt,
    action,
    candle,
    stopLoss: execSignal?.stop_loss ?? null,
    target1: execSignal?.target_1 ?? null,
    target2: execSignal?.target_2 ?? null,
  };

  if (!Number.isFinite(Date.parse(candle.timestamp)) || !Number.isFinite(Date.parse(evaluatedAt))) {
    throw new Error("timestamp inválido no ciclo Aureus");
  }
  // O token identifica exclusivamente a tentativa que conquistou a revisão do estado.
  // Todos os efeitos do batch dependem desse mesmo token, não de um lock no isolate.
  for (let attempt = 0; attempt < 5; attempt++) {
  const exists = await DB.prepare(
    "SELECT cycle_key FROM aureus_portfolio_cycles WHERE cycle_key = ? LIMIT 1"
  ).bind(cycleKey).first<{ cycle_key: string }>();
  if (exists) return { skipped: true, reason: "duplicate", cycleKey, result: null };
  const previous = await loadAureusPortfolioState(DB);
  const result = evaluatePortfolioCycle(previous, input, DEFAULT_AUREUS_POLICY);
  const now = new Date().toISOString();
  const inputJson = JSON.stringify({ ...input, persistence_token: crypto.randomUUID() });
  const ownsCycle = "EXISTS (SELECT 1 FROM aureus_portfolio_cycles WHERE cycle_key = ? AND input_json = ?)";

  const statements = [
    DB.prepare(
      `INSERT INTO aureus_portfolio_cycles
       (cycle_key, evaluated_at, candle_timestamp, action, consensus_json, input_json, result_json, engine_version, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE COALESCE((SELECT cycle FROM aureus_portfolio_state WHERE id = 1), 0) = ?
          AND NOT EXISTS (SELECT 1 FROM aureus_portfolio_cycles WHERE cycle_key = ?)
          AND NOT EXISTS (SELECT 1 FROM aureus_portfolio_cycles WHERE julianday(candle_timestamp) >= julianday(?))`
    ).bind(
      cycleKey, evaluatedAt, candle.timestamp, action,
      JSON.stringify(consensus), inputJson, JSON.stringify(result),
      AUREUS_PORTFOLIO_VERSION, now, previous.cycle, cycleKey, candle.timestamp,
    ),
    DB.prepare(
      `INSERT INTO aureus_portfolio_state
       (id, cash, position_json, realized_pnl, total_fees, cycle, engine_version, updated_at)
        SELECT 1, ?, ?, ?, ?, ?, ?, ? WHERE ${ownsCycle}
       ON CONFLICT(id) DO UPDATE SET
         cash=excluded.cash,
         position_json=excluded.position_json,
         realized_pnl=excluded.realized_pnl,
         total_fees=excluded.total_fees,
         cycle=excluded.cycle,
         engine_version=excluded.engine_version,
         updated_at=excluded.updated_at`
    ).bind(
      result.state.cash,
      result.state.position ? JSON.stringify(result.state.position) : null,
      result.state.realizedPnl,
      result.state.totalFees,
      result.state.cycle,
      AUREUS_PORTFOLIO_VERSION,
      now,
      cycleKey, inputJson,
    ),
    DB.prepare(
      `INSERT INTO aureus_portfolio_snapshots
       (cycle_key, timestamp, nav, cash, position_value, exposure, quantity, realized_pnl, unrealized_pnl, total_fees, cycle, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${ownsCycle}`
    ).bind(
      cycleKey, result.snapshot.timestamp, result.snapshot.nav, result.snapshot.cash,
      result.snapshot.positionValue, result.snapshot.exposure, result.snapshot.quantity,
      result.snapshot.realizedPnl, result.snapshot.unrealizedPnl, result.snapshot.totalFees,
      result.snapshot.cycle, now, cycleKey, inputJson,
    ),
  ];

  for (let i = 0; i < result.events.length; i++) {
    statements.push(
      DB.prepare(
        `INSERT INTO aureus_portfolio_events
         (cycle_key, event_index, event_type, event_json, created_at)
          SELECT ?, ?, ?, ?, ? WHERE ${ownsCycle}`
      ).bind(cycleKey, i, result.events[i]!.type, JSON.stringify(result.events[i]), now, cycleKey, inputJson),
    );
  }

  const persisted = await DB.batch(statements);
  if (persisted[0]?.meta.changes === 1) return { skipped: false, cycleKey, result };
  const newer = await DB.prepare(
    "SELECT cycle_key FROM aureus_portfolio_cycles WHERE julianday(candle_timestamp) >= julianday(?) LIMIT 1"
  ).bind(candle.timestamp).first<{ cycle_key: string }>();
  if (newer) return { skipped: true, reason: newer.cycle_key === cycleKey ? "duplicate" : "stale", cycleKey, result: null };
  // Outro candle avançou o estado. Recalcula sobre a revisão atual antes de tentar de novo.
  }
  throw new Error("conflito de concorrência Aureus após 5 tentativas");
}
