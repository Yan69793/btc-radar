import type { Env } from "../types";

const MULTI_ORIGIN = "https://multi-assets.com";

interface EndpointResult {
  ok: boolean;
  status: number;
  via: "service-binding" | "public-fetch";
  body: any;
  error: string | null;
}

export interface IntegrationSource {
  name: "macro" | "market" | "prices";
  ok: boolean;
  status: number;
  via: "service-binding" | "public-fetch";
  observed_at: string | null;
  age_s: number | null;
  state: "fresh" | "stale" | "expired" | "missing";
  error: string | null;
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (value == null) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function freshness(value: unknown, maxAgeS: number, nowMs: number) {
  const ms = epochMs(value);
  if (ms == null) return { state: "missing" as const, age_s: null };
  const age = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (age <= maxAgeS) return { state: "fresh" as const, age_s: age };
  if (age <= maxAgeS * 6) return { state: "stale" as const, age_s: age };
  return { state: "expired" as const, age_s: age };
}

async function withTimeout(fetcher: (req: Request) => Promise<Response>, req: Request, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(new Request(req, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMultiEndpoint(env: Env, path: string, timeoutMs = 8000): Promise<EndpointResult> {
  const viaBinding = !!env.SZ_SITES && typeof env.SZ_SITES.fetch === "function";
  const url = `${MULTI_ORIGIN}${path}`;
  const fetcher = viaBinding
    ? (req: Request) => env.SZ_SITES!.fetch(req)
    : (req: Request) => fetch(req);

  try {
    const res = await withTimeout(fetcher, new Request(url, {
      headers: { Accept: "application/json" },
    }), timeoutMs);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        via: viaBinding ? "service-binding" : "public-fetch",
        body: null,
        error: `HTTP ${res.status}`,
      };
    }
    const body = await res.json() as any;
    const apiOk = body?.ok !== false;
    return {
      ok: apiOk,
      status: res.status,
      via: viaBinding ? "service-binding" : "public-fetch",
      body,
      error: apiOk ? null : body?.error ?? "upstream_reported_failure",
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      via: viaBinding ? "service-binding" : "public-fetch",
      body: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function makeSource(
  name: IntegrationSource["name"],
  result: EndpointResult,
  observed: unknown,
  maxAgeS: number,
  nowMs: number,
): IntegrationSource {
  const f = result.ok ? freshness(observed, maxAgeS, nowMs) : { state: "missing" as const, age_s: null };
  const observedMs = epochMs(observed);
  return {
    name,
    ok: result.ok,
    status: result.status,
    via: result.via,
    observed_at: observedMs == null ? null : new Date(observedMs).toISOString(),
    ...f,
    error: result.error,
  };
}

export function scoreMacroQuality(sources: IntegrationSource[], market: any, prices: any) {
  let score = 100;
  const issues: string[] = [];
  const penalties: Record<IntegrationSource["name"], number> = {
    macro: 35,
    market: 25,
    prices: 10,
  };

  for (const source of sources) {
    if (!source.ok) {
      score -= penalties[source.name];
      issues.push(`${source.name}:unavailable`);
      continue;
    }
    if (source.state === "stale") {
      score -= Math.ceil(penalties[source.name] / 3);
      issues.push(`${source.name}:stale`);
    } else if (source.state === "expired" || source.state === "missing") {
      score -= Math.ceil(penalties[source.name] / 2);
      issues.push(`${source.name}:${source.state}`);
    }
  }

  const staleMarket = Array.isArray(market?.stale) ? market.stale : [];
  if (staleMarket.length > 0) {
    score -= Math.min(15, staleMarket.length * 3);
    issues.push(`market_fallbacks:${staleMarket.join(",")}`);
  }

  if (prices?.stale === true) {
    score -= 10;
    issues.push("prices:fallback");
  }

  const final = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: final,
    state: final >= 85 ? "good" : final >= 65 ? "degraded" : "poor",
    issues,
  };
}

export async function collectMacroContext(env: Env, nowMs = Date.now()) {
  const [macroR, marketR, pricesR] = await Promise.all([
    fetchMultiEndpoint(env, "/assets/macro.php"),
    fetchMultiEndpoint(env, "/market-data.php"),
    fetchMultiEndpoint(env, "/prices.php"),
  ]);

  const macro = macroR.body ?? null;
  const market = marketR.body ?? null;
  const prices = pricesR.body ?? null;

  const sources: IntegrationSource[] = [
    makeSource("macro", macroR, macro?.ts, 8 * 24 * 3600, nowMs),
    makeSource("market", marketR, market?.ts, 20 * 60, nowMs),
    makeSource("prices", pricesR, prices?.ts, 30 * 60, nowMs),
  ];

  const quality = scoreMacroQuality(sources, market, prices);

  return {
    ok: macroR.ok || marketR.ok || pricesR.ok,
    schema: "sz.macro-context.v1",
    generated_at: new Date(nowMs).toISOString(),
    quality,
    sources,
    data: {
      macro: macro ? {
        source: macro.source ?? null,
        fresh: macro.fresh ?? null,
        selic_meta: macro.selic_meta ?? null,
        cambio_ptax: macro.cambio_ptax ?? null,
        focus: macro.focus ?? null,
      } : null,
      market: market ? {
        ibov: market.ibov ?? null,
        sp500: market.sp500 ?? null,
        wti: market.wti ?? null,
        treasury10y: market.treasury10y ?? null,
        ntnb11: market.ntnb11 ?? null,
        source: market.source ?? null,
        stale: market.stale ?? [],
      } : null,
      cross_asset_prices: prices ? {
        gold: prices.gold ?? null,
        silver: prices.silver ?? null,
        platinum: prices.platinum ?? null,
        copper: prices.copper ?? null,
        bitcoin_usd_reference: prices.bitcoin ?? null,
        stale: prices.stale ?? null,
      } : null,
      features: {
        selic_target_pct: macro?.selic_meta?.valor ?? null,
        usdbrl_ptax: macro?.cambio_ptax?.valor ?? null,
        ipca_focus_2026_pct: macro?.focus?.ipca_2026?.mediana ?? null,
        selic_focus_2026_pct: macro?.focus?.selic_2026?.mediana ?? null,
        sp500_change_24h_pct: market?.sp500?.change_pct ?? null,
        ibov_change_24h_pct: market?.ibov?.change_pct ?? null,
        treasury10y_pct: market?.treasury10y?.value ?? null,
        wti_change_24h_pct: market?.wti?.change_pct ?? null,
      },
    },
  };
}
