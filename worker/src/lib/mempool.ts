// Mempool.space API connector — dados on-chain Bitcoin
// API gratuita, sem chave
// Docs: https://mempool.space/docs/api

import type { OnChainSnapshot } from "../types";

const BASE_URL = "https://mempool.space/api/v1";

interface MempoolFeeRate {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

interface HashrateData {
  currentHashrate: number;        // H/s
  currentDifficulty: number;
  hashrates: Array<{
    timestamp: number;
    avgHashrate: number;           // H/s
  }>;
}

export async function fetchOnChainSnapshot(): Promise<OnChainSnapshot> {
  const now = new Date().toISOString();

  const [feeRes, hrRes, tipRes] = await Promise.allSettled([
    fetch(`${BASE_URL}/fees/recommended`),
    fetch(`${BASE_URL}/mining/hashrate/1w`),
    fetch(`${BASE_URL}/blocks/tip/height`),
  ]);

  // Hash rate + difficulty
  let hashRate: number | null = null;
  let difficulty: number | null = null;
  if (hrRes.status === "fulfilled" && hrRes.value.ok) {
    const hr: HashrateData = await hrRes.value.json();
    hashRate = Math.round(hr.currentHashrate / 1e12); // H/s -> TH/s
    difficulty = Math.round(hr.currentDifficulty / 1e12 * 100) / 100; // -> T
  }

  // Taxas recomendadas (sat/vB)
  let avgFee: number | null = null;
  if (feeRes.status === "fulfilled" && feeRes.value.ok) {
    const fees: MempoolFeeRate = await feeRes.value.json();
    avgFee = fees.halfHourFee ?? fees.hourFee ?? null;
  }

  // Bloco atual
  let height: number | null = null;
  if (tipRes.status === "fulfilled" && tipRes.value.ok) {
    height = parseInt(await tipRes.value.text());
  }

  // Limitação conhecida (P3-003, 12/09/2026): mempool.space gratuito não expõe
  // endereços ativos, contagem/volume de tx nem supply circulante. A UI trata
  // null como "Indisponível". Popular isso exige 2º provedor; fora de escopo
  // até virar necessidade de produto.
  return {
    timestamp: now,
    hash_rate: hashRate,
    difficulty,
    active_addresses: null,
    transaction_count: null,
    transaction_volume_usd: null,
    avg_fee_sats: avgFee,
    block_height: height,
    circulating_supply: null,
    source: "mempool.space",
  };
}
