// Alternative.me Fear & Greed Index connector
// API gratuita, sem chave, sem rate limit documentado
// Docs: https://api.alternative.me/fng/

import type { FearGreedData } from "../types";

const BASE_URL = "https://api.alternative.me";

interface AlternativeMeFngItem {
  value: string; // "45"
  value_classification: string; // "Fear"
  timestamp: string; // unix timestamp as string
  time_until_update?: string;
}

interface AlternativeMeFngResponse {
  name: string;
  data: AlternativeMeFngItem[];
  metadata: { error: string | null };
}

function classify(value: number): FearGreedData["classification"] {
  if (value <= 24) return "Extreme Fear";
  if (value <= 49) return "Fear";
  if (value <= 74) return "Greed";
  return "Extreme Greed";
}

export async function fetchFearGreed(limit: number = 1): Promise<FearGreedData[]> {
  const url = `${BASE_URL}/fng/?limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Alternative.me error: ${res.status}`);
  }

  const data: AlternativeMeFngResponse = await res.json();

  if (data.metadata.error) {
    throw new Error(`Alternative.me API error: ${data.metadata.error}`);
  }

  return data.data.map((item) => ({
    value: parseInt(item.value, 10),
    classification: classify(parseInt(item.value, 10)),
    timestamp: new Date(parseInt(item.timestamp, 10) * 1000).toISOString(),
  }));
}

export async function fetchFearGreedToday(): Promise<FearGreedData> {
  const results = await fetchFearGreed(1);
  const result = results[0];
  if (!result) {
    throw new Error("Alternative.me returned empty data");
  }
  return result;
}

export async function fetchFearGreedHistory(days: number = 30): Promise<FearGreedData[]> {
  // API suporta até 2000 dias de histórico
  const clamped = Math.min(days, 2000);
  return fetchFearGreed(clamped);
}
