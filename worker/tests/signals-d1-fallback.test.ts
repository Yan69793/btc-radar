import { describe, expect, it } from "vitest";
import { fetchStoredOHLCV } from "../src/routes/signals";

describe("signals D1 fallback", () => {
  it("carrega OHLCV persistido em ordem cronologica", async () => {
    const rows = [
      { timestamp: "2026-09-28T02:00:00Z", open: 2, high: 3, low: 1, close: 2.5, volume: 20, interval: "1h", source: "OKX" },
      { timestamp: "2026-09-28T01:00:00Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, interval: "1h", source: "OKX" },
    ];
    const db = {
      prepare(sql: string) {
        expect(sql).toContain("FROM prices");
        return {
          bind(interval: string, limit: number) {
            expect(interval).toBe("1h");
            expect(limit).toBe(72);
            return {
              async all() {
                return { results: rows };
              },
            };
          },
        };
      },
    } as any;

    const out = await fetchStoredOHLCV(db, "1h", 72);
    expect(out).toHaveLength(2);
    expect(out[0]!.timestamp).toBe("2026-09-28T01:00:00Z");
    expect(out[1]!.timestamp).toBe("2026-09-28T02:00:00Z");
    expect(out[0]!.close).toBe(1.5);
  });
});
