import { describe, expect, it } from "vitest";
import { DEFAULT_AUREUS_POLICY, evaluatePortfolioCycle, initialPortfolioState, type CycleResult, type PortfolioState } from "../src/lib/aureus-portfolio";

const timestamp = "2026-10-06T01:00:00.000Z";
const candle = (close: number, high = close, low = close, open = close) => ({ timestamp, open, high, low, close });
const buy = () => evaluatePortfolioCycle(initialPortfolioState(), { timestamp, action: "COMPRAR", candle: candle(100), stopLoss: 80, target1: 110, target2: 120 });
const reconcile = (result: CycleResult) => {
  expect(result.snapshot.nav - 100).toBeCloseTo(result.snapshot.realizedPnl + result.snapshot.unrealizedPnl, 10);
};
const cycle = (state: PortfolioState, action: "VENDER" | "REDUZIR" | "AGUARDAR", close: number, high = close, low = close, open = close) => evaluatePortfolioCycle(state, { timestamp, action, candle: candle(close, high, low, open) });

describe("regressões adversariais da carteira Aureus", () => {
  it.each([105, 95, 100])("reconcilia entrada e saída total a %s incluindo ambas as fees", price => {
    const entry = buy();
    reconcile(entry);
    const exit = cycle(entry.state, "VENDER", price);
    reconcile(exit);
    const purchase = entry.events.find(e => e.type === "BUY")!;
    const sale = exit.events.find(e => e.type === "SELL")!;
    expect(exit.snapshot.realizedPnl).toBeCloseTo(sale.grossValue - sale.fee - purchase.grossValue - purchase.fee, 10);
    expect(exit.snapshot.unrealizedPnl).toBe(0);
  });

  it.each([105, 95])("aloca fee proporcional em várias reduções a %s e fechamento", price => {
    let result = buy();
    const fee = result.state.position!.entryFeeRemaining!;
    for (let n = 1; n <= 3; n++) {
      result = cycle(result.state, "REDUZIR", price);
      reconcile(result);
      expect(result.state.position!.entryFeeRemaining).toBeCloseTo(fee / 2 ** n, 12);
    }
    result = cycle(result.state, "VENDER", price);
    reconcile(result);
    expect(result.state.position).toBeNull();
  });

  it("reconcilia T1, REDUZIR e T2 sem vender além do saldo", () => {
    const entry = buy();
    const t1 = cycle(entry.state, "AGUARDAR", 109, 111, 108);
    reconcile(t1);
    expect(t1.state.position!.entryFeeRemaining).toBeCloseTo(entry.state.position!.entryFeeRemaining! / 2, 12);
    const reduced = cycle(t1.state, "REDUZIR", 109);
    reconcile(reduced);
    const t2 = cycle(reduced.state, "AGUARDAR", 120, 121, 119);
    reconcile(t2);
    expect(t2.events.find(e => e.type === "TARGET_2")!.quantity).toBeCloseTo(entry.state.position!.quantity / 4, 10);
    expect(t2.state.position).toBeNull();
  });

  it.each([[75, 78, 70, 72], [79, 90, 75, 85]])("gap-through stop executa na abertura %s antes do slippage", (open, high, low, close) => {
    const entry = buy();
    const result = cycle(entry.state, "AGUARDAR", close, high, low, open);
    const stop = result.events.find(e => e.type === "STOP")!;
    expect(stop.marketPrice).toBe(open);
    expect(stop.marketPrice).toBeGreaterThanOrEqual(low);
    expect(stop.marketPrice).toBeLessThanOrEqual(high);
    expect(stop.executionPrice).toBeCloseTo(open * (1 - DEFAULT_AUREUS_POLICY.slippagePct), 10);
    reconcile(result);
  });

  it("target abaixo do candle usa preço-base dentro do candle", () => {
    const entry = buy();
    const result = cycle(entry.state, "AGUARDAR", 135, 140, 130);
    const exits = result.events.filter(e => e.type === "TARGET_1" || e.type === "TARGET_2");
    expect(exits).toHaveLength(2);
    for (const event of exits) {
      expect(event.marketPrice).toBeGreaterThanOrEqual(130);
      expect(event.marketPrice).toBeLessThanOrEqual(140);
    }
    reconcile(result);
  });

  it.each([candle(100, 99, 90), candle(100, 110, 101), candle(100, 90, 110), candle(100, 110, 90, NaN), candle(100, Infinity, 90), candle(0)])("rejeita OHLC inválido sem alterar estado", invalid => {
    const state = buy().state;
    const original = structuredClone(state);
    expect(() => evaluatePortfolioCycle(state, { timestamp, action: "VENDER", candle: invalid })).toThrow("candle inválido");
    expect(state).toEqual(original);
  });

  it("F10 caso da auditoria: entry=100 stop=95 NAV=100 tem perda econômica <= 1% (antes 1.058%)", () => {
    // Política B (risco econômico): notional antigo de risco só-preço era exatamente 20
    // (1 / 0.05) com perda econômica de 1.057971514243. Com custos no sizing o notional cai.
    const entry = evaluatePortfolioCycle(initialPortfolioState(), { timestamp, action: "COMPRAR", candle: candle(100), stopLoss: 95 });
    const buy = entry.events.find(e => e.type === "BUY")!;
    expect(buy.grossValue).toBeLessThan(20 - 0.1);
    expect(buy.grossValue).toBeCloseTo(18.904, 3);
    // Stop sem gap executa no próprio stop: perda deve equivaler à fórmula econômica e caber em 1%.
    const stopped = cycle(entry.state, "AGUARDAR", 95, 100, 95, 100);
    reconcile(stopped);
    const q = entry.state.position!.quantity;
    const expected = q * (buy.executionPrice * (1 + DEFAULT_AUREUS_POLICY.feePerSide)
      - 95 * (1 - DEFAULT_AUREUS_POLICY.slippagePct) * (1 - DEFAULT_AUREUS_POLICY.feePerSide));
    expect(100 - stopped.snapshot.nav).toBeCloseTo(expected, 8);
    expect(100 - stopped.snapshot.nav).toBeLessThanOrEqual(1 + 1e-9);
    expect(100 - stopped.snapshot.nav).toBeGreaterThan(0.99);
  });

  it.each([95, 80, 99.99])("limita perda líquida no stop %s a 1%% do NAV sem gap", stopLoss => {
    const entry = evaluatePortfolioCycle(initialPortfolioState(), { timestamp, action: "COMPRAR", candle: candle(100), stopLoss });
    const stopped = cycle(entry.state, "AGUARDAR", stopLoss, 100, stopLoss, 100);
    reconcile(stopped);
    expect(100 - stopped.snapshot.nav).toBeLessThanOrEqual(1 + 1e-10);
    if (stopLoss < 99) expect(100 - stopped.snapshot.nav).toBeCloseTo(1, 10);
  });

  it("preserva política atual de stop seguido de reentrada no mesmo ciclo", () => {
    const entry = buy();
    const result = evaluatePortfolioCycle(entry.state, { timestamp, action: "COMPRAR", candle: candle(90, 100, 75), stopLoss: 70 });
    expect(result.events.map(e => e.type)).toEqual(["STOP", "BUY"]);
    reconcile(result);
  });

  it("eventos protetivos usam fechamento conhecido e fallback do ciclo", () => {
    const entry = buy();
    const closedAt = "2026-10-06T03:00:00.000Z";
    const recordedAt = "2026-10-06T03:01:00.000Z";
    const result = evaluatePortfolioCycle(entry.state, { timestamp: recordedAt, action: "AGUARDAR", candle: { ...candle(80), closedAt } });
    expect(result.events.find(e => e.type === "STOP")!.timestamp).toBe(closedAt);
    const fallback = evaluatePortfolioCycle(entry.state, { timestamp: recordedAt, action: "AGUARDAR", candle: candle(80) });
    expect(fallback.events.find(e => e.type === "STOP")!.timestamp).toBe(recordedAt);
    expect(Date.parse(fallback.events[0].timestamp)).toBeGreaterThan(Date.parse(entry.state.position!.openedAt));
  });

  it("não inventa fee para estado legado sem evidência", () => {
    const legacy = buy().state;
    delete legacy.position!.entryFeeRemaining;
    const result = cycle(legacy, "VENDER", 100);
    const sale = result.events.find(e => e.type === "SELL")!;
    expect(result.snapshot.realizedPnl).toBeCloseTo(sale.grossValue - sale.fee - legacy.position!.quantity * legacy.position!.entryExecPrice, 10);
    expect(result.snapshot.nav - 100 - result.snapshot.realizedPnl).toBeLessThan(0);
  });
});
