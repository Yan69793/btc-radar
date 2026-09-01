// BTC Radar — Rotas de backtest
// GET  /api/backtest            — listar runs com scores
// GET  /api/backtest/:id        — detalhe de um run com score
// GET  /api/backtest/:id/score  — apenas o score detalhado
// POST /api/backtest            — salvar resultado de backtest
// GET  /api/backtest/score/distribution — distribuicao de scores para o gauge

import { Hono } from "hono";
import type { Env } from "../types";
import type { BacktestRun } from "../types";
import { calculateScore, calculateAllScores } from "../lib/backtest-score";

export const backtestRoutes = new Hono<{ Bindings: Env }>();

// Cache KV da distribuicao de scores (gauge). Recalculada a cada 1h ou
// invalidada no POST de um novo run.
const SCORE_DISTRIBUTION_KV_KEY = "btc:backtest:score-dist";
const SCORE_DISTRIBUTION_TTL_SECONDS = 3600; // 1 hora

interface ScoreDistribution {
  count: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

function runFromRow(row: Record<string, unknown>): BacktestRun {
  return {
    id: row.id as string,
    strategy: row.strategy as BacktestRun["strategy"],
    params: row.params ? JSON.parse(row.params as string) : {},
    date_from: row.date_from as string,
    date_to: row.date_to as string,
    run_at: row.run_at as string,
    total_return: row.total_return != null ? Number(row.total_return) : null,
    sharpe_ratio: row.sharpe_ratio != null ? Number(row.sharpe_ratio) : null,
    max_drawdown: row.max_drawdown != null ? Number(row.max_drawdown) : null,
    win_rate: row.win_rate != null ? Number(row.win_rate) : null,
    n_trades: row.n_trades != null ? Number(row.n_trades) : null,
    payload: row.payload ? JSON.parse(row.payload as string) : null,
  };
}

// GET /api/backtest — listar runs com scores
backtestRoutes.get("/", async (c) => {
  try {
    const strategy = c.req.query("strategy") as string | undefined;

    let sql = "SELECT * FROM backtest_runs WHERE 1=1";
    const params: unknown[] = [];
    if (strategy) { sql += " AND strategy = ?"; params.push(strategy); }
    sql += " ORDER BY run_at DESC LIMIT 30";

    const result = await c.env.DB.prepare(sql).bind(...(params as [])).all();
    const runs: BacktestRun[] = (result.results || []).map(runFromRow);

    // Calcular scores para todos os runs (cada um contra os outros)
    const scoreMap = calculateAllScores(runs);

    const data = runs.map((run) => ({
      ...run,
      score_data: scoreMap.get(run.id) ?? null,
    }));

    return c.json({
      success: true,
      data,
      count: runs.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao listar backtests";
    return c.json({ success: false, data: [], error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// GET /api/backtest/score/distribution — distribuicao de scores (para o gauge)
// NOTA: deve vir ANTES de /:id para nao ser capturado como parametro
backtestRoutes.get("/score/distribution", async (c) => {
  try {
    // 1. Tentar servir do cache KV (TTL 1h). KV indisponivel ou cache vazio
    // cai direto no calculo, sem derrubar a rota.
    let cachedData: ScoreDistribution | null = null;
    try {
      const cached = await c.env.KV.get(SCORE_DISTRIBUTION_KV_KEY);
      if (cached) cachedData = JSON.parse(cached) as ScoreDistribution;
    } catch {
      cachedData = null; // leitura falhou: recalcula no D1
    }

    if (cachedData) {
      return c.json({
        success: true,
        data: cachedData,
        timestamp: new Date().toISOString(),
      });
    }

    const allRows = await c.env.DB.prepare("SELECT * FROM backtest_runs ORDER BY run_at DESC LIMIT 200").all();
    const allRuns: BacktestRun[] = (allRows.results || []).map(runFromRow);

    const scoreMap = calculateAllScores(allRuns);
    const scores: number[] = [];

    for (const result of scoreMap.values()) {
      if (result && result.gates_passed) {
        scores.push(result.score);
      }
    }

    scores.sort((a, b) => a - b);

    // Calcular marcadores de percentil
    const p = (pct: number) => {
      if (scores.length === 0) return 0;
      const idx = Math.min(Math.floor((pct / 100) * (scores.length - 1)), scores.length - 1);
      return scores[idx]!; // idx clampado em [0, length-1], sempre em bounds
    };

    const distribution: ScoreDistribution = {
      count: scores.length,
      p5: p(5),
      p25: p(25),
      p50: p(50),
      p75: p(75),
      p95: p(95),
    };

    // 2. Gravar no cache KV. Falha de escrita nao derruba a resposta.
    try {
      await c.env.KV.put(SCORE_DISTRIBUTION_KV_KEY, JSON.stringify(distribution), {
        expirationTtl: SCORE_DISTRIBUTION_TTL_SECONDS,
      });
    } catch {
      // cache opcional: proxima leitura recalcula
    }

    return c.json({
      success: true,
      data: distribution,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao calcular distribuicao";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// GET /api/backtest/:id — detalhe com score
backtestRoutes.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const row = await c.env.DB.prepare("SELECT * FROM backtest_runs WHERE id = ?")
      .bind(id).first<Record<string, unknown>>();

    if (!row) {
      return c.json({ success: false, data: null, error: "Backtest nao encontrado", timestamp: new Date().toISOString() }, 404);
    }

    const run = runFromRow(row);

    // Buscar todos para referencia de score
    const allRows = await c.env.DB.prepare("SELECT * FROM backtest_runs ORDER BY run_at DESC LIMIT 100").all();
    const allRuns: BacktestRun[] = (allRows.results || []).map(runFromRow);
    const scoreData = calculateScore(run, allRuns);

    return c.json({
      success: true,
      data: { ...run, score_data: scoreData },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar backtest";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// GET /api/backtest/:id/score — apenas o score detalhado
backtestRoutes.get("/:id/score", async (c) => {
  try {
    const id = c.req.param("id");
    const row = await c.env.DB.prepare("SELECT * FROM backtest_runs WHERE id = ?")
      .bind(id).first<Record<string, unknown>>();

    if (!row) {
      return c.json({ success: false, data: null, error: "Backtest nao encontrado", timestamp: new Date().toISOString() }, 404);
    }

    const run = runFromRow(row);

    // Buscar todos para referencia
    const allRows = await c.env.DB.prepare("SELECT * FROM backtest_runs ORDER BY run_at DESC LIMIT 100").all();
    const allRuns: BacktestRun[] = (allRows.results || []).map(runFromRow);
    const scoreData = calculateScore(run, allRuns);

    return c.json({
      success: true,
      data: scoreData,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao calcular score";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// POST /api/backtest — salvar resultado
backtestRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      strategy?: string;
      params?: Record<string, unknown>;
      date_from?: string;
      date_to?: string;
      total_return?: number;
      sharpe_ratio?: number;
      max_drawdown?: number;
      win_rate?: number;
      n_trades?: number;
      payload?: Record<string, unknown>;
    }>();

    if (!body.strategy) {
      return c.json({
        success: false, data: null,
        error: "Campo obrigatorio: strategy",
        timestamp: new Date().toISOString(),
      }, 400);
    }

    const id = `bt-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO backtest_runs (id, strategy, params, date_from, date_to, run_at,
        total_return, sharpe_ratio, max_drawdown, win_rate, n_trades, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.strategy,
        body.params ? JSON.stringify(body.params) : "{}",
        body.date_from ?? "",
        body.date_to ?? "",
        now,
        body.total_return ?? null,
        body.sharpe_ratio ?? null,
        body.max_drawdown ?? null,
        body.win_rate ?? null,
        body.n_trades ?? null,
        body.payload ? JSON.stringify(body.payload) : null,
      )
      .run();

    // Novo run salvo: invalidar o cache da distribuicao de scores para o
    // proximo GET recalcular com a populacao atualizada.
    try {
      await c.env.KV.delete(SCORE_DISTRIBUTION_KV_KEY);
    } catch {
      // cache opcional: expira sozinho em ate 1h
    }

    const run: BacktestRun = {
      id,
      strategy: body.strategy as BacktestRun["strategy"],
      params: body.params ?? {},
      date_from: body.date_from ?? "",
      date_to: body.date_to ?? "",
      run_at: now,
      total_return: body.total_return ?? null,
      sharpe_ratio: body.sharpe_ratio ?? null,
      max_drawdown: body.max_drawdown ?? null,
      win_rate: body.win_rate ?? null,
      n_trades: body.n_trades ?? null,
      payload: body.payload ?? null,
    };

    return c.json({ success: true, data: run, timestamp: now }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao salvar backtest";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});
