import { describe, it, expect } from "vitest";
import {
  classifyRegime,
  ema200Distance,
  detectGoldenDeathCross,
  supportResistance,
  confluenceLabel,
  qualityScore,
} from "../src/lib/market-structure";
import type { OHLCV } from "../src/types";

function candle(close: number, high = close + 100, low = close - 100): OHLCV {
  return {
    timestamp: "2026-01-01T00:00:00Z",
    open: close,
    high,
    low,
    close,
    volume: 1000,
    interval: "1d",
    source: "test",
  };
}

describe("classifyRegime", () => {
  it("Tendência de Alta quando preço > EMA21 > EMA50 e preço > EMA200", () => {
    expect(classifyRegime({ price: 100, ema21: 95, ema50: 90, ema200: 80 })).toBe("Tendência de Alta");
  });
  it("Tendência de Baixa no inverso", () => {
    expect(classifyRegime({ price: 80, ema21: 85, ema50: 90, ema200: 100 })).toBe("Tendência de Baixa");
  });
  it("Consolidação com sinais mistos", () => {
    // bullish=1 (preço > EMA21), bearish=1 (EMA21 < EMA50), preço ~ EMA200 (neutro)
    expect(classifyRegime({ price: 100, ema21: 95, ema50: 105, ema200: 100 })).toBe("Consolidação");
  });
  it("ignora nulos sem decidir", () => {
    expect(classifyRegime({ price: 100, ema21: null, ema50: null, ema200: null })).toBe("Consolidação");
  });
});

describe("ema200Distance", () => {
  it("calcula distância percentual", () => {
    expect(ema200Distance(110, 100)).toBeCloseTo(10, 3);
    expect(ema200Distance(90, 100)).toBeCloseTo(-10, 3);
  });
  it("retorna null sem EMA200", () => {
    expect(ema200Distance(100, null)).toBeNull();
    expect(ema200Distance(100, 0)).toBeNull();
  });
});

describe("detectGoldenDeathCross", () => {
  it("detecta golden cross (50 cruza acima de 200)", () => {
    const ema50 = [90, 190, 210];
    const ema200 = [100, 200, 200];
    // Cruzamento detectado no candle de índice 2 (após o cruzamento entre 1 e 2)
    expect(detectGoldenDeathCross(ema50, ema200)).toEqual({ type: "golden", index: 2 });
  });
  it("detecta death cross", () => {
    const ema50 = [210, 190, 90];
    const ema200 = [200, 200, 100];
    expect(detectGoldenDeathCross(ema50, ema200)).toEqual({ type: "death", index: 1 });
  });
  it("retorna null sem cruzamento", () => {
    const ema50 = [100, 110, 120];
    const ema200 = [90, 95, 100];
    expect(detectGoldenDeathCross(ema50, ema200)).toBeNull();
  });
  it("ignora NaN", () => {
    // NaN no candle anterior ao possível cruzamento: não pode decidir, retorna null
    const ema50 = [100, NaN, 200];
    const ema200 = [150, 150, 150];
    expect(detectGoldenDeathCross(ema50, ema200)).toBeNull();
  });
});

describe("supportResistance", () => {
  // Série com tendência e oscilações para gerar swings
  const candles = Array.from({ length: 60 }, (_, i) => {
    const base = 1000 + i * 10 + (i % 2 === 0 ? 50 : -50);
    return candle(base, base + 80, base - 80);
  });

  it("suportes abaixo do preço e resistências acima", () => {
    const price = candles[candles.length - 1]!.close;
    const { supports, resistances } = supportResistance({ candles, price, atr: 100, ema200: 1300 });
    for (const s of supports) expect(s.price).toBeLessThan(price);
    for (const r of resistances) expect(r.price).toBeGreaterThan(price);
  });

  it("níveis ordenados: suporte mais próximo primeiro, resistência mais próxima primeiro", () => {
    const price = candles[candles.length - 1]!.close;
    const { supports, resistances } = supportResistance({ candles, price, atr: 100, ema200: 1300 });
    if (supports.length >= 2) {
      expect(supports[0]!.price).toBeGreaterThan(supports[1]!.price);
    }
    if (resistances.length >= 2) {
      expect(resistances[0]!.price).toBeLessThan(resistances[1]!.price);
    }
  });

  it("confluência mínima 1 e fator declarado", () => {
    const price = candles[candles.length - 1]!.close;
    const { supports, resistances } = supportResistance({ candles, price, atr: 100, ema200: 1300 });
    const all = [...supports, ...resistances];
    for (const l of all) {
      expect(l.confluence).toBeGreaterThanOrEqual(1);
      expect(l.factors.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("retorna vazio com dados insuficientes", () => {
    const { supports, resistances } = supportResistance({ candles: [], price: 100, atr: 10, ema200: null });
    expect(supports).toEqual([]);
    expect(resistances).toEqual([]);
  });
});

describe("confluenceLabel", () => {
  it("mapeia 1→fraco, 2→médio, 3+→forte", () => {
    expect(confluenceLabel(1)).toBe("fraco");
    expect(confluenceLabel(2)).toBe("médio");
    expect(confluenceLabel(3)).toBe("forte");
    expect(confluenceLabel(5)).toBe("forte");
  });
});

describe("qualityScore", () => {
  const base = {
    sources: 3,
    ageSeconds: 10,
    maxAgeSeconds: 60,
    discrepancyPct: null,
    hasBook: true,
    hasDerivatives: true,
    timestampRegressed: false,
  };

  it("100 com tudo saudável", () => {
    expect(qualityScore(base)).toBe(100);
  });
  it("penaliza uma única fonte (-25)", () => {
    expect(qualityScore({ ...base, sources: 1 })).toBe(75);
  });
  it("penaliza zero fontes (-50)", () => {
    expect(qualityScore({ ...base, sources: 0 })).toBe(50);
  });
  it("penaliza dado velho (> 2x maxAge)", () => {
    expect(qualityScore({ ...base, ageSeconds: 200 })).toBe(85);
  });
  it("penaliza divergência > 0,5%", () => {
    expect(qualityScore({ ...base, discrepancyPct: 0.8 })).toBe(80);
  });
  it("penaliza book e derivativos indisponíveis", () => {
    expect(qualityScore({ ...base, hasBook: false, hasDerivatives: false })).toBe(70);
  });
  it("nunca fica negativo", () => {
    expect(
      qualityScore({
        sources: 0,
        ageSeconds: 999,
        maxAgeSeconds: 10,
        discrepancyPct: 5,
        hasBook: false,
        hasDerivatives: false,
        timestampRegressed: true,
      })
    ).toBe(0);
  });
});
