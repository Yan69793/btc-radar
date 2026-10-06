import { describe, expect, it } from "vitest";
import {
  candleCloseMs,
  CANDLE_INTERVAL_MS,
  computeExpiresAt,
  resolveProspectively,
} from "../src/lib/signal-history";
import type { OHLCV } from "../src/types";

const candle = (timestamp: string, interval: OHLCV["interval"], opts: Partial<OHLCV> & { close: number }): OHLCV => ({
  timestamp,
  open: opts.open ?? opts.close,
  high: opts.high ?? opts.close,
  low: opts.low ?? opts.close,
  close: opts.close,
  volume: 10,
  interval,
  source: "test",
});

const hourly = (base: string, n: number, close = 100): OHLCV[] =>
  Array.from({ length: n }, (_, i) =>
    candle(new Date(Date.parse(base) + i * 3600_000).toISOString(), "1h", { close }));

const signal = (generated_at: string, timeframe: "short" | "medium" | "long" = "short") => ({
  signal_id: "sig-f11",
  direction: "long" as const,
  entry_price: 100,
  stop_loss: 95,
  target_1: null,
  target_2: null,
  generated_at,
  expires_at: computeExpiresAt(generated_at, timeframe),
  strategy: "x",
  timeframe,
  strategy_version: "1",
  engine_version: "1",
});

describe("F11 semântica temporal: timestamp = abertura, nunca fechamento", () => {
  it("linha da Binance 02:00:00 (1h) abre 02:00 e fecha 03:00", () => {
    // kline: [openTime, open, high, low, close, volume, ...] — openTime = abertura.
    const openTime = Date.parse("2026-01-01T02:00:00.000Z");
    const row = { timestamp: new Date(openTime).toISOString(), interval: "1h" as const };
    expect(row.timestamp).toBe("2026-01-01T02:00:00.000Z");
    expect(new Date(candleCloseMs({ ...row, open: 1, high: 1, low: 1, close: 1, volume: 1, source: "Binance" })).toISOString())
      .toBe("2026-01-01T03:00:00.000Z");
    expect(CANDLE_INTERVAL_MS["1h"]).toBe(3600_000);
    expect(CANDLE_INTERVAL_MS["4h"]).toBe(4 * 3600_000);
    expect(CANDLE_INTERVAL_MS["1d"]).toBe(24 * 3600_000);
  });

  it("candle ainda aberto não entra no cálculo prospectivo", () => {
    const series = hourly("2026-02-01T00:00:00.000Z", 4);
    // nowMs = 02:30: candle 02:00 (fecha 03:00) ainda aberto → excluído.
    const open = resolveProspectively({
      signal: signal("2026-02-01T00:30:00.000Z"),
      series, feePerSide: 0, slippagePct: 0, nowMs: Date.parse("2026-02-01T02:30:00.000Z"),
    });
    expect(open.entry_candle!.timestamp).toBe("2026-02-01T00:00:00.000Z");
    expect(JSON.stringify(open)).not.toContain("2026-02-01T02:00:00.000Z");
    // Controle: com o candle 02:00 fechado (nowMs = 03:30), stop nele resolve.
    const closed = resolveProspectively({
      signal: { ...signal("2026-02-01T00:30:00.000Z"), stop_loss: 95 },
      series: hourly("2026-02-01T00:00:00.000Z", 4).map((c, i) =>
        i === 2 ? { ...c, open: 100, high: 100, low: 90, close: 91 } : c),
      feePerSide: 0, slippagePct: 0, nowMs: Date.parse("2026-02-01T03:30:00.000Z"),
    });
    expect(closed.outcomes).toHaveLength(1);
    expect(closed.outcomes[0]!.price_timestamp).toBe("2026-02-01T02:00:00.000Z");
  });

  it("sinal no meio do período não consome o candle corrente", () => {
    // Sinal às 02:30: entrada = close do candle 02:00; stop atravessado DENTRO do
    // candle 02:00 não pode disparar (resolução começa no candle 03:00).
    const series = hourly("2026-02-01T00:00:00.000Z", 6).map((c, i) =>
      i === 2 ? { ...c, open: 100, high: 101, low: 90, close: 100 }
      : i === 3 ? { ...c, open: 100, high: 100, low: 94, close: 96 }
      : c);
    const r = resolveProspectively({
      signal: signal("2026-02-01T02:30:00.000Z"),
      series, feePerSide: 0, slippagePct: 0, nowMs: Date.parse("2026-02-01T06:30:00.000Z"),
    });
    expect(r.entry_candle!.timestamp).toBe("2026-02-01T02:00:00.000Z");
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]!.status).toBe("stop_loss");
    // Stop dispara no candle 03:00 (primeiro avaliado), nunca no 02:00.
    expect(r.outcomes[0]!.price_timestamp).toBe("2026-02-01T03:00:00.000Z");
    expect(r.outcomes[0]!.resolved_at).toBe("2026-02-01T04:00:00.000Z");
    expect(r.outcomes[0]!.resolved_price).toBe(95);
  });

  it.each([
    ["1h", 3600_000, "2026-01-01T00:00:00.000Z", "2026-01-01T00:30:00.000Z"],
    ["4h", 4 * 3600_000, "2026-01-01T00:00:00.000Z", "2026-01-01T02:00:00.000Z"],
    ["1d", 24 * 3600_000, "2026-01-01T00:00:00.000Z", "2026-01-01T12:00:00.000Z"],
  ])("outcome em %s recebe timestamp de fechamento (open + duração)", (interval, duration, base, genAt) => {
    const iv = interval as OHLCV["interval"];
    const dur = Number(duration);
    const at = (ms: number) => new Date(ms).toISOString();
    const t0 = Date.parse(String(base));
    const series = [0, 1, 2, 3].map(i => candle(at(t0 + i * dur), iv,
      i === 1 ? { open: 100, high: 100, low: 90, close: 91 } : { close: 100 }));
    const r = resolveProspectively({
      signal: signal(String(genAt)), series, feePerSide: 0, slippagePct: 0,
      priceInterval: iv, nowMs: t0 + 4 * dur + 1000,
    });
    expect(r.entry_candle!.timestamp).toBe(at(t0));
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]!.price_timestamp).toBe(at(t0 + dur));
    expect(r.outcomes[0]!.resolved_at).toBe(at(t0 + 2 * dur));
    expect(r.outcomes[0]!.resolved_price).toBe(95);
  });

  it("candle desalinhado vira data_gap sem inventar preço", () => {
    const series = [
      ...hourly("2026-02-01T00:00:00.000Z", 2),
      candle("2026-02-01T02:30:00.000Z", "1h", { close: 100 }),
    ];
    const r = resolveProspectively({
      signal: signal("2026-02-01T00:30:00.000Z"),
      series, feePerSide: 0, slippagePct: 0, nowMs: Date.parse("2026-02-01T03:00:00.000Z"),
    });
    expect(r.has_gap).toBe(true);
    expect(r.outcomes).toHaveLength(0);
  });
});
