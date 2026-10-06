import { describe, it, expect } from "vitest";
import {
  parseOrderBook,
  computeMicrostructure,
  computeBrlPremium,
} from "../src/lib/mercadobitcoin";

describe("parseOrderBook", () => {
  it("parseia o envelope {asks,bids} e ordena asks asc / bids desc", () => {
    const book = parseOrderBook({
      asks: [
        ["398000", "0.5"],
        ["397500", "0.2"],
      ],
      bids: [
        ["397000", "0.3"],
        ["397400", "0.4"],
      ],
    });
    expect(book.asks.map((l) => l.price)).toEqual([397500, 398000]);
    expect(book.bids.map((l) => l.price)).toEqual([397400, 397000]);
  });

  it("descarta níveis inválidos (preço <= 0, NaN, sem array)", () => {
    const book = parseOrderBook({
      asks: [["398000", "0.5"], [null], ["0", "0.1"], "lixo", ["NaN", "1"]],
      bids: [["-1", "0.2"], ["397000", "0.3"]],
    });
    expect(book.asks.length).toBe(1);
    expect(book.bids.length).toBe(1);
    expect(book.bids[0]!.price).toBe(397000);
  });

  it("aceita entrada vazia sem quebrar", () => {
    const book = parseOrderBook(null);
    expect(book.asks).toEqual([]);
    expect(book.bids).toEqual([]);
  });
});

describe("computeMicrostructure", () => {
  const book = parseOrderBook({
    asks: [
      ["398000", "0.5"],
      ["398100", "0.5"],
    ],
    bids: [
      ["397900", "0.5"],
      ["397800", "0.5"],
    ],
  });

  it("calcula best bid/ask, midpoint, spread e spreadBps", () => {
    const m = computeMicrostructure(book, 10, "2026-01-01T00:00:00Z");
    expect(m.bestBid).toBe(397900);
    expect(m.bestAsk).toBe(398000);
    expect(m.midpoint).toBe(397950);
    expect(m.spread).toBe(100);
    // 100 / 397950 * 10000 = 2.5128...
    expect(m.spreadBps).toBeCloseTo(2.5129, 3);
  });

  it("retorna null quando book vazio", () => {
    const m = computeMicrostructure({ asks: [], bids: [] }, 10);
    expect(m.bestBid).toBeNull();
    expect(m.bestAsk).toBeNull();
    expect(m.midpoint).toBeNull();
    expect(m.spread).toBeNull();
    expect(m.spreadBps).toBeNull();
  });

  it("calcula depth acumulado por lado", () => {
    const m = computeMicrostructure(book, 10, "2026-01-01T00:00:00Z");
    // bidDepth = 397900*0.5 + 397800*0.5 = 397850
    expect(m.bidDepth).toBe(397850);
    // askDepth = 398000*0.5 + 398100*0.5 = 398050
    expect(m.askDepth).toBe(398050);
  });
});

describe("computeBrlPremium", () => {
  it("calcula prêmio em %", () => {
    expect(computeBrlPremium(397950, 395000)).toBeCloseTo(0.7468, 3);
  });
  it("retorna null sem midpoint ou referência", () => {
    expect(computeBrlPremium(null, 395000)).toBeNull();
    expect(computeBrlPremium(397950, null)).toBeNull();
    expect(computeBrlPremium(397950, 0)).toBeNull();
  });
});
