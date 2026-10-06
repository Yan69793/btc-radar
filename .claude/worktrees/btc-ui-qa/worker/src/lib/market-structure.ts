// BTC Radar — Estrutura de mercado determinística
// Regime, suportes/resistências, confluência, distância da EMA200,
// Golden/Death Cross e quality score. Tudo puro e testável, sem LLM.

import type { OHLCV } from "../types";

// ─── Regime de mercado ───

export type MarketRegime = "Tendência de Alta" | "Consolidação" | "Tendência de Baixa";

export interface RegimeInput {
  price: number;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
}

/**
 * Regra determinística: predomínio de sinais altistas vs baixistas.
 * Alta: preço > EMA21, EMA21 > EMA50, preço > EMA200.
 * Baixa: o inverso completo. Sinais mistos → Consolidação.
 * Nulos não contam como sinal (dado insuficiente não decide).
 */
export function classifyRegime(input: RegimeInput): MarketRegime {
  const { price, ema21, ema50, ema200 } = input;
  let bullish = 0;
  let bearish = 0;

  if (ema21 != null) {
    if (price > ema21) bullish++;
    if (price < ema21) bearish++;
  }
  if (ema21 != null && ema50 != null) {
    if (ema21 > ema50) bullish++;
    if (ema21 < ema50) bearish++;
  }
  if (ema200 != null) {
    if (price > ema200) bullish++;
    if (price < ema200) bearish++;
  }

  if (bullish > bearish && bullish >= 2) return "Tendência de Alta";
  if (bearish > bullish && bearish >= 2) return "Tendência de Baixa";
  return "Consolidação";
}

// ─── Distância da EMA200 ───

export function ema200Distance(price: number, ema200: number | null): number | null {
  if (ema200 == null || ema200 <= 0) return null;
  return round4((price / ema200 - 1) * 100);
}

// ─── Golden / Death Cross (somente EMA 50/200) ───

export type CrossType = "golden" | "death";

export interface CrossEvent {
  type: CrossType;
  index: number; // índice do candle em que ocorreu
}

/**
 * Último cruzamento 50/200. Percorre do fim para o começo e devolve o mais recente.
 * EMA 9/21 NÃO é Golden/Death Cross; esses termos ficam reservados ao 50/200.
 */
export function detectGoldenDeathCross(
  ema50: number[],
  ema200: number[],
): CrossEvent | null {
  const n = Math.min(ema50.length, ema200.length);
  for (let i = n - 1; i >= 1; i--) {
    const f = ema50[i];
    const s = ema200[i];
    const fp = ema50[i - 1];
    const sp = ema200[i - 1];
    if (f == null || s == null || fp == null || sp == null) continue;
    if (isNaN(f) || isNaN(s) || isNaN(fp) || isNaN(sp)) continue;
    if (fp <= sp && f > s) return { type: "golden", index: i };
    if (fp >= sp && f < s) return { type: "death", index: i };
  }
  return null;
}

// ─── Suportes e Resistências ───

export interface Level {
  price: number;
  confluence: number; // 1 = fraco, 2 = médio, 3+ = forte
  factors: string[];
}

export interface SupportResistance {
  resistances: Level[]; // R1, R2, R3 (mais próximos primeiro)
  supports: Level[]; // S1, S2, S3 (mais próximos primeiro)
}

export interface SRInput {
  candles: OHLCV[];
  price: number;
  atr: number;
  ema200: number | null;
}

interface Candidate {
  price: number;
  factor: string;
}

function roundPsychological(p: number): number {
  if (p >= 100_000) return Math.round(p / 1000) * 1000;
  if (p >= 10_000) return Math.round(p / 500) * 500;
  if (p >= 1_000) return Math.round(p / 100) * 100;
  return Math.round(p / 10) * 10;
}

function swingExtremes(candles: OHLCV[], lookback: number): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= candles[i]!.high) isHigh = false;
      if (candles[j]!.low <= candles[i]!.low) isLow = false;
    }
    if (isHigh) highs.push(candles[i]!.high);
    if (isLow) lows.push(candles[i]!.low);
  }
  return { highs, lows };
}

/**
 * Deriva suportes/resistências de swing highs/lows, extremos de janela,
 * nível psicológico e EMA200, agrupando níveis próximos por tolerância
 * (baseada em ATR) e contando confluência por fator distinto.
 */
export function supportResistance(input: SRInput): SupportResistance {
  const { candles, price, atr, ema200 } = input;
  if (candles.length < 20 || atr <= 0) {
    return { resistances: [], supports: [] };
  }

  const tolerance = Math.max(atr * 0.5, price * 0.002);
  const lookback = 5;
  const { highs, lows } = swingExtremes(candles, lookback);

  const candidates: Candidate[] = [];
  for (const h of highs) candidates.push({ price: h, factor: "swing-high" });
  for (const l of lows) candidates.push({ price: l, factor: "swing-low" });

  const window = candles.slice(-50);
  const recentHigh = Math.max(...window.map((c) => c.high));
  const recentLow = Math.min(...window.map((c) => c.low));
  candidates.push({ price: recentHigh, factor: "máxima-50" });
  candidates.push({ price: recentLow, factor: "mínima-50" });

  const weekly = candles.slice(-7);
  if (weekly.length > 0) {
    candidates.push({ price: Math.max(...weekly.map((c) => c.high)), factor: "high-semanal" });
    candidates.push({ price: Math.min(...weekly.map((c) => c.low)), factor: "low-semanal" });
  }

  candidates.push({ price: roundPsychological(price), factor: "psicológico" });
  if (ema200 != null) candidates.push({ price: ema200, factor: "ema200" });

  // Agrupa por proximidade e soma confluência
  const clusters: { price: number; sum: number; n: number; factors: string[] }[] = [];
  for (const c of candidates) {
    const hit = clusters.find((cl) => Math.abs(cl.price - c.price) <= tolerance);
    if (hit) {
      hit.sum += c.price;
      hit.n += 1;
      if (!hit.factors.includes(c.factor)) hit.factors.push(c.factor);
      hit.price = hit.sum / hit.n;
    } else {
      clusters.push({ price: c.price, sum: c.price, n: 1, factors: [c.factor] });
    }
  }

  const toLevel = (cl: typeof clusters[number]): Level => ({
    price: round4(cl.price),
    confluence: cl.factors.length,
    factors: [...cl.factors],
  });

  const resistances = clusters
    .filter((cl) => cl.price > price * (1 + tolerance / price))
    .map(toLevel)
    .sort((a, b) => a.price - b.price)
    .slice(0, 3);

  const supports = clusters
    .filter((cl) => cl.price < price * (1 - tolerance / price))
    .map(toLevel)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);

  return { resistances, supports };
}

export function confluenceLabel(confluence: number): "fraco" | "médio" | "forte" {
  if (confluence >= 3) return "forte";
  if (confluence === 2) return "médio";
  return "fraco";
}

// ─── Quality score ───

export interface QualityInput {
  sources: number; // nº de fontes válidas
  ageSeconds: number; // idade do dado mais relevante
  maxAgeSeconds: number; // janela de frescor esperada
  discrepancyPct: number | null; // divergência entre preços de referência
  hasBook: boolean; // book local disponível
  hasDerivatives: boolean; // derivativos disponíveis
  timestampRegressed: boolean; // alguma fonte regrediu no tempo
}

/**
 * Escore determinístico 0-100. NUNCA chamar de probabilidade.
 * Segue a fórmula do relatório de pesquisa, com floor em 0 e teto em 100.
 */
export function qualityScore(input: QualityInput): number {
  let score = 100;

  if (input.sources === 1) score -= 25;
  else if (input.sources === 0) score -= 50;

  if (input.maxAgeSeconds > 0 && input.ageSeconds > input.maxAgeSeconds * 2) score -= 15;

  if (input.discrepancyPct != null && input.discrepancyPct > 0.5) score -= 20;

  if (!input.hasBook) score -= 20;
  if (!input.hasDerivatives) score -= 10;
  if (input.timestampRegressed) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
