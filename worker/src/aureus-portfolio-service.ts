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
    .sort((a, b) => b.conviction - a.conviction);
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

  const exists = await DB.prepare(
    "SELECT cycle_key FROM aureus_portfolio_cycles WHERE cycle_key = ? LIMIT 1"
  ).bind(cycleKey).first<{ cycle_key: string }>();
  if (exists) return { skipped: true, cycleKey, result: null };

  const execSignal = chooseExecutionSignal(signals, action);
  const input: CycleInput = {
    timestamp: evaluatedAt,
    action,
    candle,
    stopLoss: execSignal?.stop_loss ?? null,
    target1: execSignal?.target_1 ?? null,
    target2: execSignal?.target_2 ?? null,
  };

  const previous = await loadAureusPortfolioState(DB);
  const result = evaluatePortfolioCycle(previous, input, DEFAULT_AUREUS_POLICY);
  const now = new Date().toISOString();

  const statements = [
    DB.prepare(
      `INSERT INTO aureus_portfolio_cycles
       (cycle_key, evaluated_at, candle_timestamp, action, consensus_json, input_json, result_json, engine_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      cycleKey, evaluatedAt, candle.timestamp, action,
      JSON.stringify(consensus), JSON.stringify(input), JSON.stringify(result),
      AUREUS_PORTFOLIO_VERSION, now,
    ),
    DB.prepare(
      `INSERT INTO aureus_portfolio_state
       (id, cash, position_json, realized_pnl, total_fees, cycle, engine_version, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
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
    ),
    DB.prepare(
      `INSERT INTO aureus_portfolio_snapshots
       (cycle_key, timestamp, nav, cash, position_value, exposure, quantity, realized_pnl, unrealized_pnl, total_fees, cycle, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      cycleKey, result.snapshot.timestamp, result.snapshot.nav, result.snapshot.cash,
      result.snapshot.positionValue, result.snapshot.exposure, result.snapshot.quantity,
      result.snapshot.realizedPnl, result.snapshot.unrealizedPnl, result.snapshot.totalFees,
      result.snapshot.cycle, now,
    ),
  ];

  for (let i = 0; i < result.events.length; i++) {
    statements.push(
      DB.prepare(
        `INSERT INTO aureus_portfolio_events
         (cycle_key, event_index, event_type, event_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(cycleKey, i, result.events[i]!.type, JSON.stringify(result.events[i]), now),
    );
  }

  await DB.batch(statements);
  return { skipped: false, cycleKey, result };
}
