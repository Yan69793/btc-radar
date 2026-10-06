// Aureus — Testes de SQL REAL do sumário do track record.
//
// MOTIVO: o mock `makeFakeDB` (signal-history-service.test.ts) reimplementa a
// semântica das queries em JavaScript. Por isso ele NÃO pega bug de SQL — foi
// exatamente esse o caso do P0-3: o LEFT JOIN `last_resolver` sem agregação
// multiplicava as linhas por outcome e inflava COUNT(*)/resolved, mas o mock
// contava 1 por sinal e passava. Aqui rodamos o TEXTO SQL real
// (getTrackRecordSummaryQuery + o agregado de trades do service) contra um
// SQLite de verdade (node:sqlite, disponível no Node 22+), com o mesmo schema
// de signals/signal_outcomes. D1 é SQLite, então a query é a mesma.

import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { getTrackRecordSummary } from "../src/signal-history-service";
import {
  DEFAULT_FEE_PER_SIDE,
  HISTORY_RESOLVER_VERSION,
} from "../src/lib/signal-history";

// Schema mínimo, porém fiel, das tabelas tocadas pelas queries do sumário.
const DDL = `
CREATE TABLE signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL DEFAULT 'BTC-USD',
  timeframe TEXT NOT NULL,
  verdict TEXT NOT NULL,
  market_date TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  entry_price REAL,
  stop_loss REAL,
  target_1 REAL,
  target_2 REAL,
  risk_reward REAL,
  conviction REAL,
  strategy TEXT NOT NULL,
  payload TEXT NOT NULL,
  strategy_version TEXT NOT NULL DEFAULT '1.0.0',
  engine_version TEXT NOT NULL DEFAULT '1.0.0',
  price_source TEXT,
  price_interval TEXT,
  direction TEXT,
  expires_at TEXT,
  params_snapshot TEXT,
  prev_hash TEXT,
  entry_hash TEXT
);
CREATE TABLE signal_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL,
  status TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  resolved_price REAL NOT NULL,
  price_source TEXT,
  price_interval TEXT,
  price_timestamp TEXT,
  gross_return_pct REAL,
  net_return_pct REAL,
  position_fraction REAL NOT NULL DEFAULT 1.0,
  ambiguous_resolution INTEGER NOT NULL DEFAULT 0,
  ambiguous_triggers TEXT,
  data_gap INTEGER NOT NULL DEFAULT 0,
  gap_detail TEXT,
  fee_per_side REAL,
  slippage_pct REAL,
  raw_candle_payload TEXT,
  resolved_by_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TEXT NOT NULL,
  UNIQUE(signal_id, status, resolved_at, position_fraction)
);
`;

interface SqlResult {
  success: boolean;
  results: any[];
  meta: { rows_written: number };
}

/**
 * Adaptador D1 sobre node:sqlite. Expõe prepare/bind/run/all/first no mesmo
 * formato que o service espera. Sem reimplementar SQL: quem responde é o motor.
 */
function makeSqliteDB() {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);

  function statement(sql: string, params: unknown[]) {
    return {
      async all(): Promise<SqlResult> {
        try {
          const results = db.prepare(sql).all(...(params as any[]));
          return { success: true, results, meta: { rows_written: 0 } };
        } catch (err) {
          return { success: false, results: [], meta: { rows_written: 0 }, ...(err as object) } as SqlResult;
        }
      },
      async first(): Promise<any> {
        try {
          return db.prepare(sql).get(...(params as any[])) ?? null;
        } catch {
          return null;
        }
      },
      async run(): Promise<SqlResult> {
        try {
          const info = db.prepare(sql).run(...(params as any[]));
          return { success: true, results: [], meta: { rows_written: Number(info.changes) } };
        } catch (err) {
          return { success: false, results: [], meta: { rows_written: 0 }, ...(err as object) } as SqlResult;
        }
      },
    };
  }

  const DB: any = {
    __db: db,
    prepare(sql: string) {
      const bound = (params: unknown[]) => statement(sql, params);
      const direct: any = bound([]);
      direct.bind = (...params: unknown[]) => bound(params);
      return direct;
    },
  };
  return DB;
}

interface SeedSignal {
  signal_id: string;
  strategy: string;
  strategy_version?: string;
  generated_at?: string;
  expires_at?: string;
}

function insertSignal(db: any, s: SeedSignal) {
  db.__db
    .prepare(
      `INSERT OR IGNORE INTO signals
       (signal_id, symbol, timeframe, verdict, market_date, generated_at,
        entry_price, stop_loss, target_1, target_2, risk_reward, conviction,
        strategy, payload, strategy_version, engine_version, price_source,
        price_interval, direction, expires_at, params_snapshot, prev_hash, entry_hash)
       VALUES (?, 'BTC-USD', 'short', 'COMPRAR', '2026-03-01', ?, 100, 90, 110, 120, 1, 7,
        ?, '{}', ?, '1.0.0', 'test', '1h', 'long', ?, NULL, NULL, NULL)`
    )
    .run(
      s.signal_id,
      s.generated_at ?? "2026-03-01T00:00:00.000Z",
      s.strategy,
      s.strategy_version ?? "1.0.0",
      s.expires_at ?? "2026-03-04T00:00:00.000Z",
    );
}

function insertOutcome(
  db: any,
  o: { signal_id: string; status: string; resolved_at: string; fraction: number; net: number | null; gross: number | null },
) {
  db.__db
    .prepare(
      `INSERT INTO signal_outcomes
       (signal_id, status, resolved_at, resolved_price, gross_return_pct, net_return_pct,
        position_fraction, ambiguous_resolution, data_gap, fee_per_side, slippage_pct,
        resolved_by_version, created_at)
       VALUES (?, ?, ?, 100, ?, ?, ?, 0, ?, ?, 0, ?, ?)`
    )
    .run(
      o.signal_id,
      o.status,
      o.resolved_at,
      o.gross,
      o.net,
      o.fraction,
      o.status === "data_gap" ? 1 : 0,
      DEFAULT_FEE_PER_SIDE,
      HISTORY_RESOLVER_VERSION,
      "2026-03-01T00:00:00.000Z",
    );
}

describe("signal-history: SQL real do sumário (node:sqlite)", () => {
  it("P0-3: 1 sinal com 2 outcomes + 1 sinal com 1 outcome contam 2, não 3", async () => {
    const db = makeSqliteDB();
    // A: fechado em target_1 (0.5) + target_2 (0.5) → 2 outcomes.
    insertSignal(db, { signal_id: "sig-A", strategy: "trend_following" });
    insertOutcome(db, { signal_id: "sig-A", status: "target_1", resolved_at: "2026-03-02T00:00:00Z", fraction: 0.5, net: 10, gross: 10 });
    insertOutcome(db, { signal_id: "sig-A", status: "target_2", resolved_at: "2026-03-03T00:00:00Z", fraction: 0.5, net: 20, gross: 20 });
    // B: fechado por stop (1.0) → 1 outcome.
    insertSignal(db, { signal_id: "sig-B", strategy: "rsi" });
    insertOutcome(db, { signal_id: "sig-B", status: "stop_loss", resolved_at: "2026-03-02T12:00:00Z", fraction: 1, net: -10, gross: -10 });

    const summary = await getTrackRecordSummary(db);
    // O bug antigo (JOIN last_resolver sem GROUP BY) devolvia total=3/resolved=3.
    expect(summary.total).toBe(2);
    expect(summary.resolved).toBe(2);
    expect(summary.pending).toBe(0);
    // last_resolver_version continua preenchida (agora por subquery correlacionada).
    expect(summary.last_resolver_version).toBe(HISTORY_RESOLVER_VERSION);
  });

  it("P1-4: sinal puramente data_gap não entra nas métricas de retorno", async () => {
    const db = makeSqliteDB();
    // A: win (t1 10% + t2 20% em 50%/50% → 15% ponderado).
    insertSignal(db, { signal_id: "sig-A", strategy: "trend_following" });
    insertOutcome(db, { signal_id: "sig-A", status: "target_1", resolved_at: "2026-03-02T00:00:00Z", fraction: 0.5, net: 10, gross: 10 });
    insertOutcome(db, { signal_id: "sig-A", status: "target_2", resolved_at: "2026-03-03T00:00:00Z", fraction: 0.5, net: 20, gross: 20 });
    // B: loss (stop 100% → -10%).
    insertSignal(db, { signal_id: "sig-B", strategy: "rsi" });
    insertOutcome(db, { signal_id: "sig-B", status: "stop_loss", resolved_at: "2026-03-02T12:00:00Z", fraction: 1, net: -10, gross: -10 });
    // C: puramente data_gap, sem preço. Terminal (entra em total/resolved) mas
    // NÃO pode virar trade de retorno 0 nas métricas de performance.
    insertSignal(db, { signal_id: "sig-C", strategy: "macd" });
    insertOutcome(db, { signal_id: "sig-C", status: "data_gap", resolved_at: "2026-03-02T00:00:00Z", fraction: 1, net: null, gross: null });

    const summary = await getTrackRecordSummary(db);
    expect(summary.total).toBe(3);
    expect(summary.resolved).toBe(2);
    expect(summary.data_gap).toBe(1);
    expect(summary.pending).toBe(0);
    // Métricas refletem só A e B. Se data_gap contasse como 0: win_rate=1/3 e
    // avg_net=(15-10+0)/3≈1.667. O correto é 1/2 e (15-10)/2 = 2.5.
    expect(summary.win_rate).toBe(0.5);
    expect(summary.avg_net_pct).toBeCloseTo(2.5, 2);
    expect(summary.best_net_pct).toBeCloseTo(15, 1);
    expect(summary.worst_net_pct).toBeCloseTo(-10, 1);
  });

  it("P1-4: só data_gap resolvido → métricas nulas (nunca retorno 0 artificial)", async () => {
    const db = makeSqliteDB();
    insertSignal(db, { signal_id: "sig-gap", strategy: "dca" });
    insertOutcome(db, { signal_id: "sig-gap", status: "data_gap", resolved_at: "2026-03-02T00:00:00Z", fraction: 1, net: null, gross: null });

    const summary = await getTrackRecordSummary(db);
    expect(summary.total).toBe(1);
    expect(summary.resolved).toBe(0);
    expect(summary.data_gap).toBe(1);
    expect(summary.pending).toBe(0);
    expect(summary.win_rate).toBeNull();
    expect(summary.avg_net_pct).toBeNull();
    expect(summary.avg_gross_pct).toBeNull();
    expect(summary.best_net_pct).toBeNull();
    expect(summary.worst_net_pct).toBeNull();
    expect(summary.profit_factor).toBeNull();
  });

  it("P1: last_resolver_version segue cronologia, n?o MAX lexicogr?fico", async () => {
    const db = makeSqliteDB();
    insertSignal(db, { signal_id: "sig-old", strategy: "rsi" });
    insertSignal(db, { signal_id: "sig-new", strategy: "macd" });
    db.__db.prepare(`INSERT INTO signal_outcomes (signal_id,status,resolved_at,resolved_price,position_fraction,ambiguous_resolution,data_gap,resolved_by_version,created_at) VALUES ('sig-old','stop_loss','2026-03-02T00:00:00Z',90,1,0,0,'1.9.0','2026-03-02T00:00:00Z')`).run();
    db.__db.prepare(`INSERT INTO signal_outcomes (signal_id,status,resolved_at,resolved_price,position_fraction,ambiguous_resolution,data_gap,resolved_by_version,created_at) VALUES ('sig-new','stop_loss','2026-03-03T00:00:00Z',90,1,0,0,'1.10.0','2026-03-03T00:00:00Z')`).run();
    const summary = await getTrackRecordSummary(db);
    expect(summary.last_resolver_version).toBe("1.10.0");
  });

});
