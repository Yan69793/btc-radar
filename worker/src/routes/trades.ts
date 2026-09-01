// BTC Radar — Rotas de trades
// GET    /api/trades             — listar trades (filtros: ?status=, ?strategy=)
// POST   /api/trades             — abrir trade
// PUT    /api/trades/:id         — atualizar trade (fechar, editar)
// DELETE /api/trades/:id         — cancelar trade
// GET    /api/trades/performance — metricas de performance

import { Hono } from "hono";
import type { Env } from "../types";
import type {
  Trade,
  TradeDirection,
  TradeStatus,
  ExitReason,
  TradePerformance,
} from "../types";

export const tradeRoutes = new Hono<{ Bindings: Env }>();

// ─── Helpers ───

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomUUID().slice(0, 8);
  return `trade-${ts}-${rand}`;
}

function computePnL(
  entry: number,
  exit: number,
  qty: number,
  direction: TradeDirection,
  fees: number
): { pnl_usd: number; pnl_pct: number } {
  const entryValue = entry * qty;
  const exitValue = exit * qty;
  let pnl: number;

  if (direction === "long") {
    pnl = exitValue - entryValue - fees;
  } else {
    pnl = entryValue - exitValue - fees;
  }

  const pnl_pct = entryValue > 0 ? (pnl / entryValue) * 100 : 0;
  return {
    pnl_usd: Math.round(pnl * 100) / 100,
    pnl_pct: Math.round(pnl_pct * 100) / 100,
  };
}

function tradeFromRow(row: Record<string, unknown>): Trade {
  return {
    id: row.id as string,
    signal_id: row.signal_id as string | null,
    symbol: row.symbol as string,
    direction: row.direction as TradeDirection,
    entry_price: Number(row.entry_price),
    exit_price: row.exit_price != null ? Number(row.exit_price) : null,
    quantity: Number(row.quantity),
    entry_date: row.entry_date as string,
    exit_date: row.exit_date as string | null,
    status: row.status as TradeStatus,
    pnl_usd: row.pnl_usd != null ? Number(row.pnl_usd) : null,
    pnl_pct: row.pnl_pct != null ? Number(row.pnl_pct) : null,
    exit_reason: row.exit_reason as ExitReason | null,
    fees: Number(row.fees ?? 0),
    strategy: row.strategy as Trade["strategy"],
  };
}

// ─── GET /api/trades — listar trades ───

tradeRoutes.get("/", async (c) => {
  try {
    const status = c.req.query("status") as TradeStatus | undefined;
    const strategy = c.req.query("strategy") as string | undefined;

    let sql = "SELECT * FROM trades WHERE 1=1";
    const params: unknown[] = [];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (strategy) {
      sql += " AND strategy = ?";
      params.push(strategy);
    }

    sql += " ORDER BY entry_date DESC LIMIT 100";

    const result = await c.env.DB.prepare(sql).bind(...(params as [])).all();
    const trades: Trade[] = (result.results || []).map(tradeFromRow);

    return c.json({
      success: true,
      data: trades,
      count: trades.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao listar trades";
    return c.json({ success: false, data: [], error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── GET /api/trades/performance — metricas de performance ───

tradeRoutes.get("/performance", async (c) => {
  try {
    // Agregacao direto no SQL — evita trazer todos os trades fechados para o Worker
    const agg = await c.env.DB.prepare(
      `SELECT
         COUNT(*) AS n_trades,
         SUM(CASE WHEN pnl_usd >= 0 THEN 1 ELSE 0 END) AS winning,
         SUM(pnl_usd) AS total_pnl,
         SUM(CASE WHEN pnl_usd >= 0 THEN pnl_usd ELSE 0 END) AS gross_profit,
         SUM(CASE WHEN pnl_usd < 0 THEN ABS(pnl_usd) ELSE 0 END) AS gross_loss,
         MAX(COALESCE(pnl_pct, 0)) AS best_trade_pct,
         MIN(COALESCE(pnl_pct, 0)) AS worst_trade_pct,
         SUM(julianday(exit_date) - julianday(entry_date)) AS total_hold_days
       FROM trades WHERE status = 'closed' AND pnl_usd IS NOT NULL`
    ).first<Record<string, unknown>>();

    const nTrades = Number(agg?.n_trades ?? 0);
    const winning = Number(agg?.winning ?? 0);
    const totalPnl = Number(agg?.total_pnl ?? 0);
    const grossProfit = Number(agg?.gross_profit ?? 0);
    const grossLoss = Number(agg?.gross_loss ?? 0);
    const bestTradePct = Number(agg?.best_trade_pct ?? 0);
    const worstTradePct = Number(agg?.worst_trade_pct ?? 0);
    const totalHoldDays = agg?.total_hold_days != null ? Number(agg.total_hold_days) : 0;

    // Win rate
    const winRate = nTrades > 0 ? (winning / nTrades) * 100 : 0;

    // Avg hold days (mesma semantica anterior: so trades com datas no numerador, dividido por todos)
    let avgHoldDays: number | null = null;
    if (nTrades > 0) {
      avgHoldDays = Math.round((totalHoldDays / nTrades) * 10) / 10;
    }

    // Profit factor. Infinity nao serializa em JSON (vira null), entao contrato e null direto:
    // lucro sem perda = null, frontend trata como infinito
    const profitFactor: number | null = grossLoss > 0
      ? Math.round((grossProfit / grossLoss) * 100) / 100
      : (grossProfit > 0 ? null : 0);

    // Trades abertos
    const openResult = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM trades WHERE status = 'open'"
    ).first<{ cnt: number }>();
    const openCount = openResult?.cnt ?? 0;

    const performance: TradePerformance & { open_trades: number } = {
      total_pnl: Math.round(totalPnl * 100) / 100,
      win_rate: Math.round(winRate * 100) / 100,
      sharpe_ratio: null,
      n_trades: nTrades,
      avg_hold_days: avgHoldDays,
      best_trade_pct: Math.round(bestTradePct * 100) / 100,
      worst_trade_pct: Math.round(worstTradePct * 100) / 100,
      profit_factor: profitFactor,
      open_trades: openCount,
    };

    return c.json({
      success: true,
      data: performance,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao calcular performance";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── POST /api/trades — abrir trade ───

tradeRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      symbol?: string;
      direction?: TradeDirection;
      entry_price?: number;
      quantity?: number;
      entry_date?: string;
      strategy?: string;
      signal_id?: string;
      fees?: number;
    }>();

    // Validacao basica
    if (!body.direction || !body.entry_price || !body.quantity) {
      return c.json({
        success: false,
        data: null,
        error: "Campos obrigatorios: direction, entry_price, quantity",
        timestamp: new Date().toISOString(),
      }, 400);
    }

    if (!["long", "short"].includes(body.direction)) {
      return c.json({
        success: false,
        data: null,
        error: "direction deve ser 'long' ou 'short'",
        timestamp: new Date().toISOString(),
      }, 400);
    }

    const id = generateId();
    const now = new Date().toISOString();

    const trade: Trade = {
      id,
      signal_id: body.signal_id ?? null,
      symbol: body.symbol ?? "BTC-USD",
      direction: body.direction,
      entry_price: body.entry_price,
      exit_price: null,
      quantity: body.quantity,
      entry_date: body.entry_date ?? now,
      exit_date: null,
      status: "open",
      pnl_usd: null,
      pnl_pct: null,
      exit_reason: null,
      fees: body.fees ?? 0,
      strategy: (body.strategy as Trade["strategy"]) ?? "dca",
    };

    await c.env.DB.prepare(
      `INSERT INTO trades (id, signal_id, symbol, direction, entry_price, exit_price, quantity,
        entry_date, exit_date, status, pnl_usd, pnl_pct, exit_reason, fees, strategy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        trade.id, trade.signal_id, trade.symbol, trade.direction,
        trade.entry_price, trade.exit_price, trade.quantity,
        trade.entry_date, trade.exit_date, trade.status,
        trade.pnl_usd, trade.pnl_pct, trade.exit_reason,
        trade.fees, trade.strategy
      )
      .run();

    return c.json({
      success: true,
      data: trade,
      timestamp: new Date().toISOString(),
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao criar trade";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── PUT /api/trades/:id — atualizar trade (fechar) ───

tradeRoutes.put("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json<{
      exit_price?: number;
      exit_date?: string;
      exit_reason?: ExitReason;
      status?: TradeStatus;
      fees?: number;
    }>();

    // Buscar trade existente
    const existing = await c.env.DB.prepare("SELECT * FROM trades WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();

    if (!existing) {
      return c.json({
        success: false,
        data: null,
        error: "Trade nao encontrado",
        timestamp: new Date().toISOString(),
      }, 404);
    }

    const trade = tradeFromRow(existing);
    const now = new Date().toISOString();

    // Atualizar campos
    if (body.exit_price != null) trade.exit_price = body.exit_price;
    if (body.exit_date != null) trade.exit_date = body.exit_date;
    if (body.exit_reason != null) trade.exit_reason = body.exit_reason;
    if (body.status != null) trade.status = body.status;
    if (body.fees != null) trade.fees = body.fees;

    // Se fechando, calcular P&L
    if (trade.status === "closed" && trade.exit_price != null) {
      const { pnl_usd, pnl_pct } = computePnL(
        trade.entry_price,
        trade.exit_price,
        trade.quantity,
        trade.direction,
        trade.fees
      );
      trade.pnl_usd = pnl_usd;
      trade.pnl_pct = pnl_pct;
      if (!trade.exit_date) trade.exit_date = now;
    }

    await c.env.DB.prepare(
      `UPDATE trades SET
        exit_price = ?, exit_date = ?, exit_reason = ?, status = ?,
        pnl_usd = ?, pnl_pct = ?, fees = ?
       WHERE id = ?`
    )
      .bind(
        trade.exit_price, trade.exit_date, trade.exit_reason, trade.status,
        trade.pnl_usd, trade.pnl_pct, trade.fees,
        id
      )
      .run();

    return c.json({
      success: true,
      data: trade,
      timestamp: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao atualizar trade";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── DELETE /api/trades/:id — cancelar trade ───

tradeRoutes.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");

    const existing = await c.env.DB.prepare("SELECT * FROM trades WHERE id = ?")
      .bind(id)
      .first();

    if (!existing) {
      return c.json({
        success: false,
        data: null,
        error: "Trade nao encontrado",
        timestamp: new Date().toISOString(),
      }, 404);
    }

    // Soft delete: marca como cancelled
    await c.env.DB.prepare(
      "UPDATE trades SET status = 'cancelled' WHERE id = ?"
    ).bind(id).run();

    return c.json({
      success: true,
      data: { id, status: "cancelled" },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao cancelar trade";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});
