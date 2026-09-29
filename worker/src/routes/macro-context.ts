import { Hono } from "hono";
import type { Env } from "../types";
import { kvGetJSON } from "../lib/kv-helpers";
import { collectMacroContext } from "../lib/macro-context";

export const macroContextRoutes = new Hono<{ Bindings: Env }>();

const CACHE_KEY = "btc:macro-context:v1";
const FRESH_MS = 5 * 60_000;

macroContextRoutes.get("/", async (c) => {
  try {
    const cached = await kvGetJSON<any>(c.env.KV, CACHE_KEY);
    if (cached?.generated_at) {
      const age = Date.now() - new Date(cached.generated_at).getTime();
      if (age >= 0 && age < FRESH_MS) {
        return c.json({ ...cached, cached: true });
      }
    }

    const payload = await collectMacroContext(c.env);
    await c.env.KV.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: 15 * 60 });
    return c.json({ ...payload, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao montar contexto macro";
    return c.json({
      ok: false,
      schema: "sz.macro-context.v1",
      error: message,
      generated_at: new Date().toISOString(),
    }, 502);
  }
});
