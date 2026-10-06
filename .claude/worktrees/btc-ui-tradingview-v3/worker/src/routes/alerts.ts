// BTC Radar — Rotas de alertas
// GET    /api/alerts       — listar alertas (?type=, ?acknowledged=)
// POST   /api/alerts       — criar alerta
// PUT    /api/alerts/:id   — atualizar (acknowledge)
// DELETE /api/alerts/:id   — remover alerta
// POST   /api/alerts/check — verificar se alertas dispararam

import { Hono } from "hono";
import type { Env } from "../types";
import type { Alert, AlertType } from "../types";
import { fetchOKXTicker } from "../lib/okx";
import { deduped } from "../lib/kv-helpers";

export const alertRoutes = new Hono<{ Bindings: Env }>();

// ─── Helpers ───

function alertFromRow(row: Record<string, unknown>): Alert {
  return {
    id: Number(row.id),
    created_at: row.created_at as string,
    type: row.type as AlertType,
    condition: row.condition as string,
    triggered_at: row.triggered_at as string | null,
    acknowledged: Boolean(row.acknowledged),
    payload: row.payload ? JSON.parse(row.payload as string) : null,
  };
}

// ─── GET /api/alerts — listar alertas ───

alertRoutes.get("/", async (c) => {
  try {
    const type = c.req.query("type") as string | undefined;
    const acknowledged = c.req.query("acknowledged");

    let sql = "SELECT * FROM alerts WHERE 1=1";
    const params: unknown[] = [];

    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }
    if (acknowledged !== undefined) {
      sql += " AND acknowledged = ?";
      params.push(acknowledged === "1" ? 1 : 0);
    }

    sql += " ORDER BY created_at DESC LIMIT 50";

    const result = await c.env.DB.prepare(sql).bind(...(params as [])).all();
    const alerts: Alert[] = (result.results || []).map(alertFromRow);

    return c.json({
      success: true,
      data: alerts,
      count: alerts.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao listar alertas";
    return c.json({ success: false, data: [], error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── POST /api/alerts — criar alerta ───

alertRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      type?: string;
      condition?: string;
      payload?: Record<string, unknown>;
    }>();

    if (!body.type || !body.condition) {
      return c.json({
        success: false, data: null,
        error: "Campos obrigatorios: type, condition",
        timestamp: new Date().toISOString(),
      }, 400);
    }

    const validTypes = ["price", "technical", "onchain", "news", "system"];
    if (!validTypes.includes(body.type)) {
      return c.json({
        success: false, data: null,
        error: `type invalido. Use: ${validTypes.join(", ")}`,
        timestamp: new Date().toISOString(),
      }, 400);
    }

    const now = new Date().toISOString();
    const payloadJson = body.payload ? JSON.stringify(body.payload) : null;

    const result = await c.env.DB.prepare(
      `INSERT INTO alerts (created_at, type, condition, payload)
       VALUES (?, ?, ?, ?)`
    )
      .bind(now, body.type, body.condition, payloadJson)
      .run();

    const alert: Alert = {
      id: Number(result.meta?.last_row_id ?? 0),
      created_at: now,
      type: body.type as AlertType,
      condition: body.condition,
      triggered_at: null,
      acknowledged: false,
      payload: body.payload ?? null,
    };

    return c.json({
      success: true,
      data: alert,
      timestamp: new Date().toISOString(),
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao criar alerta";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── PUT /api/alerts/:id — atualizar (acknowledge) ───

alertRoutes.put("/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json<{ acknowledged?: boolean }>();

    const existing = await c.env.DB.prepare("SELECT * FROM alerts WHERE id = ?")
      .bind(id).first();

    if (!existing) {
      return c.json({
        success: false, data: null,
        error: "Alerta nao encontrado",
        timestamp: new Date().toISOString(),
      }, 404);
    }

    if (body.acknowledged !== undefined) {
      await c.env.DB.prepare("UPDATE alerts SET acknowledged = ? WHERE id = ?")
        .bind(body.acknowledged ? 1 : 0, id).run();
    }

    const updated = await c.env.DB.prepare("SELECT * FROM alerts WHERE id = ?")
      .bind(id).first<Record<string, unknown>>();

    return c.json({
      success: true,
      data: alertFromRow(updated!),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao atualizar alerta";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── DELETE /api/alerts/:id ───

alertRoutes.delete("/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));

    const existing = await c.env.DB.prepare("SELECT * FROM alerts WHERE id = ?")
      .bind(id).first();

    if (!existing) {
      return c.json({
        success: false, data: null,
        error: "Alerta nao encontrado",
        timestamp: new Date().toISOString(),
      }, 404);
    }

    await c.env.DB.prepare("DELETE FROM alerts WHERE id = ?").bind(id).run();

    return c.json({
      success: true,
      data: { id, deleted: true },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao remover alerta";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── POST /api/alerts/check — verificar alertas contra preco atual ───

alertRoutes.post("/check", async (c) => {
  try {
    // Buscar alertas nao-disparados e nao-reconhecidos
    const result = await c.env.DB.prepare(
      "SELECT * FROM alerts WHERE triggered_at IS NULL AND acknowledged = 0"
    ).all();

    const pending = (result.results || []).map(alertFromRow);
    if (pending.length === 0) {
      return c.json({
        success: true,
        data: { checked: 0, triggered: [], current_price: null },
        timestamp: new Date().toISOString(),
      });
    }

    // Buscar preco atual via OKX — dedup evita rate limit em rajadas (mesmo padrao de price.ts)
    let currentPrice: number | null = null;
    try {
      const ticker = await deduped("okx:ticker", () => fetchOKXTicker());
      currentPrice = ticker.price;
    } catch { /* okx indisponivel */ }

    const now = new Date().toISOString();
    const triggered: Array<{ id: number; condition: string }> = [];

    // Acumular updates e gravar em um unico batch
    const updates: D1PreparedStatement[] = [];

    for (const alert of pending) {
      let hit = false;

      if (currentPrice != null) {
        if (alert.type === "price") {
          // Formatos: "price_above_100000", "price_below_90000"
          if (alert.condition.startsWith("price_above_")) {
            const threshold = parseFloat(alert.condition.replace("price_above_", ""));
            if (!isNaN(threshold) && currentPrice > threshold) hit = true;
          } else if (alert.condition.startsWith("price_below_")) {
            const threshold = parseFloat(alert.condition.replace("price_below_", ""));
            if (!isNaN(threshold) && currentPrice < threshold) hit = true;
          }
        } else if (alert.type === "technical") {
          // Marcados para verificacao manual via sinais
          // Por enquanto, so registramos — nao tentamos re-calcular indicadores aqui
        }
      }

      if (hit) {
        updates.push(
          c.env.DB.prepare(
            "UPDATE alerts SET triggered_at = ? WHERE id = ?"
          ).bind(now, alert.id)
        );
        triggered.push({ id: alert.id, condition: alert.condition });
      }
    }

    if (updates.length > 0) {
      await c.env.DB.batch(updates);
    }

    // Push WhatsApp para alertas disparados
    if (triggered.length > 0) {
      try {
        const { notifyTriggeredAlerts } = await import("../lib/notifier");
        await notifyTriggeredAlerts(c.env, triggered, currentPrice);
      } catch { /* falha de notificacao nao interrompe o check */ }
    }

    return c.json({
      success: true,
      data: {
        checked: pending.length,
        triggered,
        current_price: currentPrice,
      },
      timestamp: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao verificar alertas";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});
