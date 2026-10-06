// OKX Public API connector — dados de mercado Bitcoin
// API gratuita, sem chave, sem restrição de IP de datacenter
// Docs: https://www.okx.com/docs-v5/en/

import type { OHLCV, PriceSnapshot } from "../types";

const BASE_URL = "https://www.okx.com/api/v5";

const BAR_MAP: Record<string, string> = {
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};

export async function fetchOKXOHLCV(
  interval: "1h" | "4h" | "1d" | "1w" = "1d",
  limit: number = 200
): Promise<OHLCV[]> {
  const bar = BAR_MAP[interval] ?? "1D";
  const url = `${BASE_URL}/market/candles?instId=BTC-USDT&bar=${bar}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OKX OHLCV error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as {
    code: string;
    data: Array<[string, string, string, string, string, string, string, string, string]>;
  };

  if (json.code !== "0" || !json.data) {
    throw new Error(`OKX API error: code=${json.code}`);
  }

  // OKX returns candles in reverse chronological order (newest first)
  // Each entry: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
  const sorted = [...json.data].reverse();

  return sorted.map((k) => ({
    timestamp: new Date(parseInt(k[0])).toISOString(),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    interval,
    source: "OKX",
  }));
}

// ─── Ticker / Preço atual ───

interface OKXTickerResponse {
  code: string;
  data: Array<{
    instId: string;
    last: string;
    open24h: string;
    high24h: string;
    low24h: string;
    vol24h: string;    // volume em BTC
    volCcy24h: string; // volume em USDT
    ts: string;
  }>;
}

// Circulating supply aproximado do BTC (atualizado periodicamente)
const BTC_CIRCULATING = 19_800_000;

export async function fetchOKXTicker(): Promise<PriceSnapshot> {
  const url = `${BASE_URL}/market/ticker?instId=BTC-USDT`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`OKX ticker error: ${res.status} ${res.statusText}`);
  }

  const json: OKXTickerResponse = await res.json();

  if (json.code !== "0" || !json.data || json.data.length === 0) {
    throw new Error(`OKX ticker API error: code=${json.code}`);
  }

  const t = json.data[0]!;
  const price = parseFloat(t.last);
  const open24h = parseFloat(t.open24h);
  const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
  const volumeUsd = parseFloat(t.volCcy24h) || parseFloat(t.vol24h) * price;

  return {
    symbol: "BTC-USD",
    price,
    change_24h: Math.round(change24h * 100) / 100,
    high_24h: parseFloat(t.high24h),
    low_24h: parseFloat(t.low24h),
    volume_24h: Math.round(volumeUsd),
    market_cap: Math.round(price * BTC_CIRCULATING),
    btc_dominance: 0, // Será preenchido pela rota via CoinPaprika se disponível
    timestamp: new Date(parseInt(t.ts)).toISOString(),
  };
}
