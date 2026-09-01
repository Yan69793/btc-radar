// BTC Radar — Testes do motor de score de backtests
// Valores esperados calculados a mao abaixo; a populacao usa janela
// 2026-01-05 a 2026-01-09 (seg-sex, 5 dias uteis) para trading_days fixo em 5.

import { describe, expect, it } from "vitest";
import { calculateScore, percentileRank } from "../src/lib/backtest-score";
import type { BacktestRun } from "../src/types";

function makeRun(partial: Partial<BacktestRun> & { id: string }): BacktestRun {
  return {
    strategy: "grid_trading",
    params: {},
    date_from: "2026-01-05",
    date_to: "2026-01-09",
    run_at: "2026-01-10T12:00:00.000Z",
    total_return: null,
    sharpe_ratio: null,
    max_drawdown: null,
    win_rate: null,
    n_trades: null,
    payload: null,
    ...partial,
  };
}

// Populacao de referencia (4 runs qualificados, todos com 5 dias uteis):
//   A: ev=1  dd=20 ret=10 ops=2  wr=50  -> score 5
//   B: ev=1  dd=15 ret=20 ops=4  wr=60  -> score 22.5
//   C: ev=1  dd=10 ret=30 ops=6  wr=70  -> score 40
//   D: ev=1  dd=5  ret=40 ops=8  wr=80  -> score 57.5
const population: BacktestRun[] = [
  makeRun({ id: "A", total_return: 10, max_drawdown: 20, win_rate: 50, n_trades: 10 }),
  makeRun({ id: "B", total_return: 20, max_drawdown: 15, win_rate: 60, n_trades: 20 }),
  makeRun({ id: "C", total_return: 30, max_drawdown: 10, win_rate: 70, n_trades: 30 }),
  makeRun({ id: "D", total_return: 40, max_drawdown: 5, win_rate: 80, n_trades: 40 }),
];

// Alvo: ev=1, dd=12, ret=25, ops=5, wr=65
const target = makeRun({
  id: "T",
  total_return: 25,
  max_drawdown: 12,
  win_rate: 65,
  n_trades: 25,
});

describe("percentileRank", () => {
  it("retorna 0 no extremo inferior e 100 acima do maximo da populacao", () => {
    expect(percentileRank(1, [1, 2, 3, 4], true)).toBe(0);
    expect(percentileRank(5, [1, 2, 3, 4], true)).toBe(100);
  });

  it("o maximo da populacao nunca chega a 100 (conta estritamente menores)", () => {
    // valores < 4: tres -> 3/4 = 75
    expect(percentileRank(4, [1, 2, 3, 4], true)).toBe(75);
  });

  it("retorna 50 na mediana", () => {
    expect(percentileRank(2.5, [1, 2, 3, 4], true)).toBe(50);
  });

  it("empates nao elevam o percentil (conta apenas estritamente menores)", () => {
    // valores < 2: apenas o 1 -> 1/4 = 25
    expect(percentileRank(2, [1, 2, 2, 4], true)).toBe(25);
    expect(percentileRank(2, [2, 2, 2, 2], true)).toBe(0);
  });

  it("inverte para lower is better", () => {
    expect(percentileRank(2, [1, 2, 2, 4], false)).toBe(75);
  });

  it("populacao vazia assume mediana (50)", () => {
    expect(percentileRank(5, [], true)).toBe(50);
  });

  it("aceita populacao fora de ordem (ordena internamente)", () => {
    expect(percentileRank(3, [4, 1, 3, 2], true)).toBe(50);
  });
});

describe("calculateScore", () => {
  const result = calculateScore(target, [...population, target]);

  it("calcula o score ponderado conforme a mao", () => {
    // Percentis do alvo: ev=0, dd=50, ret=50, ops=50, wr=50
    // score = (0*3 + 50*2 + 50*2 + 50*2 + 50*1) / 10 = 350/10 = 35
    expect(result).not.toBeNull();
    expect(result!.score).toBeCloseTo(35, 6);
  });

  it("monta o breakdown com percentil, peso e contribuicao", () => {
    expect(result!.breakdown.ev).toMatchObject({ raw: 1, percentile: 0, weight: 3, contribution: 0 });
    expect(result!.breakdown.drawdown).toMatchObject({ raw: 12, percentile: 50, weight: 2, contribution: 10 });
    expect(result!.breakdown.return_pct).toMatchObject({ raw: 25, percentile: 50, weight: 2, contribution: 10 });
    expect(result!.breakdown.ops_per_day).toMatchObject({ raw: 5, percentile: 50, weight: 2, contribution: 10 });
    expect(result!.breakdown.win_rate).toMatchObject({ raw: 65, percentile: 50, weight: 1, contribution: 5 });
  });

  it("classifica o score contra os demais runs da populacao", () => {
    // Scores dos 4 qualifying: [5, 22.5, 40, 57.5] -> 35 tem 2 estritamente
    // menores -> percentil 50 -> classificacao "Ruim" (limite 50)
    expect(result!.classification_percentile).toBeCloseTo(50, 6);
    expect(result!.classification).toBe("Ruim");
  });

  it("reporta gates aprovados e tamanho da referencia", () => {
    expect(result!.gates_passed).toBe(true);
    expect(result!.gate_failures).toEqual([]);
    expect(result!.compared_against).toBe(4);
  });

  it("marca gates falhos com score 0 e classificacao Pessimo", () => {
    const failed = makeRun({ id: "F", n_trades: 2, total_return: 50 });
    const failedResult = calculateScore(failed, [...population, failed]);
    expect(failedResult).not.toBeNull();
    expect(failedResult!.gates_passed).toBe(false);
    expect(failedResult!.gate_failures).toEqual(["Minimo de 5 trades (atual: 2)"]);
    expect(failedResult!.score).toBe(0);
    expect(failedResult!.classification).toBe("Pessimo");
  });
});
