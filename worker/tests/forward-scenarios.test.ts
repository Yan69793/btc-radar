import { describe, expect, it } from "vitest";
import type { OHLCV } from "../src/types";
import { classifyForwardRegime, computeForwardScenarios, quantile } from "../src/lib/forward-scenarios";

function series(days: number): OHLCV[] {
  const start = Date.UTC(2020, 0, 1);
  const out: OHLCV[] = [];
  for (let i = 0; i < days; i++) {
    const cycle = Math.sin(i / 45) * 0.18;
    const drift = i * 0.0007;
    const price = 10000 * Math.exp(drift + cycle);
    out.push({
      timestamp: new Date(start + i * 86400000).toISOString(),
      open: price * 0.995,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 1000 + i,
      interval: "1d",
      source: "test",
    });
  }
  return out;
}

describe("forward scenarios", () => {
  it("quantile interpola distribuicao ordenada", () => {
    expect(quantile([0, 10, 20, 30, 40], 0.5)).toBe(20);
    expect(quantile([0, 100], 0.25)).toBe(25);
  });

  it("classifica regime apenas com informacao passada", () => {
    const candles = series(100);
    const regime = classifyForwardRegime(candles, 80);
    expect(regime).not.toBeNull();
    expect(["bull", "neutral", "bear"]).toContain(regime!.trend);
    expect(["low", "normal", "high"]).toContain(regime!.volatility);
  });

  it("produz P10/P50/P90 e habilita horizonte anual com historico suficiente", () => {
    const out = computeForwardScenarios(series(2600), [30, 90, 365], 20, 40);
    expect(out.history.candles).toBe(2600);
    expect(out.horizons["30"]!.available).toBe(true);
    expect(out.horizons["365"]!.available).toBe(true);
    expect(out.annual_ready).toBe(true);
    const h = out.horizons["365"]!;
    expect(h.p10!).toBeLessThanOrEqual(h.p50!);
    expect(h.p50!).toBeLessThanOrEqual(h.p90!);
    expect(h.sample_size).toBeGreaterThanOrEqual(20);
    expect(h.effective_sample_size).toBeGreaterThanOrEqual(6);
    expect(["medium", "limited", "high"]).toContain(h.confidence);
  });

  it("nao fabrica 365d com apenas 228 candles", () => {
    const out = computeForwardScenarios(series(228));
    expect(out.horizons["365"]!.available).toBe(false);
    expect(out.horizons["365"]!.conditioning).toBe("insufficient");
    expect(out.annual_ready).toBe(false);
  });
});
