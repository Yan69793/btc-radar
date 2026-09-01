// BTC Radar — Testes do consenso multi-timeframe
import { describe, expect, it } from "vitest";
import { computeConsensus, TIMEFRAME_WEIGHTS, ABSTAIN_THRESHOLD } from "../src/lib/consensus";
import type { SignalDocument, Timeframe, Verdict } from "../src/types";

function makeSignal(
  strategy: string,
  timeframe: Timeframe,
  verdict: Verdict,
  conviction: number,
  entry?: number,
): SignalDocument {
  return {
    signal_id: `sig-${strategy}-${timeframe}-2026-01-05`,
    symbol: "BTC-USD",
    timeframe,
    verdict,
    market_date: "2026-01-05",
    generated_at: "2026-01-05T12:00:00.000Z",
    entry_price: entry ?? null,
    stop_loss: null,
    target_1: null,
    target_2: null,
    risk_reward: null,
    conviction,
    strategy: strategy as SignalDocument["strategy"],
    payload: {
      rationale: "teste",
      technical_indicators: {},
      on_chain_context: "",
      sentiment_context: "",
      risk_notes: "",
      atr_value: 100,
      atr_multiplier_stop: 0,
      timeframe_hours: 0,
    },
  };
}

// Um sinal AGUARDAR por timeframe, todos neutros.
const allWait = (): SignalDocument[] => [
  makeSignal("rsi", "short", "AGUARDAR", 3),
  makeSignal("rsi", "medium", "AGUARDAR", 3),
  makeSignal("rsi", "long", "AGUARDAR", 3),
];

// Todos os timeframes COMPRAR com convicção alta: deve dar consenso COMPRAR forte.
const allBuy = (): SignalDocument[] => [
  makeSignal("rsi", "short", "COMPRAR", 8),
  makeSignal("trend_following", "medium", "COMPRAR", 8),
  makeSignal("dca", "long", "COMPRAR", 9),
];

// Divergência total: short VENDER, medium AGUARDAR, long COMPRAR.
const mixed = (): SignalDocument[] => [
  makeSignal("rsi", "short", "VENDER", 8),
  makeSignal("rsi", "medium", "AGUARDAR", 3),
  makeSignal("dca", "long", "COMPRAR", 9),
];

describe("computeConsensus", () => {
  it("retorna null quando não há sinais", () => {
    expect(computeConsensus([])).toBeNull();
  });

  it("pesos somam 1 por timeframe", () => {
    const sum = TIMEFRAME_WEIGHTS.short + TIMEFRAME_WEIGHTS.medium + TIMEFRAME_WEIGHTS.long;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("todos AGUARDAR gera veredito AGUARDAR sem abstenção", () => {
    const c = computeConsensus(allWait());
    expect(c).not.toBeNull();
    expect(c!.verdict).toBe("AGUARDAR");
    expect(c!.conviction).toBeLessThan(ABSTAIN_THRESHOLD);
  });

  it("todos COMPRAR de alta convicção produz COMPRAR", () => {
    const c = computeConsensus(allBuy());
    expect(c).not.toBeNull();
    expect(c!.verdict).toBe("COMPRAR");
    expect(c!.conviction).toBeGreaterThanOrEqual(ABSTAIN_THRESHOLD);
    expect(c!.agreement).toBe(1);
    expect(c!.divergence_penalty).toBe(0);
  });

  it("divergência alta penaliza a convicção e pode abstener", () => {
    const c = computeConsensus(mixed());
    expect(c).not.toBeNull();
    // divergência: 1 positivo (long), 1 negativo (short), 1 neutro -> agreement baixo
    expect(c!.divergence_penalty).toBeGreaterThan(0);
    // convicção penalizada fica abaixo da convicção bruta
    expect(c!.conviction).toBeLessThanOrEqual(c!.raw_conviction);
  });

  it("aceita mapa timeframe -> sinais", () => {
    const map: Record<Timeframe, SignalDocument[]> = {
      short: [makeSignal("rsi", "short", "AGUARDAR", 3)],
      medium: [makeSignal("rsi", "medium", "AGUARDAR", 2)],
      long: [makeSignal("dca", "long", "COMPRAR", 9)],
    };
    const c = computeConsensus(map);
    expect(c).not.toBeNull();
    expect(c!.per_timeframe.long.verdict).toBe("COMPRAR");
  });

  it("não muta os sinais de entrada", () => {
    const input = allBuy();
    const copy = JSON.parse(JSON.stringify(input));
    computeConsensus(input);
    expect(JSON.stringify(input)).toBe(JSON.stringify(copy));
  });
});
