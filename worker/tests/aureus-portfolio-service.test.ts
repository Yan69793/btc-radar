import { describe, expect, it } from "vitest";
import { buildPortfolioCycleKey, chooseExecutionSignal } from "../src/aureus-portfolio-service";
import type { SignalDocument } from "../src/types";

function sig(overrides: Partial<SignalDocument>): SignalDocument {
  return {
    signal_id: "s",
    symbol: "BTC-USD",
    timeframe: "short",
    verdict: "COMPRAR",
    market_date: "2026-10-05",
    generated_at: "2026-10-05T12:00:00.000Z",
    entry_price: 100,
    stop_loss: 95,
    target_1: 110,
    target_2: 120,
    risk_reward: 2,
    conviction: 5,
    strategy: "trend_following",
    payload: {
      rationale: "", technical_indicators: {}, on_chain_context: "",
      sentiment_context: "", risk_notes: "", atr_value: 0,
      atr_multiplier_stop: 0, timeframe_hours: 1,
    },
    ...overrides,
  };
}

describe("Aureus portfolio persistence helpers", () => {
  it("cycle key depende apenas do candle e torna reexecucao idempotente", () => {
    expect(buildPortfolioCycleKey("2026-10-05T12:00:00.000Z"))
      .toBe("aureus:2026-10-05T12:00:00.000Z");
  });

  it("COMPRAR escolhe o sinal elegivel de maior conviccao para stop e targets", () => {
    const chosen = chooseExecutionSignal([
      sig({ signal_id: "a", conviction: 6 }),
      sig({ signal_id: "b", conviction: 9, stop_loss: 92 }),
      sig({ signal_id: "c", conviction: 10, stop_loss: null }),
    ], "COMPRAR");
    expect(chosen?.signal_id).toBe("b");
    expect(chosen?.stop_loss).toBe(92);
  });

  it("VENDER e REDUZIR nao inventam sinal de execucao", () => {
    expect(chooseExecutionSignal([sig({})], "VENDER")).toBeNull();
    expect(chooseExecutionSignal([sig({})], "REDUZIR")).toBeNull();
  });
});
