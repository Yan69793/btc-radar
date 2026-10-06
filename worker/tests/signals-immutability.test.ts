import { describe, expect, it } from "vitest";
import { createSqliteD1 } from "./sqlite-d1";
import { insertSignalOutcomeQuery, insertSignalQuery } from "../src/db/queries";
import { writeSignalOutcome } from "../src/signal-history-service";
import type { SignalOutcomeRecord } from "../src/lib/signal-history";

const SIGNAL = [
  "sig-f14", "BTC-USD", "short", "COMPRAR", "2026-01-01", "2026-01-01T00:00:00.000Z",
  100, 90, 110, 120, 2, 8, "rsi", "{}",
  "1.0.0", "1.0.0", "test", "1h", "long", "2026-01-04T00:00:00.000Z", "{}", null, null,
];

const outcome = (status: SignalOutcomeRecord["status"], resolved_at: string): SignalOutcomeRecord => ({
  signal_id: "sig-f14",
  status,
  resolved_at,
  resolved_price: 110,
  price_source: "test",
  price_interval: "1h",
  price_timestamp: "2026-01-01T01:00:00.000Z",
  gross_return_pct: 10,
  net_return_pct: 9.8,
  position_fraction: 0.5,
  ambiguous_resolution: 0,
  data_gap: 0,
  fee_per_side: 0.001,
  slippage_pct: 0,
  raw_candle_payload: null,
  resolved_by_version: "1.1.0",
  created_at: "2026-01-01T02:00:00.000Z",
});

describe("F14 imutabilidade em dois níveis: API (INSERT) + banco (triggers 0009)", () => {
  it("INSERT de sinal e outcome continua funcionando sob os triggers", async () => {
    const { DB, sqlite } = createSqliteD1();
    try {
      await DB.prepare(insertSignalQuery()).bind(...SIGNAL).run();
      await writeSignalOutcome(DB, outcome("target_1", "2026-01-01T02:00:00.000Z"));
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM signals").get()!.n).toBe(1);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM signal_outcomes").get()!.n).toBe(1);
    } finally { sqlite.close(); }
  });

  it("UPDATE em signals é abortado no banco", async () => {
    const { DB, sqlite } = createSqliteD1();
    try {
      await DB.prepare(insertSignalQuery()).bind(...SIGNAL).run();
      await expect(DB.prepare("UPDATE signals SET conviction = 10 WHERE signal_id = 'sig-f14'").run())
        .rejects.toThrow(/append-only/);
      expect(sqlite.prepare("SELECT conviction AS c FROM signals").get()!.c).toBe(8);
    } finally { sqlite.close(); }
  });

  it("DELETE em signals é abortado no banco", async () => {
    const { DB, sqlite } = createSqliteD1();
    try {
      await DB.prepare(insertSignalQuery()).bind(...SIGNAL).run();
      await expect(DB.prepare("DELETE FROM signals WHERE signal_id = 'sig-f14'").run())
        .rejects.toThrow(/append-only/);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM signals").get()!.n).toBe(1);
    } finally { sqlite.close(); }
  });

  it("UPDATE e DELETE em signal_outcomes são abortados no banco", async () => {
    const { DB, sqlite } = createSqliteD1();
    try {
      await DB.prepare(insertSignalQuery()).bind(...SIGNAL).run();
      await writeSignalOutcome(DB, outcome("target_1", "2026-01-01T02:00:00.000Z"));
      await expect(DB.prepare("UPDATE signal_outcomes SET resolved_price = 1 WHERE signal_id = 'sig-f14'").run())
        .rejects.toThrow(/append-only/);
      await expect(DB.prepare("DELETE FROM signal_outcomes WHERE signal_id = 'sig-f14'").run())
        .rejects.toThrow(/append-only/);
      expect(sqlite.prepare("SELECT resolved_price AS p FROM signal_outcomes").get()!.p).toBe(110);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM signal_outcomes").get()!.n).toBe(1);
    } finally { sqlite.close(); }
  });

  it("correção legítima via INSERT compensatório preserva o registro original", async () => {
    const { DB, sqlite } = createSqliteD1();
    try {
      await DB.prepare(insertSignalQuery()).bind(...SIGNAL).run();
      await writeSignalOutcome(DB, outcome("target_1", "2026-01-01T02:00:00.000Z"));
      // Correção: novo outcome versionado (resolved_at distinto), nunca UPDATE.
      await DB.prepare(insertSignalOutcomeQuery()).bind(
        "sig-f14", "target_2", "2026-01-01T03:00:00.000Z", 120, "test",
        "1h", "2026-01-01T02:00:00.000Z", 20, 19.8,
        0.5, 0, null, 0, "correcao: preco de referência republicado", 0.001, 0,
        null, "1.1.0", "2026-01-01T04:00:00.000Z",
      ).run();
      const rows = sqlite.prepare(
        "SELECT status, resolved_price FROM signal_outcomes ORDER BY resolved_at").all() as Array<{ status: string; resolved_price: number }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ status: "target_1", resolved_price: 110 });
      expect(rows[1]).toEqual({ status: "target_2", resolved_price: 120 });
    } finally { sqlite.close(); }
  });
});
