// BTC Radar — Rotas de briefing diario
// GET  /api/briefing         — listar briefings
// GET  /api/briefing/latest  — briefing mais recente
// POST /api/briefing/generate — gerar briefing manualmente

import { Hono } from "hono";
import type { Env } from "../types";
import { generateBriefing, storeBriefing } from "../lib/briefing";

export const briefingRoutes = new Hono<{ Bindings: Env }>();

// GET /api/briefing — listar briefings
briefingRoutes.get("/", async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query("limit") || "15", 10), 50);

    const result = await c.env.DB.prepare(
      "SELECT id, date, generated_at, model, prompt_version, summary FROM briefings ORDER BY date DESC LIMIT ?"
    ).bind(limit).all();

    const briefings = (result.results || []).map((r: Record<string, unknown>) => ({
      id: r.id as number,
      date: r.date as string,
      generated_at: r.generated_at as string,
      model: r.model as string,
      prompt_version: r.prompt_version as string,
      summary: r.summary as string,
    }));

    return c.json({
      success: true,
      data: briefings,
      count: briefings.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar briefings";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// GET /api/briefing/latest — briefing mais recente
briefingRoutes.get("/latest", async (c) => {
  try {
    // Tenta KV primeiro
    const cached = await c.env.KV.get("briefing:latest", "json") as Record<string, unknown> | null;
    if (cached) {
      return c.json({ success: true, data: cached, source: "kv", timestamp: new Date().toISOString() });
    }

    // Fallback: D1
    const result = await c.env.DB.prepare(
      "SELECT id, date, generated_at, model, prompt_version, summary FROM briefings ORDER BY date DESC LIMIT 1"
    ).first<Record<string, unknown>>();

    if (!result) {
      return c.json({
        success: false,
        data: null,
        error: "Nenhum briefing encontrado. Execute POST /api/briefing/generate para gerar o primeiro.",
        timestamp: new Date().toISOString(),
      }, 404);
    }

    const briefing = {
      id: result.id as number,
      date: result.date as string,
      generated_at: result.generated_at as string,
      summary: result.summary as string,
      model: result.model as string,
    };

    return c.json({ success: true, data: briefing, source: "d1", timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar briefing";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// POST /api/briefing/generate — gerar briefing agora
// Query params: ?force=true — deleta briefing existente do dia e regenera
briefingRoutes.post("/generate", async (c) => {
  try {
    const force = c.req.query("force") === "true";
    const today = new Date().toISOString().slice(0, 10);

    if (force) {
      await c.env.DB.prepare("DELETE FROM briefings WHERE date = ?").bind(today).run();
      await c.env.KV.delete("briefing:latest");
      console.log(`[briefing] Force regenerate: deleted briefing for ${today}`);
    }

    const result = await generateBriefing(c.env);
    const id = await storeBriefing(c.env, result);

    return c.json({
      success: true,
      data: {
        id,
        date: result.date,
        summary: result.summary,
        model: result.model,
        generated_at: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao gerar briefing";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});
