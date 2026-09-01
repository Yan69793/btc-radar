// CoinPaprika API connector — dados de mercado Bitcoin
// API gratuita, sem chave, 20k req/mês
// Docs: https://api.coinpaprika.com/

import type { OHLCV, PriceSnapshot } from "../types";

const BASE_URL = "https://api.coinpaprika.com/v1";
const BTC_ID = "btc-bitcoin";

interface CoinPaprikaQuote {
  price: number;
  volume_24h: number;
  volume_24h_change_24h: number;
  market_cap: number;
  market_cap_change_24h: number;
  percent_change_15m: number;
  percent_change_30m: number;
  percent_change_1h: number;
  percent_change_6h: number;
  percent_change_12h: number;
  percent_change_24h: number;
  percent_change_7d: number;
  percent_change_30d: number;
  percent_change_1y: number;
  ath_price: number;
  ath_date: string;
  percent_from_price_ath: number;
}

interface CoinPaprikaTicker {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number | null;
  beta_value: number;
  first_data_at: string;
  last_updated: string;
  quotes: {
    USD: CoinPaprikaQuote;
  };
}

interface CoinPaprikaGlobal {
  market_cap_usd: number;
  volume_24h_usd: number;
  bitcoin_dominance_percentage: number;
  cryptocurrencies_number: number;
  last_updated: number;
}

interface CoinPaprikaOHLCVItem {
  time_open: string;
  time_close: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  market_cap: number;
}

type CoinPaprikaInterval = "1h" | "6h" | "12h" | "1d" | "1w" | "1mo";

function mapInterval(interval: "1h" | "4h" | "1d" | "1w"): CoinPaprikaInterval {
  const map: Record<string, CoinPaprikaInterval> = {
    "1h": "1h",
    "4h": "6h",
    "1d": "1d",
    "1w": "1w",
  };
  return map[interval] ?? "1d";
}

export async function fetchTicker(): Promise<PriceSnapshot> {
  const [tickerRes, globalRes] = await Promise.all([
    fetch(`${BASE_URL}/tickers/${BTC_ID}`),
    fetch(`${BASE_URL}/global`),
  ]);

  if (!tickerRes.ok) {
    throw new Error(`CoinPaprika ticker error: ${tickerRes.status}`);
  }
  if (!globalRes.ok) {
    throw new Error(`CoinPaprika global error: ${globalRes.status}`);
  }

  const ticker: CoinPaprikaTicker = await tickerRes.json();
  const global: CoinPaprikaGlobal = await globalRes.json();

  const q = ticker.quotes.USD;
  const ts = new Date(ticker.last_updated).toISOString();

  return {
    symbol: "BTC-USD",
    price: q.price,
    change_24h: q.percent_change_24h,
    high_24h: 0,
    low_24h: 0,
    volume_24h: q.volume_24h,
    market_cap: q.market_cap,
    btc_dominance: global.bitcoin_dominance_percentage,
    timestamp: ts,
  };
}

export async function fetchOHLCV(
  interval: "1h" | "4h" | "1d" | "1w" = "1d",
  limit: number = 30
): Promise<OHLCV[]> {
  const mappedInterval = mapInterval(interval);
  const url = `${BASE_URL}/coins/${BTC_ID}/ohlcv/historical?interval=${mappedInterval}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CoinPaprika OHLCV error: ${res.status}`);
  }

  const data: CoinPaprikaOHLCVItem[] = await res.json();

  return data.map((item) => ({
    timestamp: item.time_open,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
    volume: item.volume,
    interval,
    source: "CoinPaprika",
  }));
}
