import type { Timeframe } from "../types";

// Resoluções canônicas usadas pelo painel e pelo registro prospectivo.
export const SIGNAL_TIMEFRAMES: ReadonlyArray<{tf: Timeframe; interval: "1h" | "4h" | "1d"; limit: number}> = [
  { tf: "short", interval: "1h", limit: 72 },
  { tf: "medium", interval: "4h", limit: 180 },
  { tf: "long", interval: "1d", limit: 200 },
];
