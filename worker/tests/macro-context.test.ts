import { afterEach, describe, expect, it, vi } from "vitest";
import { collectMacroContext, fetchMultiEndpoint, scoreMacroQuality } from "../src/lib/macro-context";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("macro-context integration", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("prefere Service Binding e normaliza macro + cross-asset", async () => {
    const seen: string[] = [];
    const env = {
      SZ_SITES: {
        async fetch(req: Request) {
          const url = new URL(req.url);
          seen.push(url.pathname);
          if (url.pathname === "/assets/macro.php") {
            return json({
              ts: 1790628246,
              source: "BCB",
              fresh: true,
              selic_meta: { valor: 13.75 },
              cambio_ptax: { valor: 5.2132 },
              focus: {
                ipca_2026: { mediana: 4.99 },
                selic_2026: { mediana: 13.5 },
              },
            });
          }
          if (url.pathname === "/market-data.php") {
            return json({
              ok: true,
              ts: 1790628246,
              stale: [],
              ibov: { value: 182991, change_pct: -0.26 },
              sp500: { value: 7683, change_pct: -0.77 },
              wti: { value: 93, change_pct: 0.66 },
              treasury10y: { value: 5.24, change_pct: 1.08 },
              ntnb11: { value: 128.2, change_pct: 0.2 },
            });
          }
          if (url.pathname === "/prices.php") {
            return json({
              ok: true,
              ts: 1790628246,
              stale: false,
              gold: 4121,
              silver: 60,
              platinum: 1725,
              copper: 6.61,
              bitcoin: 83465,
            });
          }
          return json({ ok: false }, 404);
        },
      },
    } as any;

    const out = await collectMacroContext(env, 1790628300000);
    expect(out.schema).toBe("sz.macro-context.v1");
    expect(out.quality.state).toBe("good");
    expect(out.data.features.selic_target_pct).toBe(13.75);
    expect(out.data.features.sp500_change_24h_pct).toBe(-0.77);
    expect(out.data.cross_asset_prices.bitcoin_usd_reference).toBe(83465);
    expect(out.sources.every((s) => s.via === "service-binding")).toBe(true);
    expect(seen.sort()).toEqual(["/assets/macro.php", "/market-data.php", "/prices.php"].sort());
  });

  it("penaliza indisponibilidade de macro mais que precos auxiliares", () => {
    const quality = scoreMacroQuality([
      { name: "macro", ok: false, status: 500, via: "service-binding", observed_at: null, age_s: null, state: "missing", error: "x" },
      { name: "market", ok: true, status: 200, via: "service-binding", observed_at: "2026-09-28T20:00:00Z", age_s: 10, state: "fresh", error: null },
      { name: "prices", ok: true, status: 200, via: "service-binding", observed_at: "2026-09-28T20:00:00Z", age_s: 10, state: "fresh", error: null },
    ], { stale: [] }, { stale: false });
    expect(quality.score).toBe(65);
    expect(quality.state).toBe("degraded");
    expect(quality.issues).toContain("macro:unavailable");
  });

  it("faz fallback publico quando o Service Binding falha", async () => {
    const env = {
      SZ_SITES: {
        async fetch() {
          throw new Error("The operation was aborted");
        },
      },
    } as any;

    vi.stubGlobal("fetch", async () => json({ ok: true, ts: 1790628246, source: "BCB" }));
    const out = await fetchMultiEndpoint(env, "/assets/macro.php", 50);

    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(out.via).toBe("public-fetch");
    expect(out.error).toBeNull();
  });
});
