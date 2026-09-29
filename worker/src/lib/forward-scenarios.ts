import type { OHLCV } from "../types";

export type TrendRegime = "bull" | "neutral" | "bear";
export type VolRegime = "low" | "normal" | "high";

export interface Regime {
  trend: TrendRegime;
  volatility: VolRegime;
  key: string;
  return_30d_pct: number;
  realized_vol_30d_pct: number;
}

export interface HorizonScenario {
  horizon_days: number;
  available: boolean;
  conditioning: "regime" | "unconditional" | "insufficient";
  sample_size: number;
  effective_sample_size: number;
  confidence: "high" | "medium" | "limited";
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
}

function pct(v: number): number {
  return Math.round(v * 10000) / 100;
}

function returns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (prev > 0 && cur > 0) out.push(cur / prev - 1);
  }
  return out;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function classifyForwardRegime(candles: OHLCV[], index = candles.length - 1): Regime | null {
  if (index < 30 || index >= candles.length) return null;
  const close = candles[index]!.close;
  const close30 = candles[index - 30]!.close;
  if (!(close > 0) || !(close30 > 0)) return null;

  const return30 = close / close30 - 1;
  const daily = returns(candles.slice(index - 30, index + 1).map((c) => c.close));
  const realizedVol = std(daily) * Math.sqrt(365);

  const trend: TrendRegime = return30 > 0.10 ? "bull" : return30 < -0.10 ? "bear" : "neutral";
  const volatility: VolRegime = realizedVol > 0.75 ? "high" : realizedVol < 0.40 ? "low" : "normal";

  return {
    trend,
    volatility,
    key: `${trend}:${volatility}`,
    return_30d_pct: pct(return30),
    realized_vol_30d_pct: pct(realizedVol),
  };
}

export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const weight = pos - lo;
  return sorted[lo]! * (1 - weight) + sorted[hi]! * weight;
}

function confidenceFromEffective(n: number): HorizonScenario["confidence"] {
  return n >= 20 ? "high" : n >= 8 ? "medium" : "limited";
}

function summarize(
  horizon: number,
  sample: number[],
  conditioning: HorizonScenario["conditioning"],
  effectiveSampleSize: number,
): HorizonScenario {
  if (sample.length === 0) {
    return {
      horizon_days: horizon,
      available: false,
      conditioning: "insufficient",
      sample_size: 0,
      effective_sample_size: 0,
      confidence: "limited",
      p10: null, p25: null, p50: null, p75: null, p90: null, min: null, max: null,
    };
  }
  const sorted = [...sample].sort((a, b) => a - b);
  return {
    horizon_days: horizon,
    available: true,
    conditioning,
    sample_size: sample.length,
    effective_sample_size: effectiveSampleSize,
    confidence: confidenceFromEffective(effectiveSampleSize),
    p10: pct(quantile(sample, 0.10)!),
    p25: pct(quantile(sample, 0.25)!),
    p50: pct(quantile(sample, 0.50)!),
    p75: pct(quantile(sample, 0.75)!),
    p90: pct(quantile(sample, 0.90)!),
    min: pct(sorted[0]!),
    max: pct(sorted[sorted.length - 1]!),
  };
}

export function computeForwardScenarios(
  candlesInput: OHLCV[],
  horizons: number[] = [30, 90, 180, 365],
  minConditioned = 30,
  minUnconditional = 40,
) {
  const candles = [...candlesInput]
    .filter((c) => Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const currentRegime = classifyForwardRegime(candles);
  const byHorizon: Record<string, HorizonScenario> = {};

  for (const horizon of horizons) {
    const unconditional: number[] = [];
    const conditioned: number[] = [];

    for (let i = 30; i + horizon < candles.length; i++) {
      const start = candles[i]!.close;
      const end = candles[i + horizon]!.close;
      if (!(start > 0) || !(end > 0)) continue;
      const forward = end / start - 1;
      unconditional.push(forward);

      const historicalRegime = classifyForwardRegime(candles, i);
      if (currentRegime && historicalRegime?.key === currentRegime.key) {
        conditioned.push(forward);
      }
    }

    // Rolling forward returns se sobrepoem. Para nao fingir independencia, estimamos
    // uma amostra efetiva conservadora pelo numero de blocos de tamanho `horizon`.
    // Para o subconjunto de regime, escalamos esse numero pela participacao do regime.
    const effectiveUnconditional = Math.floor(Math.max(0, candles.length - 30) / horizon);
    const regimeShare = unconditional.length > 0 ? conditioned.length / unconditional.length : 0;
    const effectiveConditioned = Math.floor(effectiveUnconditional * regimeShare);

    if (conditioned.length >= minConditioned && effectiveConditioned >= 6) {
      byHorizon[String(horizon)] = summarize(horizon, conditioned, "regime", effectiveConditioned);
    } else if (unconditional.length >= minUnconditional && effectiveUnconditional >= 6) {
      byHorizon[String(horizon)] = summarize(horizon, unconditional, "unconditional", effectiveUnconditional);
    } else {
      byHorizon[String(horizon)] = summarize(horizon, [], "insufficient", 0);
    }
  }

  return {
    method: "empirical-forward-returns-v1",
    current_regime: currentRegime,
    history: {
      candles: candles.length,
      from: candles[0]?.timestamp ?? null,
      to: candles[candles.length - 1]?.timestamp ?? null,
    },
    horizons: byHorizon,
    annual_ready: byHorizon["365"]?.available === true && (byHorizon["365"]?.effective_sample_size ?? 0) >= 6,
  };
}
