import { describe, expect, it } from "vitest";
import { persistAureusPortfolioCycle, loadAureusPortfolioState } from "../src/aureus-portfolio-service";
import type { ConsensusResult } from "../src/lib/consensus";
import { createSqliteD1 } from "./sqlite-d1";

const opts = (DB: ReturnType<typeof createSqliteD1>["DB"], hour: number) => {
  const timestamp = "2026-01-01T" + String(hour).padStart(2, "0") + ":00:00.000Z";
  return { DB, signals: [], consensus: { verdict: "AGUARDAR" } as ConsensusResult,
    candle: { timestamp, open: 100, high: 100, low: 100, close: 100 }, evaluatedAt: timestamp };
};
describe("F03 concorrência D1 com SQL real", () => {
  it("recalcula dois candles concorrentes e conserva cada ciclo aceito", async () => {
    const { DB, sqlite } = createSqliteD1();
    const results = await Promise.all([persistAureusPortfolioCycle(opts(DB, 1)), persistAureusPortfolioCycle(opts(DB, 2))]);
    expect(results.every(r => !r.skipped)).toBe(true);
    expect((await loadAureusPortfolioState(DB)).cycle).toBe(2);
    const cycles = sqlite.prepare("SELECT result_json FROM aureus_portfolio_cycles ORDER BY candle_timestamp").all() as Array<{result_json:string}>;
    expect(cycles.map(c => JSON.parse(c.result_json).state.cycle)).toEqual([1, 2]);
    const last = JSON.parse(cycles[1].result_json).state;
    expect(await loadAureusPortfolioState(DB)).toEqual(last);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM aureus_portfolio_snapshots").get()!.n).toBe(2);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM aureus_portfolio_events").get()!.n).toBe(2);
    console.log("F03 SQLite PASS accepted=2 state.cycle=2 history.cycles=1,2 snapshots=2 events=2");
    sqlite.close();
  });
  it("candle concorrente repetido não duplica nenhum efeito", async () => {
    const { DB, sqlite } = createSqliteD1();
    const results = await Promise.all([persistAureusPortfolioCycle(opts(DB, 1)), persistAureusPortfolioCycle(opts(DB, 1))]);
    expect(results.filter(r => !r.skipped)).toHaveLength(1);
    expect(results.find(r => r.skipped)?.reason).toBe("duplicate");
    expect((await loadAureusPortfolioState(DB)).cycle).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM aureus_portfolio_events").get()!.n).toBe(1);
    sqlite.close();
  });
  it("candle antigo não reverte estado mais recente", async () => {
    const { DB, sqlite } = createSqliteD1();
    await persistAureusPortfolioCycle(opts(DB, 2));
    expect((await persistAureusPortfolioCycle(opts(DB, 1))).reason).toBe("stale");
    expect((await loadAureusPortfolioState(DB)).cycle).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM aureus_portfolio_cycles").get()!.n).toBe(1);
    sqlite.close();
  });
  it("falha no meio do batch faz rollback e retry reaplica exatamente uma vez", async () => {
    const { DB, sqlite, failNextBatchAt } = createSqliteD1();
    failNextBatchAt(2);
    await expect(persistAureusPortfolioCycle(opts(DB, 1))).rejects.toThrow("falha DB induzida");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM aureus_portfolio_cycles").get()!.n).toBe(0);
    expect((await loadAureusPortfolioState(DB)).cycle).toBe(0);
    await persistAureusPortfolioCycle(opts(DB, 1));
    expect((await loadAureusPortfolioState(DB)).cycle).toBe(1);
    expect((await persistAureusPortfolioCycle(opts(DB, 1))).reason).toBe("duplicate");
    sqlite.close();
  });
});
