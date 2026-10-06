import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUREUS_POLICY,
  evaluatePortfolioCycle,
  initialPortfolioState,
  markToMarket,
} from "../src/lib/aureus-portfolio";

const candle = (close: number, high = close, low = close, timestamp = "2026-10-05T12:00:00.000Z") => ({
  timestamp, open: close, high, low, close,
});

describe("Aureus Portfolio Engine v1", () => {
  it("inicia com NAV 100, 100% caixa e exposição zero", () => {
    const s = initialPortfolioState();
    const snap = markToMarket(s, 100_000, "2026-10-05T00:00:00.000Z");
    expect(snap.nav).toBe(100);
    expect(snap.cash).toBe(100);
    expect(snap.exposure).toBe(0);
  });

  it("COMPRAR usa sizing por risco 1% com teto de 25% do NAV", () => {
    const r = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100),
      stopLoss: 95, target1: 110, target2: 120,
    });
    const buy = r.events.find(e => e.type === "BUY")!;
    expect(buy).toBeDefined();
    expect(buy.grossValue).toBeLessThanOrEqual(25 + 1e-8);
    expect(r.snapshot.exposure).toBeLessThanOrEqual(0.25 + 1e-3);
    expect(r.state.cash).toBeGreaterThanOrEqual(0);
  });

  it("stop distante reduz sizing abaixo de 25% quando risco de 1% domina", () => {
    const r = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100), stopLoss: 80,
    });
    expect(r.events.find(e => e.type === "BUY")!.grossValue).toBeCloseTo(5, 6);
  });

  it("não abre short: VENDER sem posição apenas mantém caixa", () => {
    const r = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "VENDER", candle: candle(100),
    });
    expect(r.state.position).toBeNull();
    expect(r.snapshot.exposure).toBe(0);
    expect(r.events[0].type).toBe("HOLD");
  });

  it("VENDER encerra 100% da posição existente", () => {
    const opened = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100), stopLoss: 95,
    });
    const sold = evaluatePortfolioCycle(opened.state, {
      timestamp: "2026-10-05T02:00:00.000Z", action: "VENDER", candle: candle(105),
    });
    expect(sold.state.position).toBeNull();
    expect(sold.snapshot.exposure).toBe(0);
    expect(sold.events.some(e => e.type === "SELL")).toBe(true);
  });

  it("REDUZIR vende exatamente 50% da posição corrente", () => {
    const opened = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100), stopLoss: 95,
    });
    const q0 = opened.state.position!.quantity;
    const reduced = evaluatePortfolioCycle(opened.state, {
      timestamp: "2026-10-05T02:00:00.000Z", action: "REDUZIR", candle: candle(100),
    });
    expect(reduced.state.position!.quantity).toBeCloseTo(q0 * 0.5, 10);
  });

  it("T1 realiza 50% da quantidade original e T2 encerra o restante", () => {
    const opened = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100),
      stopLoss: 90, target1: 110, target2: 120,
    });
    const q0 = opened.state.position!.originalQuantity;
    const t1 = evaluatePortfolioCycle(opened.state, {
      timestamp: "2026-10-05T02:00:00.000Z", action: "AGUARDAR",
      candle: candle(109, 111, 108, "2026-10-05T02:00:00.000Z"),
    });
    expect(t1.events.find(e => e.type === "TARGET_1")!.quantity).toBeCloseTo(q0 * 0.5, 10);
    expect(t1.state.position!.quantity).toBeCloseTo(q0 * 0.5, 10);

    const t2 = evaluatePortfolioCycle(t1.state, {
      timestamp: "2026-10-05T03:00:00.000Z", action: "AGUARDAR",
      candle: candle(120, 121, 119, "2026-10-05T03:00:00.000Z"),
    });
    expect(t2.events.some(e => e.type === "TARGET_2")).toBe(true);
    expect(t2.state.position).toBeNull();
  });

  it("candle ambíguo aplica stop-first e não executa target", () => {
    const opened = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100),
      stopLoss: 90, target1: 110, target2: 120,
    });
    const r = evaluatePortfolioCycle(opened.state, {
      timestamp: "2026-10-05T02:00:00.000Z", action: "AGUARDAR",
      candle: candle(100, 115, 85, "2026-10-05T02:00:00.000Z"),
    });
    expect(r.events.some(e => e.type === "STOP")).toBe(true);
    expect(r.events.some(e => e.type === "TARGET_1" || e.type === "TARGET_2")).toBe(false);
    expect(r.events.find(e => e.type === "STOP")!.reason).toContain("stop-first");
    expect(r.state.position).toBeNull();
  });

  it("COMPRAR repetido não duplica exposição ao BTC", () => {
    const opened = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100), stopLoss: 95,
    });
    const q0 = opened.state.position!.quantity;
    const again = evaluatePortfolioCycle(opened.state, {
      timestamp: "2026-10-05T02:00:00.000Z", action: "COMPRAR", candle: candle(101), stopLoss: 96,
    });
    expect(again.events.some(e => e.type === "REJECTED")).toBe(true);
    expect(again.state.position!.quantity).toBeCloseTo(q0, 10);
  });

  it("COMPRAR com stop inválido falha fechado", () => {
    const r = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100), stopLoss: 101,
    });
    expect(r.state.position).toBeNull();
    expect(r.events[0].type).toBe("REJECTED");
  });

  it("NAV é marcado a mercado a cada ciclo", () => {
    const opened = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100), stopLoss: 95,
    });
    const later = evaluatePortfolioCycle(opened.state, {
      timestamp: "2026-10-05T02:00:00.000Z", action: "AGUARDAR", candle: candle(110, 110, 110),
    });
    expect(later.snapshot.nav).toBeGreaterThan(opened.snapshot.nav);
  });

  it("custos são fee 0,10% por lado e slippage 0,05% por execução", () => {
    expect(DEFAULT_AUREUS_POLICY.feePerSide).toBe(0.001);
    expect(DEFAULT_AUREUS_POLICY.slippagePct).toBe(0.0005);
    const opened = evaluatePortfolioCycle(initialPortfolioState(), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100), stopLoss: 95,
    });
    const buy = opened.events.find(e => e.type === "BUY")!;
    expect(buy.executionPrice).toBeCloseTo(100.05, 8);
    expect(buy.fee).toBeGreaterThan(0);
  });

  it("exposição máxima nunca supera 100% e caixa nunca fica negativo", () => {
    const aggressive = { ...DEFAULT_AUREUS_POLICY, maxNewEntryNotional: 1, riskPerTrade: 1 };
    const r = evaluatePortfolioCycle(initialPortfolioState(aggressive), {
      timestamp: "2026-10-05T01:00:00.000Z", action: "COMPRAR", candle: candle(100), stopLoss: 99,
    }, aggressive);
    expect(r.snapshot.exposure).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.state.cash).toBeGreaterThanOrEqual(-1e-9);
  });
});
