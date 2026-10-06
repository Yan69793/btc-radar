// Aureus — Teste de integração (persistência append-only + idempotência + métricas).
// Usa D1 manual via mock in-memory (mesmo padrão de signals-d1-fallback.test.ts e
// user-isolation.test.ts: objeto plano com prepare/bind/all/run/first).
// Regras testadas: 1 (append-only), 7 (não reabre mesma direção aberta),
//   8 (idempotência buildSignalId), 12 (métricas nulls honestas, total/resolved/pending).

import { describe, expect, it, beforeEach } from "vitest";
import type { SignalDocument } from "../src/types";
import {
  enrichSignalForPersist,
  getTrackRecordSummary,
  listTrackRecordSignals,
  persistSignals,
  resolvePendingSignals,
  writeSignalOutcome,
  type PersistedSignalRow,
} from "../src/signal-history-service";
import {
  buildSignalId,
  computeExpiresAt,
  DEFAULT_FEE_PER_SIDE,
  HISTORY_ENGINE_VERSION,
  HISTORY_RESOLVER_VERSION,
  HISTORY_STRATEGY_VERSION,
  TIMEFRAME_EXPIRATION_HOURS,
  type OutcomeStatus,
} from "../src/lib/signal-history";
import type { OHLCV } from "../src/types";

/**
 * Mock do D1Database em memória. Roda SQL via regex (suficiente para testar
 * queries do módulo). Para insert SELECT/UPDATE com regras complexas, usa
 * arrays em memória e resolve o WHERE esperado (padrão esperado das queries
 * do queries.ts usadas em signal-history-service.ts).
 */
type FakeDB = ReturnType<typeof makeFakeDB>;
function makeFakeDB() {
  const signals: any[] = [];
  const outcomes: any[] = [];
  const prices: any[] = [];

  function rowToOutcome(o: any) {
    return o;
  }

  function insertSignal(values: any[]) {
    // ORdem de campos em insertSignalQuery:
    // signal_id, symbol, timeframe, verdict, market_date, generated_at, entry_price, stop_loss,
    // target_1, target_2, risk_reward, conviction, strategy, payload,
    // strategy_version, engine_version, price_source, price_interval, direction, expires_at, params_snapshot, prev_hash, entry_hash
    const keys = ["signal_id","symbol","timeframe","verdict","market_date","generated_at","entry_price","stop_loss","target_1","target_2","risk_reward","conviction","strategy","payload","strategy_version","engine_version","price_source","price_interval","direction","expires_at","params_snapshot","prev_hash","entry_hash"];
    const row: any = {};
    keys.forEach((k, i) => (row[k] = values[i]));
    if (signals.some(s => s.signal_id === row.signal_id)) {
      return { success: true, meta: { rows_written: 0 } };
    }
    signals.push(row);
    return { success: true, meta: { rows_written: 1 } };
  }

  function insertOutcome(values: any[]) {
    const keys = ["signal_id","status","resolved_at","resolved_price","price_source","price_interval","price_timestamp","gross_return_pct","net_return_pct","position_fraction","ambiguous_resolution","ambiguous_triggers","data_gap","gap_detail","fee_per_side","slippage_pct","raw_candle_payload","resolved_by_version","created_at"];
    const row: any = {};
    keys.forEach((k, i) => (row[k] = values[i]));
    // UNIQUE idx: (signal_id, status, resolved_at, position_fraction)
    const exists = outcomes.some(o =>
      o.signal_id === row.signal_id && o.status === row.status &&
      o.resolved_at === row.resolved_at && o.position_fraction === row.position_fraction
    );
    if (exists) return { success: true, meta: { rows_written: 0 } };
    outcomes.push(row);
    return { success: true, meta: { rows_written: 1 } };
  }

  function lastSignalWithFraction(params: any[]) {
    const [strategy, timeframe, direction, strategyVersion] = params;
    const matched = signals
      .filter(s => s.strategy === strategy && s.timeframe === timeframe && s.direction === direction && s.strategy_version === strategyVersion)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
    if (!matched) return null as any;
    const cf = outcomes.filter(o => o.signal_id === matched.signal_id && ["target_1","target_2","stop_loss","expired","data_gap"].includes(o.status))
      .reduce((acc, o) => acc + Number(o.position_fraction || 0), 0);
    return { ...matched, closed_fraction: cf };
  }

  function pendingSignals() {
    return signals.filter(s => ["long","short"].includes(s.direction) && s.entry_price != null).filter(s => {
      const totalFrac = outcomes
        .filter(o => o.signal_id === s.signal_id && ["target_1","target_2","stop_loss","expired","data_gap"].includes(o.status))
        .reduce((acc, o) => acc + Number(o.position_fraction || 0), 0);
      const fullyByStop = outcomes.some(o => o.signal_id === s.signal_id && ["expired","stop_loss","data_gap"].includes(o.status) && Number(o.position_fraction) >= 0.9999);
      return !(totalFrac >= 0.9999) && !fullyByStop;
    });
  }

  function seriesInRange(params: any[]) {
    const [interval, start, end] = params;
    return prices.filter(p => p.interval === interval && p.timestamp >= start && p.timestamp <= end)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  function summaryQuery() {
    const list = signals.filter(s => ["long","short"].includes(s.direction) && s.entry_price != null);
    const withStatus = list.map(s => {
      const priceCf = outcomes.filter(o => o.signal_id === s.signal_id && ["target_1","target_2","stop_loss","expired"].includes(o.status))
        .reduce((acc, o) => acc + Number(o.position_fraction || 0), 0);
      const gapCf = outcomes.filter(o => o.signal_id === s.signal_id && o.status === "data_gap")
        .reduce((acc, o) => acc + Number(o.position_fraction || 0), 0);
      const closed = priceCf >= 0.9999;
      const isGap = !closed && gapCf > 0;
      const lastRes = [...outcomes.filter(o => o.signal_id === s.signal_id)].sort((a, b) => (b.created_at || b.resolved_at).localeCompare(a.created_at || a.resolved_at))[0];
      return { s, closed, isGap, lastRes };
    });
    const closedRows = withStatus.filter(w => w.closed);
    const total = list.length;
    const resolved = closedRows.length;
    const data_gap = withStatus.filter(w => w.isGap).length;
    const pending = withStatus.filter(w => !w.closed && !w.isGap).length;
    const period_start = closedRows.length ? Math.min(...closedRows.map(w => new Date(w.s.generated_at).getTime())) : null;
    const period_end = closedRows.length
      ? Math.max(...closedRows.map(w => new Date(w.lastRes?.resolved_at || w.s.expires_at).getTime()))
      : null;
    const strategyVersions = new Set(list.map(s => s.strategy_version));
    const lastResolver = [...outcomes].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0]?.resolved_by_version || null;
    return {
      total, resolved, data_gap, pending,
      period_start: period_start ? new Date(period_start).toISOString() : null,
      period_end: period_end ? new Date(period_end).toISOString() : null,
      n_strategy_versions: strategyVersions.size,
      last_resolver_version: lastResolver,
    };
  }

  function listWithStatus(limit: number, offset: number) {
    const list = signals
      .filter(s => ["long","short"].includes(s.direction) && s.entry_price != null)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
      .slice(offset, offset + limit);
    return list.map(s => {
      const cf = outcomes.filter(o => o.signal_id === s.signal_id && ["target_1","target_2","stop_loss","expired","data_gap"].includes(o.status))
        .reduce((acc, o) => acc + Number(o.position_fraction || 0), 0);
      const outs = outcomes.filter(o => o.signal_id === s.signal_id).sort((a, b) => a.resolved_at.localeCompare(b.resolved_at))
        .map(o => ({
          status: o.status, resolved_at: o.resolved_at, resolved_price: o.resolved_price,
          net_return_pct: o.net_return_pct, position_fraction: o.position_fraction,
          ambiguous_resolution: o.ambiguous_resolution, data_gap: o.data_gap,
        }));
      return { ...s, closed_fraction: cf, overall_status: outs.some((o: any) => o.status === "data_gap") ? "data_gap" : (cf >= 0.9999 ? "closed" : "open"), outcomes: JSON.stringify(outs) };
    });
  }

  function perSignalWeightedNet() {
    // sumário adicional (win_rate, avg_net): todas as oportunidades closed
    const closedSigs = summaryQuery();
    const out: any[] = [];
    for (const s of signals.filter(s => ["long","short"].includes(s.direction) && s.entry_price != null)) {
      const closed = outcomes.filter(o => o.signal_id === s.signal_id && ["target_1","target_2","stop_loss","expired","data_gap"].includes(o.status))
        .reduce((acc, o) => acc + Number(o.position_fraction || 0), 0);
      if (closed < 0.9999) continue;
      const weightedNet = outcomes.filter(o => o.signal_id === s.signal_id && ["target_1","target_2","stop_loss","expired","data_gap"].includes(o.status))
        .reduce((acc, o) => acc + (Number(o.net_return_pct) || 0) * Number(o.position_fraction || 0), 0);
      const weightedGross = outcomes.filter(o => o.signal_id === s.signal_id && ["target_1","target_2","stop_loss","expired","data_gap"].includes(o.status))
        .reduce((acc, o) => acc + (Number(o.gross_return_pct) || 0) * Number(o.position_fraction || 0), 0);
      out.push({ weighted_net_pct: weightedNet, weighted_gross_pct: weightedGross });
    }
    return out;
  }

  const DB = {
    __signals: signals,
    __outcomes: outcomes,
    __prices: prices,

    prepare(sql: string) {
      const trimmed = sql.trim().replace(/\s+/g, " ");
      function bound(...bindings: any[]) {
        return {
          async run(): Promise<any> {
            if (trimmed.startsWith("INSERT OR IGNORE INTO signals")) {
              return insertSignal(bindings);
            }
            if (trimmed.startsWith("INSERT OR IGNORE INTO signal_outcomes")) {
              return insertOutcome(bindings);
            }
            return { success: true, meta: { rows_written: 0 } };
          },
          async all<T = any>(): Promise<{ success: boolean; results: T[] }> {
            if (trimmed.includes("FROM signals s WHERE s.direction IN")) {
              return { success: true, results: pendingSignals() as T[] };
            }
            if (trimmed.includes("SELECT timestamp, open, high, low, close, volume, interval, source")) {
              return { success: true, results: seriesInRange(bindings) as T[] };
            }
            if (trimmed.includes("JSON_GROUP_ARRAY(JSON_OBJECT")) {
              const limitClause = sql.match(/LIMIT\s+(\d+)/)?.[1] ?? "100";
              const offsetClause = sql.match(/OFFSET\s+(\d+)/)?.[1] ?? "0";
              return { success: true, results: listWithStatus(parseInt(limitClause, 10), parseInt(offsetClause, 10)) as T[] };
            }
            if (trimmed.includes("GROUP BY s.signal_id")) {
              return { success: true, results: perSignalWeightedNet() as T[] };
            }
            return { success: true, results: [] as T[] };
          },
          async first<T = any>(): Promise<T | null> {
            if (trimmed.includes("WHERE s.strategy = ? AND s.timeframe = ?")) {
              return lastSignalWithFraction(bindings) as T | null;
            }
            if (trimmed.includes("COUNT(*) AS total,") && trimmed.includes("FROM signals s")) {
              return summaryQuery() as T | null;
            }
            return null;
          },
        };
      }
      bound.bind = bound;
      // expõe first/all/run diretamente em prepare() sem bind (para queries sem params)
      bound.first = async function <T = any>(): Promise<T | null> {
        return bound().first() as Promise<T | null>;
      };
      bound.all = async function <T = any>(): Promise<{ success: boolean; results: T[] }> {
        return bound().all();
      };
      bound.run = async function (): Promise<any> {
        return bound().run();
      };
      return bound as any;
    },
  };

  return DB as any as ReturnType<() => D1Like> & {
    __signals: any[]; __outcomes: any[]; __prices: any[];
  };
}

type D1Like = {
  prepare: (sql: string) => {
    bind: (...args: any[]) => {
      run: () => Promise<any>;
      all: <T>() => Promise<{ success: boolean; results: T[] }>;
      first: <T>() => Promise<T | null>;
    };
  };
};

function makeDoc(overrides: Partial<SignalDocument> = {}): SignalDocument {
  const now = overrides.generated_at ?? "2026-03-01T12:00:00.000Z";
  return {
    signal_id: "",
    symbol: "BTC-USD",
    timeframe: "short",
    verdict: "COMPRAR",
    market_date: "2026-03-01",
    generated_at: now,
    entry_price: 100,
    stop_loss: 90,
    target_1: 110,
    target_2: 120,
    risk_reward: 1,
    conviction: 7,
    strategy: "trend_following",
    payload: {
      rationale: "t", technical_indicators: {}, on_chain_context: "", sentiment_context: "",
      risk_notes: "", atr_value: 0, atr_multiplier_stop: 0,
      timeframe_hours: TIMEFRAME_EXPIRATION_HOURS.short,
    },
    ...overrides,
  };
}

function seedLongSeries(db: FakeDB, startTs: string, hours: number, startPrice = 100, step = 1) {
  const base = new Date(startTs).getTime();
  for (let i = 0; i < hours; i++) {
    const ts = new Date(base + i * 3600_000).toISOString();
    const close = startPrice + i * step;
    db.__prices.push({
      timestamp: ts, open: close - 0.5, high: close + 0.6, low: close - 0.6, close, volume: 10,
      interval: "1h", source: "test",
    });
  }
}

describe("signal-history: integração (D1 mock)", () => {
  it("persistSignals salva apenas direcionais com entry e ignora flat/AGUARDAR", async () => {
    const db = makeFakeDB();
    const now = "2026-03-01T12:00:00.000Z";
    const long = enrichSignalForPersist({ signal: makeDoc({ verdict: "COMPRAR" }), now, priceSource: "okx", priceInterval: "1h" });
    const wait = enrichSignalForPersist({ signal: makeDoc({ verdict: "AGUARDAR" }), now });
    const sell = enrichSignalForPersist({ signal: makeDoc({ verdict: "VENDER", strategy: "rsi" }), now });
    const noEntry = enrichSignalForPersist({ signal: makeDoc({ verdict: "COMPRAR", entry_price: null as any }), now });

    const r = await persistSignals(db, [long, wait, sell, noEntry]);
    expect(r.attempted).toBe(4);
    expect(r.inserted).toBe(2); // long + sell
    expect(r.skipped_flat_or_no_entry).toBe(2); // wait (flat) + noEntry
    expect(r.skipped_same_direction_open).toBe(0);
    expect(db.__signals.length).toBe(2);
    expect(db.__signals.map((s: any) => s.direction).sort()).toEqual(["long", "short"]);
    expect(db.__signals.some((s: any) => s.direction === "flat")).toBe(false);
  });

  it("regra 1 e 8: insert idempotente (signal_id único via INSERT OR IGNORE)", async () => {
    const db = makeFakeDB();
    const now = "2026-03-01T12:00:00.000Z";
    const row = enrichSignalForPersist({ signal: makeDoc({ generated_at: now }), now });
    const r1 = await persistSignals(db, [row]);
    const r2 = await persistSignals(db, [row]);
    expect(r1.inserted).toBe(1);
    expect(r2.inserted).toBe(0); // idempotente
    expect(db.__signals.length).toBe(1);
  });

  it("regra 7: não reabre enquanto mesma estratégia/tf/direção/versão estiver aberta", async () => {
    const db = makeFakeDB();
    const now = "2026-03-01T12:00:00.000Z";
    const now2 = "2026-03-02T12:00:00.000Z";
    const a = enrichSignalForPersist({ signal: makeDoc({ generated_at: now, strategy: "dca", timeframe: "long" }), now });
    const b = enrichSignalForPersist({ signal: makeDoc({ generated_at: now2, strategy: "dca", timeframe: "long" }), now: now2 });
    // Mesmos parâmetros, versões iguais, mesma direção → segundo é pulado.
    const r1 = await persistSignals(db, [a]);
    expect(r1.inserted).toBe(1);
    const r2 = await persistSignals(db, [b]);
    expect(r2.skipped_same_direction_open).toBe(1);
    expect(r2.inserted).toBe(0);
    expect(db.__signals.length).toBe(1);
  });

  it("regra 7 (variante): se a oportunidade anterior for 100% resolvida, nova do mesmo par abre", async () => {
    const db = makeFakeDB();
    const now = "2026-03-01T12:00:00.000Z";
    const now2 = "2026-03-05T12:00:00.000Z";
    const a = enrichSignalForPersist({ signal: makeDoc({ generated_at: now }), now });
    await persistSignals(db, [a]);
    // Força close total: escreve 2 outcomes (t1 0.5 + stop 0.5)
    await writeSignalOutcome(db, {
      signal_id: a.signal_id, status: "target_1", resolved_at: "2026-03-02T00:00:00.000Z", resolved_price: 110,
      position_fraction: 0.5, ambiguous_resolution: 0, data_gap: 0,
      fee_per_side: DEFAULT_FEE_PER_SIDE, slippage_pct: 0,
      gross_return_pct: 10, net_return_pct: 9.6,
      resolved_by_version: HISTORY_RESOLVER_VERSION, created_at: now,
    });
    await writeSignalOutcome(db, {
      signal_id: a.signal_id, status: "stop_loss", resolved_at: "2026-03-03T00:00:00.000Z", resolved_price: 95,
      position_fraction: 0.5, ambiguous_resolution: 0, data_gap: 0,
      fee_per_side: DEFAULT_FEE_PER_SIDE, slippage_pct: 0,
      gross_return_pct: -5, net_return_pct: -5.4,
      resolved_by_version: HISTORY_RESOLVER_VERSION, created_at: now,
    });
    const b = enrichSignalForPersist({ signal: makeDoc({ generated_at: now2 }), now: now2 });
    const r2 = await persistSignals(db, [b]);
    expect(r2.inserted).toBe(1); // op. anterior fechou → abre
  });

  it("mudança de versão estratégia reabre mesmo que mesmo tf/direção", async () => {
    const db = makeFakeDB();
    const now = "2026-03-01T12:00:00.000Z";
    const now2 = "2026-03-02T12:00:00.000Z";
    const a = enrichSignalForPersist({ signal: makeDoc({ strategy: "trend_following" }), now, strategyVersion: "1.0.0" });
    const b = enrichSignalForPersist({ signal: makeDoc({ strategy: "trend_following", generated_at: now2 }), now: now2, strategyVersion: "1.1.0" });
    await persistSignals(db, [a]);
    const r = await persistSignals(db, [b]);
    // versão diferente → query lastSignalWithFraction usa strategy_version como filtro, portanto não encontra anterior.
    expect(r.inserted).toBe(1);
  });

  it("regra 12: métricas nulas se nenhuma oportunidade resolvida ainda", async () => {
    const db = makeFakeDB();
    const now = "2026-03-01T12:00:00.000Z";
    const a = enrichSignalForPersist({ signal: makeDoc({ generated_at: now }), now });
    await persistSignals(db, [a]);
    const s = await getTrackRecordSummary(db);
    expect(s.total).toBe(1);
    expect(s.resolved).toBe(0);
    expect(s.pending).toBe(1);
    expect(s.period_start).toBeNull();
    expect(s.period_end).toBeNull();
    // métricas = null (nunca 0).
    expect(s.win_rate).toBeNull();
    expect(s.avg_net_pct).toBeNull();
    expect(s.avg_gross_pct).toBeNull();
    expect(s.best_net_pct).toBeNull();
    expect(s.worst_net_pct).toBeNull();
    expect(s.profit_factor).toBeNull();
  });

  it("regra 12: métricas corretas após 2 oportunidades resolvidas (1 win + 1 loss)", async () => {
    const db = makeFakeDB();
    const now = "2026-03-01T12:00:00.000Z";
    const win = enrichSignalForPersist({ signal: makeDoc({ generated_at: now }), now });
    const loss = enrichSignalForPersist({ signal: makeDoc({ strategy: "rsi", generated_at: now }), now });
    await persistSignals(db, [win, loss]);

    // Win: 50% em t1 (+10%), 50% em t2 (+20%) → 15% média
    await writeSignalOutcome(db, {
      signal_id: win.signal_id, status: "target_1", resolved_at: "2026-03-02T00:00:00Z", resolved_price: 110,
      position_fraction: 0.5, ambiguous_resolution: 0, data_gap: 0,
      fee_per_side: 0, slippage_pct: 0,
      gross_return_pct: 10, net_return_pct: 10, resolved_by_version: HISTORY_RESOLVER_VERSION, created_at: now,
    });
    await writeSignalOutcome(db, {
      signal_id: win.signal_id, status: "target_2", resolved_at: "2026-03-03T00:00:00Z", resolved_price: 120,
      position_fraction: 0.5, ambiguous_resolution: 0, data_gap: 0,
      fee_per_side: 0, slippage_pct: 0,
      gross_return_pct: 20, net_return_pct: 20, resolved_by_version: HISTORY_RESOLVER_VERSION, created_at: now,
    });
    // Loss: stop total (-10%)
    await writeSignalOutcome(db, {
      signal_id: loss.signal_id, status: "stop_loss", resolved_at: "2026-03-02T12:00:00Z", resolved_price: 90,
      position_fraction: 1, ambiguous_resolution: 0, data_gap: 0,
      fee_per_side: 0, slippage_pct: 0,
      gross_return_pct: -10, net_return_pct: -10, resolved_by_version: HISTORY_RESOLVER_VERSION, created_at: now,
    });

    const summary = await getTrackRecordSummary(db);
    expect(summary.resolved).toBe(2);
    expect(summary.pending).toBe(0);
    expect(summary.win_rate).toBe(0.5); // 1 win, 1 loss
    // média net = (0.5*10 + 0.5*20 + (-10)) / 2 trades = (15 -10)/2 = 2.5%
    expect(summary.avg_net_pct).toBeCloseTo(2.5, 2);
    expect(summary.best_net_pct).toBeCloseTo(15, 1); // média ponderada do win = 15
    expect(summary.worst_net_pct).toBeCloseTo(-10, 1);
  });

  it("resolvePendingSignals sobre preços em memória → fecha todas 2 oportunidades e insere outcomes", async () => {
    const db = makeFakeDB();
    const startTs = "2026-03-01T00:00:00.000Z";
    // seed: preços 100 horas crescente +1/h → t1=110 (h10) e t2=120 (h20) para long.
    seedLongSeries(db, startTs, 120, 100, 1);
    const now = startTs;
    const longA = enrichSignalForPersist({
      signal: makeDoc({
        verdict: "COMPRAR", generated_at: now, strategy: "tfA",
        entry_price: 100, stop_loss: 90, target_1: 110, target_2: 120, timeframe: "short",
      }), now, priceSource: "test", priceInterval: "1h",
    });
    const longB = enrichSignalForPersist({
      signal: makeDoc({
        verdict: "COMPRAR", generated_at: now, strategy: "tfB", timeframe: "short",
        entry_price: 100, stop_loss: 95, target_1: 106, target_2: 118,
      }), now, priceSource: "test", priceInterval: "1h",
    });
    await persistSignals(db, [longA, longB]);
    const before = await getTrackRecordSummary(db);
    expect(before.pending).toBe(2);

    const res = await resolvePendingSignals(db, { feePerSide: 0, slippagePct: 0 });
    expect(res.processed).toBe(2);
    expect(res.resolved).toBe(2);
    const after = await getTrackRecordSummary(db);
    expect(after.pending).toBe(0);
    expect(after.resolved).toBe(2);
    // listagem
    const list = await listTrackRecordSignals(db, 10, 0);
    expect(list.length).toBe(2);
  });

  it("P0-2: sinal recém-gerado sem candle posterior e ainda não vencido permanece pendente; resolve quando o candle aparece", async () => {
    const db = makeFakeDB();
    // Datas futuras para não depender do relógio real. Vencimento short = +72h.
    const gen = "2100-01-01T00:00:00.000Z";
    const a = enrichSignalForPersist({
      signal: makeDoc({
        verdict: "COMPRAR", generated_at: gen, strategy: "tfFuturo",
        entry_price: 100, stop_loss: 90, target_1: 110, target_2: 120, timeframe: "short",
      }), now: gen, priceSource: "test", priceInterval: "1h",
    });
    await persistSignals(db, [a]);

    // 1ª tentativa: a série está vazia (nenhum candle). O sinal NÃO pode ser
    // resolvido como data_gap terminal — segue pendente, sem outcome escrito.
    const r1 = await resolvePendingSignals(db, { feePerSide: 0, slippagePct: 0 });
    expect(r1.processed).toBe(1); // a tentativa foi contada
    expect(r1.resolved).toBe(0);
    expect(r1.with_gap).toBe(0);
    expect(db.__outcomes.length).toBe(0);

    // Sinal continua pendente para a próxima rodada.
    const stillPending = await resolvePendingSignals(db, { feePerSide: 0, slippagePct: 0 });
    expect(stillPending.processed).toBe(1);
    expect(db.__outcomes.length).toBe(0);

    // Agora aparece a série posterior ao generated_at: sobe +1/h e atinge
    // target_1 (110) e target_2 (120) dentro das 72h.
    const base = new Date(gen).getTime();
    for (let i = 0; i <= 80; i++) {
      const ts = new Date(base + i * 3600_000).toISOString();
      const close = 100 + i;
      db.__prices.push({
        timestamp: ts, open: close - 0.5, high: close + 0.6, low: close - 0.6, close, volume: 10,
        interval: "1h", source: "test",
      });
    }

    const r2 = await resolvePendingSignals(db, { feePerSide: 0, slippagePct: 0, nowMs: base + 81 * 3600_000 });
    expect(r2.processed).toBe(1);
    expect(r2.resolved).toBe(1);
    expect(db.__outcomes.length).toBe(2); // target_1 + target_2
    const statuses = db.__outcomes.map((o: any) => o.status).sort();
    expect(statuses).toEqual(["target_1", "target_2"]);
  });
});
