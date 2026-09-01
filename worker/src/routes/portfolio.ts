// BTC Radar — Rotas de portfolio
// GET  /api/portfolio          — snapshot atual + historico
// POST /api/portfolio/snapshot — registrar snapshot manual

import { Hono } from "hono";
import type { Env } from "../types";
import type { PortfolioSnapshot, PortfolioCurrent, Trade } from "../types";
import { fetchOKXTicker } from "../lib/okx";

export const portfolioRoutes = new Hono<{ Bindings: Env }>();

// GET /api/portfolio — estado atual consolidado
portfolioRoutes.get("/", async (c) => {
  try {
    // Buscar trades abertos
    const openResult = await c.env.DB.prepare(
      "SELECT * FROM trades WHERE status = 'open' ORDER BY entry_date DESC"
    ).all();
    const openTrades: Trade[] = (openResult.results || []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      signal_id: r.signal_id as string | null,
      symbol: r.symbol as string,
      direction: r.direction as Trade["direction"],
      entry_price: Number(r.entry_price),
      exit_price: r.exit_price != null ? Number(r.exit_price) : null,
      quantity: Number(r.quantity),
      entry_date: r.entry_date as string,
      exit_date: r.exit_date as string | null,
      status: r.status as Trade["status"],
      pnl_usd: r.pnl_usd != null ? Number(r.pnl_usd) : null,
      pnl_pct: r.pnl_pct != null ? Number(r.pnl_pct) : null,
      exit_reason: r.exit_reason as Trade["exit_reason"] | null,
      fees: Number(r.fees ?? 0),
      strategy: r.strategy as Trade["strategy"],
    }));

    // Buscar ultimo snapshot
    const lastSnapshot = await c.env.DB.prepare(
      "SELECT * FROM portfolio_snapshots ORDER BY timestamp DESC LIMIT 1"
    ).first<Record<string, unknown>>();

    // Preco atual BTC
    let btcPrice = 0;
    try {
      const ticker = await fetchOKXTicker();
      btcPrice = ticker.price;
    } catch { /* usa 0 */ }

    // Calcular exposicao a partir dos trades abertos
    let btcExposure = 0;
    let usdExposure = 0;
    let unrealizedPnl = 0;

    for (const t of openTrades) {
      if (t.direction === "long") {
        btcExposure += t.quantity;
        usdExposure += t.entry_price * t.quantity;
        if (btcPrice > 0) {
          unrealizedPnl += (btcPrice - t.entry_price) * t.quantity - t.fees;
        }
      } else {
        // Short: USD collateral
        usdExposure += t.entry_price * t.quantity;
        if (btcPrice > 0) {
          unrealizedPnl += (t.entry_price - btcPrice) * t.quantity - t.fees;
        }
      }
    }

    // Total portfolio
    const totalValue = usdExposure + (lastSnapshot?.usd_balance != null ? Number(lastSnapshot.usd_balance) : 0);
    const unrealizedPnlPct = usdExposure > 0 ? (unrealizedPnl / usdExposure) * 100 : 0;

    // Alocacao por horizonte (baseado nos trades abertos)
    const allocLong = openTrades.filter((t) => ["dca", "trend_following", "mvrv_based", "macd"].includes(t.strategy)).length;
    const allocShort = openTrades.filter((t) => ["rsi", "bollinger", "mean_reversion"].includes(t.strategy)).length;

    const current: PortfolioCurrent = {
      btc_balance: btcExposure,
      usd_balance: lastSnapshot?.usd_balance != null ? Number(lastSnapshot.usd_balance) : 0,
      btc_price: btcPrice,
      total_value_usd: totalValue,
      allocation: {
        long: allocLong,
        medium: 0,
        short: allocShort,
      },
      unrealized_pnl_usd: Math.round(unrealizedPnl * 100) / 100,
      unrealized_pnl_pct: Math.round(unrealizedPnlPct * 100) / 100,
    };

    return c.json({
      success: true,
      data: {
        current,
        open_trades: openTrades,
        last_snapshot: lastSnapshot ?? null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar portfolio";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// POST /api/portfolio/snapshot — registrar snapshot manual de balances
portfolioRoutes.post("/snapshot", async (c) => {
  try {
    const body = await c.req.json<{
      btc_balance?: number;
      usd_balance?: number;
      btc_price?: number;
    }>();

    if (body.btc_balance == null && body.usd_balance == null) {
      return c.json({
        success: false, data: null,
        error: "Informe btc_balance ou usd_balance",
        timestamp: new Date().toISOString(),
      }, 400);
    }

    // Obter preco atual se nao informado
    let btcPrice = body.btc_price ?? 0;
    if (btcPrice <= 0) {
      try {
        const ticker = await fetchOKXTicker();
        btcPrice = ticker.price;
      } catch { btcPrice = 0; }
    }

    const btc = body.btc_balance ?? 0;
    const usd = body.usd_balance ?? 0;
    const total = btc * btcPrice + usd;
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO portfolio_snapshots (timestamp, btc_balance, usd_balance, btc_price, total_value_usd)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(now, btc, usd, btcPrice, total)
      .run();

    const snapshot: PortfolioSnapshot = {
      timestamp: now,
      btc_balance: btc,
      usd_balance: usd,
      btc_price: btcPrice,
      total_value_usd: total,
      allocation_long_pct: null,
      allocation_medium_pct: null,
      allocation_short_pct: null,
    };

    return c.json({ success: true, data: snapshot, timestamp: new Date().toISOString() }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao registrar snapshot";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// GET /api/portfolio/history — historico de snapshots
portfolioRoutes.get("/history", async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query("limit") || "30", 10), 100);
    const result = await c.env.DB.prepare(
      "SELECT * FROM portfolio_snapshots ORDER BY timestamp DESC LIMIT ?"
    ).bind(limit).all();

    const snapshots: PortfolioSnapshot[] = (result.results || []).map((r: Record<string, unknown>) => ({
      timestamp: r.timestamp as string,
      btc_balance: Number(r.btc_balance),
      usd_balance: Number(r.usd_balance),
      btc_price: Number(r.btc_price),
      total_value_usd: Number(r.total_value_usd),
      allocation_long_pct: r.allocation_long_pct != null ? Number(r.allocation_long_pct) : null,
      allocation_medium_pct: r.allocation_medium_pct != null ? Number(r.allocation_medium_pct) : null,
      allocation_short_pct: r.allocation_short_pct != null ? Number(r.allocation_short_pct) : null,
    }));

    return c.json({
      success: true,
      data: snapshots,
      count: snapshots.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar historico de portfolio";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});
