// BTC Radar — Testes de walk-forward / abstinência com fees
import { describe, expect, it } from "vitest";
import { simulateWithFees, walkForwardEvaluate } from "../src/lib/walkforward";
import type { OHLCV } from "../src/types";

function candles(close: number[]): OHLCV[] {
  return close.map((price, i) => ({
    timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 100,
    interval: "1d",
    source: "test",
  }));
}

describe("simulateWithFees", () => {
  it("aplica fee na entrada e reduz o retorno", () => {
    const close = [100, 102, 101, 110, 105, 120];
    const entries = [true, false, false, false, false, false];
    const exits = [false, false, false, true, false, false];
    const conviction = [8, 8, 8, 8, 8, 8];

    const noFee = simulateWithFees({ close: [100, 110], entries: [true, false], exits: [false, true], conviction: [8, 8], fee: 0 });
    const withFee = simulateWithFees({ close: [100, 110], entries: [true, false], exits: [false, true], conviction: [8, 8], fee: 0.001 });

    // Sem fee: 10% de lucro bruto. Com fee 0.1% nos 2 lados: ~9.79%
    expect(noFee.total_return_pct).toBeCloseTo(10, 0);
    expect(withFee.total_return_pct).toBeLessThan(noFee.total_return_pct);
    expect(withFee.fees_paid).toBeGreaterThan(0);
    expect(withFee.n_trades).toBe(1);
  });

  it("gate de abstinência bloqueia trade quando convicção baixa", () => {
    const close = [100, 105, 110];
    const entries = [true, false, false];
    const exits = [false, false, true];
    const conviction = [3, 3, 3]; // abaixo do threshold

    const gated = simulateWithFees({
      close, entries, exits, conviction, fee: 0.001, abstainThreshold: 6,
    });
    // sem gate opera, com gate abstém
    const unGated = simulateWithFees({ close, entries, exits, conviction, fee: 0.001 });
    expect(gated.n_trades).toBe(0);
    expect(unGated.n_trades).toBe(1);
  });
});

describe("walkForwardEvaluate", () => {
  it("divide em treino e teste, congela o threshold e reporta OOS", () => {
    const n = 20;
    const close = Array.from({ length: n }, (_, i) => 100 + i); // tendência de alta
    const entries = Array.from({ length: n }, (_, i) => i % 4 === 0);
    const exits = Array.from({ length: n }, (_, i) => i % 4 === 2);
    const conviction = Array.from({ length: n }, () => 7);

    const res = walkForwardEvaluate({
      candles: candles(close),
      entries, exits, conviction,
      fee: 0.001,
      abstainThreshold: 6, // congelado pelo caller, não otimizado no holdout
    });

    expect(res.testSize).toBeGreaterThan(0);
    expect(res.trainSize).toBeGreaterThan(0);
    expect(res.testFromIndex).toBe(res.trainSize);
    expect(res.threshold).toBe(6);
    expect(Array.isArray(res.oos.gated) || typeof res.oos.gated.total_return_pct).toBe("number");
    expect(res.oos.gated.n_trades).toBeGreaterThanOrEqual(0);
    expect(res.oos.gated.fees_paid).toBeGreaterThanOrEqual(0);
  });

  it("calibração por mediana de convicção no treino congela threshold antes do teste", () => {
    const n = 12;
    const close = Array.from({ length: n }, (_, i) => 50 + i);
    const entries = Array.from({ length: n }, () => true);
    const exits = Array.from({ length: n }, (_, i) => i % 2 === 1);
    // convicção com mediana conhecida no treino
    const conviction = Array.from({ length: n }, (_, i) => (i < 6 ? 5 : 8));

    const res = walkForwardEvaluate({
      candles: candles(close),
      entries, exits, conviction,
      fee: 0.001,
      useTrainCalibration: true,
    });
    // treino = 60% de 12 = 7 barras (floor); mediana das primeiras convicções (~5)
    expect(res.threshold).toBeGreaterThanOrEqual(5);
    expect(res.threshold).toBeLessThanOrEqual(8);
  });

  it("não otimiza retorno no holdout: threshold é entrada ou calibração de treino", () => {
    const n = 15;
    const close = [100, 99, 101, 102, 98, 103, 104, 100, 105, 106, 99, 107, 108, 102, 109];
    const entries = Array.from({ length: n }, (_, i) => i % 3 === 0);
    const exits = Array.from({ length: n }, (_, i) => i % 3 === 2);
    const conviction = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 8 : 2));

    const res = walkForwardEvaluate({
      candles: candles(close),
      entries, exits, conviction,
      fee: 0.001,
      abstainThreshold: 6, // fixo, paramétrico, não derivado do holdout
    });
    expect(res.oos.gated.n_trades).toBeLessThanOrEqual(res.oos.unGated.n_trades);
  });
});
