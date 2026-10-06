import { Hono } from "hono";
import type { Env } from "../types";
import { kvGetJSON } from "../lib/kv-helpers";
import { collectMacroContext } from "../lib/macro-context";

export const macroContextRoutes = new Hono<{ Bindings: Env }>();

const CACHE_KEY = "btc:macro-context:v1";
const FRESH_MS = 5 * 60_000;
const LAST_GOOD_KEY = "btc:macro-context:last-good:v1";
const LAST_GOOD_MAX_MS = 8 * 24 * 60 * 60_000;

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
    if (payload.quality?.state === "good") {
      await Promise.all([
        c.env.KV.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: 15 * 60 }),
        c.env.KV.put(LAST_GOOD_KEY, JSON.stringify(payload), { expirationTtl: 8 * 24 * 60 * 60 }),
      ]);
      return c.json({ ...payload, cached: false, fallback: { active: false } });
    }

    const lastGood = await kvGetJSON<any>(c.env.KV, LAST_GOOD_KEY);
    if (lastGood?.generated_at && lastGood?.quality?.state === "good") {
      const lastGoodAgeMs = Date.now() - new Date(lastGood.generated_at).getTime();
      if (lastGoodAgeMs >= 0 && lastGoodAgeMs <= LAST_GOOD_MAX_MS) {
        return c.json({
          ...lastGood,
          cached: true,
          fallback: {
            active: true,
            reason: "upstream_degraded",
            detected_at: new Date().toISOString(),
            last_good_age_s: Math.round(lastGoodAgeMs / 1000),
            upstream_quality: payload.quality,
            upstream_sources: payload.sources,
          },
        });
      }
    }

    return c.json({ ...payload, cached: false, fallback: { active: false } });
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
