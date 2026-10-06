// BTC Radar — Consenso multi-timeframe
// Combina os vereditos dos 3 horizontes (short/medium/long) num unico
// veredito agregado, com pesos configuráveis e penalidade por divergência.
// Fonte de ideia: abordagem multi-timeframe alignment (daily/weekly/monthly
// alinhados superam entradas cegas). O objetivo aqui é dar ao trader um sinal
// consolidado em vez de 3 sinais que podem divergir.

import type { SignalDocument, Timeframe, Verdict } from "../types";

// ─── Pesos configuráveis por timeframe ───
// Longo prazo ancora mais (signal mais lento e estável), curto pesa menos.
// Ajustável aqui sem tocar nas rotas.
export const TIMEFRAME_WEIGHTS: Record<Timeframe, number> = {
  short: 0.2,
  medium: 0.3,
  long: 0.5,
};

// Threshold de convicção ponderada abaixo do qual o consenso abstém (AGUARDAR),
// mesmo que um timeframe isolado recomende COMPRAR/VENDER.
export const ABSTAIN_THRESHOLD = 4.5;

// Verdicts que contam como direcionais (empurram para ação).
const DIRECTIONAL: ReadonlySet<Verdict> = new Set(["COMPRAR", "VENDER", "REDUZIR"]);

export interface ConsensusResult {
  timeframe: "consensus";
  market_date: string;
  generated_at: string;
  verdict: Verdict;
  conviction: number; // 0-10, já com penalidade de divergência aplicada
  raw_conviction: number; // antes da penalidade
  divergence_penalty: number; // 0-1, quanto foi reduzido
  agreement: number; // 0-1, fração de timeframes alinhados ao veredito dominante
  weights: Record<Timeframe, number>;
  per_timeframe: Record<Timeframe, { verdict: Verdict; conviction: number }>;
  rationale: string;
  price: number | null;
}

// Verdict numérico para combinável: COMPRAR=+1, REDUZIR=+0.5, AGUARDAR=0, VENDER=-1
function verdictScore(v: Verdict): number {
  switch (v) {
    case "COMPRAR": return 1;
    case "REDUZIR": return 0.5;
    case "VENDER": return -1;
    default: return 0; // AGUARDAR
  }
}

function scoreToVerdict(score: number, conviction: number): Verdict {
  if (score >= 0.45) return conviction >= ABSTAIN_THRESHOLD ? "COMPRAR" : "AGUARDAR";
  if (score <= -0.45) return conviction >= ABSTAIN_THRESHOLD ? "VENDER" : "AGUARDAR";
  if (score >= 0.15) return "REDUZIR"; // leve alta, parcial
  return "AGUARDAR";
}

// Escolhe o veredito direcional dominante de um conjunto de sinais de UM timeframe.
// Se não houver direcional, usa o de maior convicção (geralmente AGUARDAR).
function dominantVerdict(signals: SignalDocument[]): { verdict: Verdict; conviction: number } {
  if (signals.length === 0) return { verdict: "AGUARDAR", conviction: 0 };

  const directional = signals.filter((s) => DIRECTIONAL.has(s.verdict));
  const pool = directional.length > 0 ? directional : signals;
  return pool.reduce((best, s) =>
    s.conviction > best.conviction ? { verdict: s.verdict, conviction: s.conviction } : best,
    { verdict: pool[0]!.verdict, conviction: pool[0]!.conviction }
  );
}

/**
 * Combina os sinais dos 3 horizontes num veredito de consenso.
 * Recebe um mapa timeframe -> sinais (ou um array plano, filtrado por timeframe).
 * NÃO muta os sinais de entrada, apenas os agrega.
 */
export function computeConsensus(
  signals: SignalDocument[] | Record<Timeframe, SignalDocument[]>,
): ConsensusResult | null {
  const byTf = Array.isArray(signals) ? groupByTimeframe(signals) : signals;

  const now = new Date().toISOString();
  const marketDate = now.slice(0, 10);

  // 1. Extrai veredito dominante por timeframe com convicção base (peso interno)
  const perTimeframe: ConsensusResult["per_timeframe"] = {
    short: dominantVerdict(byTf.short),
    medium: dominantVerdict(byTf.medium),
    long: dominantVerdict(byTf.long),
  };

  // 2. Escore direcional ponderado por timeframe
  let weightedScore = 0;
  let anySignal = false;
  const contribs: Array<{ tf: Timeframe; score: number; weight: number }> = [];
  for (const tf of ["short", "medium", "long"] as Timeframe[]) {
    const { verdict, conviction } = perTimeframe[tf];
    if (conviction === 0) continue; // sem dado naquele timeframe, não pesa
    anySignal = true;
    const score = verdictScore(verdict) * conviction; // usa a convicção para amplificar
    weightedScore += score * TIMEFRAME_WEIGHTS[tf];
    contribs.push({ tf, score, weight: TIMEFRAME_WEIGHTS[tf] });
  }

  if (!anySignal) return null;

  // 3. Convicção ponderada bruta (0-10, escalada pela convicção de cada timeframe)
  const rawConviction = contribs.reduce((acc, c) => acc + Math.abs(c.score) * c.weight, 0);
  const conviction = Math.min(10, rawConviction);

  // 4. Penalidade por divergência: quanto mais os timeframes discordam, maior a redução.
  //    Compara o sinal de cada veredito com o score ponderado dominante.
  const signs = contribs.map((c) => Math.sign(c.score));
  const positive = signs.filter((s) => s > 0).length;
  const negative = signs.filter((s) => s < 0).length;
  // agreement = (máx(pos, neg) / total) ; 1 = todos concordam, 0 = empate perfeito
  const total = signs.length || 1;
  const agreement = Math.max(positive, negative) / total;
  const divergencePenalty = 1 - agreement; // 0 (sem divergência) a 1 (máxima)

  // Aplica penalidade: convicção cai conforme divergência, mas nunca abaixo de 0.
  const penalized = Math.max(0, conviction - divergencePenalty * conviction * 0.7);

  // 5. Decide o veredito final pelo escore ponderado agregado, com abstain por convicção
  const finalScore = weightedScore;
  const verdict = scoreToVerdict(finalScore, penalized);

  const price = findLatestPrice(byTf);
  const rationale = buildRationale(perTimeframe, agreement, divergencePenalty, verdict);

  return {
    timeframe: "consensus",
    market_date: marketDate,
    generated_at: now,
    verdict,
    conviction: Math.round(penalized * 10) / 10,
    raw_conviction: Math.round(conviction * 10) / 10,
    divergence_penalty: Math.round(divergencePenalty * 100) / 100,
    agreement: Math.round(agreement * 100) / 100,
    weights: { ...TIMEFRAME_WEIGHTS },
    per_timeframe: perTimeframe,
    rationale,
    price,
  };
}

function groupByTimeframe(signals: SignalDocument[]): Record<Timeframe, SignalDocument[]> {
  return {
    short: signals.filter((s) => s.timeframe === "short"),
    medium: signals.filter((s) => s.timeframe === "medium"),
    long: signals.filter((s) => s.timeframe === "long"),
  };
}

function findLatestPrice(byTf: Record<Timeframe, SignalDocument[]>): number | null {
  // Prefere o entry_price do sinal direcional de maior convicção, senão o primeiro preço disponível.
  for (const s of allSignals(byTf).sort((a, b) => b.conviction - a.conviction)) {
    if (s.entry_price != null) return s.entry_price;
  }
  return null;
}

function allSignals(byTf: Record<Timeframe, SignalDocument[]>): SignalDocument[] {
  return [...byTf.short, ...byTf.medium, ...byTf.long];
}

function buildRationale(
  perTimeframe: ConsensusResult["per_timeframe"],
  agreement: number,
  divergencePenalty: number,
  verdict: Verdict,
): string {
  const parts = (["short", "medium", "long"] as Timeframe[]).map((tf) =>
    `${tf}: ${perTimeframe[tf].verdict} (conv ${perTimeframe[tf].conviction})`
  );

  const agreeNote = agreement >= 0.66
    ? "timeframes alinhados (alta convergência)."
    : agreement >= 0.5
      ? "alignamento parcial entre timeframes."
      : `divergência alta entre timeframes, penalidade de ${Math.round(divergencePenalty * 100)}%.`;

  return `Consenso multi-timeframe. ${parts.join(" | ")}. ${agreeNote} Verdict final: ${verdict}.`;
}
