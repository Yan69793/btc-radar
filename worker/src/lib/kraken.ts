// Kraken public OHLC connector - fallback gratuito para historico BTC/USD
// Docs: https://docs.kraken.com/api/docs/rest-api/get-ohlc-data

import type { OHLCV } from "../types";

const BASE_URL = "https://api.kraken.com/0/public/OHLC";

const INTERVAL_MINUTES: Record<string, number> = {
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1w": 10080,
};

type KrakenRow = [
  number,
  string,
  string,
  string,
  string,
  string,
  string,
  number
];

export async function fetchKrakenOHLCV(
  interval: "1h" | "4h" | "1d" | "1w" = "1d",
  limit = 200,
): Promise<OHLCV[]> {
  const minutes = INTERVAL_MINUTES[interval] ?? 1440;
  const res = await fetch(`${BASE_URL}?pair=XBTUSD&interval=${minutes}`);
  if (!res.ok) throw new Error(`Kraken OHLC error: ${res.status} ${res.statusText}`);

  const json = await res.json() as {
    error: string[];
    result: Record<string, KrakenRow[] | number>;
  };
  if (json.error?.length) throw new Error(`Kraken API error: ${json.error.join(",")}`);

  const pairKey = Object.keys(json.result).find((key) => key !== "last");
  const rows = pairKey ? json.result[pairKey] : null;
  if (!Array.isArray(rows)) throw new Error("Kraken OHLC payload ausente");

  return (rows as KrakenRow[]).slice(-Math.max(1, limit)).map((k) => ({
    timestamp: new Date(k[0] * 1000).toISOString(),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[6]),
    interval,
    source: "Kraken",
  }));
}
