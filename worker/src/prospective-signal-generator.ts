import type { D1Database } from "@cloudflare/workers-types";
import type { FearGreedData, OHLCV, SignalDocument } from "./types";
import { SIGNAL_TIMEFRAMES } from "./lib/signal-timeframes";
import { generateSignals } from "./lib/signal-engine";
import { enrichSignalForPersist } from "./signal-history-service";
import { fetchStoredOHLCV } from "./routes/signals";

export async function collectProspectiveSignals(
  DB: D1Database,
  fearGreed: FearGreedData | null,
  evaluatedAt: string,
  load = fetchStoredOHLCV,
) {
  const rawSignals: SignalDocument[] = [];
  const allSignals: ReturnType<typeof enrichSignalForPersist>[] = [];
  const errors: string[] = [];
  let portfolioCandle: (OHLCV & { closedAt: string }) | null = null;
  for (const { tf, interval, limit } of SIGNAL_TIMEFRAMES) {
    try {
      const intervalMs = interval === "1h" ? 3600000 : interval === "4h" ? 14400000 : 86400000;
      const candles = (await load(DB, interval, limit))
        .filter(c => Date.parse(c.timestamp) + intervalMs <= Date.parse(evaluatedAt));
      const last = candles[candles.length - 1];
      if (last && Date.parse(evaluatedAt) - (Date.parse(last.timestamp) + intervalMs) > intervalMs) {
        throw new Error("OHLCV desatualizado para " + tf);
      }
      // A posição econômica usa execução horária, independentemente do horizonte dos sinais.
      if (tf === "short" && last) portfolioCandle = { ...last, closedAt: new Date(Date.parse(last.timestamp) + intervalMs).toISOString() };
      const generated = generateSignals({ candles, fearGreed, timeframe: tf });
      rawSignals.push(...generated);
      for (const signal of generated) allSignals.push(enrichSignalForPersist({
        signal, now: evaluatedAt, priceSource: last?.source, priceInterval: interval,
      }));
    } catch (error) {
      errors.push("Histórico sinais tf=" + tf + ": " + (error instanceof Error ? error.message : "erro"));
    }
  }
  return { rawSignals, allSignals, portfolioCandle, errors };
}
