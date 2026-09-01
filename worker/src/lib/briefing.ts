// BTC Radar — Gerador de briefing diario
// Coleta dados do sistema, chama OpenRouter, armazena no D1.
// Executado via cron (19h BRT) ou manualmente via POST /api/briefing/generate

import type { Env } from "../types";

interface BriefingData {
  price: { current: number; change_24h: number; high_24h: number; low_24h: number; volume_24h: number };
  fear_greed: { value: number; classification: string } | null;
  onchain: { block_height: number; hash_rate: number | null; avg_fee_sats: number | null } | null;
  derivatives: { funding_rate: number; funding_annualized: number; open_interest_usd: number } | null;
  signals: Array<{ strategy: string; verdict: string; timeframe: string; conviction: number }>;
  trades_closed_7d: Array<{ strategy: string; direction: string; pnl_pct: number }>;
  btc_7d: Array<{ date: string; close: number }>;
}

async function collectData(env: Env): Promise<BriefingData> {
  const data: BriefingData = {
    price: { current: 0, change_24h: 0, high_24h: 0, low_24h: 0, volume_24h: 0 },
    fear_greed: null,
    onchain: null,
    derivatives: null,
    signals: [],
    trades_closed_7d: [],
    btc_7d: [],
  };

  try {
    // Preco atual — OKX como fonte primaria
    const { fetchOKXTicker } = await import("./okx");
    const ticker = await fetchOKXTicker();
    data.price = {
      current: ticker.price,
      change_24h: ticker.change_24h,
      high_24h: ticker.high_24h,
      low_24h: ticker.low_24h,
      volume_24h: ticker.volume_24h,
    };
  } catch (err) {
    console.error("[briefing] fetchOKXTicker failed:", err instanceof Error ? err.message : String(err));
    // Fallback: chamar OKX direto sem encapsulamento
    try {
      const res = await fetch("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT");
      if (res.ok) {
        const json = await res.json() as { code: string; data: Array<{ last: string; open24h: string; high24h: string; low24h: string; volCcy24h: string }> };
        if (json.code === "0" && json.data?.[0]) {
          const t = json.data[0];
          const price = parseFloat(t.last);
          const open24h = parseFloat(t.open24h);
          data.price = {
            current: price,
            change_24h: open24h > 0 ? Math.round(((price - open24h) / open24h) * 10000) / 100 : 0,
            high_24h: parseFloat(t.high24h),
            low_24h: parseFloat(t.low24h),
            volume_24h: Math.round(parseFloat(t.volCcy24h)),
          };
          console.log("[briefing] OKX fallback succeeded");
        }
      }
    } catch (err2) {
      console.error("[briefing] OKX fallback also failed:", err2 instanceof Error ? err2.message : String(err2));
    }
  }

  try {
    // Fear & Greed
    const fgRaw = await env.KV.get("sentiment:fear-greed", "json") as Record<string, unknown> | null;
    if (fgRaw) {
      data.fear_greed = { value: fgRaw.value as number, classification: fgRaw.classification as string };
    }
  } catch { /* segue */ }

  // Fallback: buscar Fear & Greed direto da API se KV estiver vazio
  if (!data.fear_greed) {
    try {
      const fgRes = await fetch("https://api.alternative.me/fng/?limit=1");
      if (fgRes.ok) {
        const fgJson = await fgRes.json() as { data: Array<{ value: string; value_classification: string }> };
        if (fgJson.data?.[0]) {
          data.fear_greed = {
            value: parseInt(fgJson.data[0].value),
            classification: fgJson.data[0].value_classification,
          };
        }
      }
    } catch { /* segue sem Fear & Greed */ }
  }

  try {
    // On-chain — fonte primaria: KV (populado pelo cron, chave v2)
    const ocKv = await env.KV.get("btc:onchain:v2", "json") as Record<string, unknown> | null;
    if (ocKv) {
      data.onchain = {
        block_height: ocKv.block_height as number,
        hash_rate: ocKv.hash_rate != null ? Number(ocKv.hash_rate) : null,
        avg_fee_sats: ocKv.avg_fee_sats != null ? Number(ocKv.avg_fee_sats) : null,
      };
    }
  } catch { /* segue */ }

  // Fallback: D1 se KV vazio
  if (!data.onchain) {
    try {
      const onchainRows = await env.DB.prepare(
        "SELECT block_height, hash_rate, avg_fee_sats FROM onchain_snapshots ORDER BY timestamp DESC LIMIT 1"
      ).all();
      if (onchainRows.results?.length) {
        const r = onchainRows.results[0] as Record<string, unknown>;
        data.onchain = {
          block_height: r.block_height as number,
          hash_rate: r.hash_rate != null ? Number(r.hash_rate) : null,
          avg_fee_sats: r.avg_fee_sats != null ? Number(r.avg_fee_sats) : null,
        };
      }
    } catch (err) {
      console.error("[briefing] onchain query failed:", err instanceof Error ? err.message : String(err));
    }
  }

  try {
    // Derivativos (funding rate)
    const derivRaw = await env.KV.get("btc:derivatives:v1", "json") as Record<string, unknown> | null;
    if (derivRaw) {
      data.derivatives = {
        funding_rate: derivRaw.funding_rate as number,
        funding_annualized: derivRaw.funding_rate_annualized as number,
        open_interest_usd: derivRaw.open_interest_usd as number,
      };
    }
  } catch { /* segue */ }

  // Fallback: buscar funding rate direto da OKX se KV estiver vazio
  if (!data.derivatives) {
    try {
      const derivRes = await fetch("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP");
      if (derivRes.ok) {
        const derivJson = await derivRes.json() as { code: string; data: Array<{ fundingRate: string; fundingTime: string }> };
        if (derivJson.code === "0" && derivJson.data?.[0]) {
          const rate = parseFloat(derivJson.data[0].fundingRate);
          data.derivatives = {
            funding_rate: rate,
            funding_annualized: rate * 3 * 365 * 100, // 3x ao dia * 365 dias * 100 para percentual
            open_interest_usd: 0,
          };
        }
      }
    } catch { /* segue sem derivativos */ }
  }

  // Fallback: buscar open interest via OKX
  if (data.derivatives && data.derivatives.open_interest_usd === 0) {
    try {
      const oiRes = await fetch("https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP");
      if (oiRes.ok) {
        const oiJson = await oiRes.json() as { code: string; data: Array<{ oiUsd: string }> };
        if (oiJson.code === "0" && oiJson.data?.[0]) {
          data.derivatives.open_interest_usd = Math.round(parseFloat(oiJson.data[0].oiUsd));
        }
      }
    } catch { /* segue sem OI */ }
  }

  try {
    // Sinais recentes — fonte: KV (cache do endpoint /api/signals)
    const sigCache = await env.KV.get("btc:signals:v2:all", "json") as { signals: Array<{ strategy: string; verdict: string; timeframe: string; conviction: number }>; generated_at: string } | null;
    if (sigCache?.signals?.length) {
      data.signals = sigCache.signals.map((s) => ({
        strategy: s.strategy,
        verdict: s.verdict,
        timeframe: s.timeframe,
        conviction: s.conviction,
      }));
    }
  } catch (err) {
    console.error("[briefing] signals KV read failed:", err instanceof Error ? err.message : String(err));
  }

  // Fallback: D1 se KV estiver vazio
  if (data.signals.length === 0) {
    try {
      const signalRows = await env.DB.prepare(
        "SELECT strategy, verdict, timeframe, conviction FROM signals ORDER BY generated_at DESC LIMIT 20"
      ).all();
      data.signals = (signalRows.results || []).map((r: Record<string, unknown>) => ({
        strategy: r.strategy as string,
        verdict: r.verdict as string,
        timeframe: r.timeframe as string,
        conviction: r.conviction as number,
      }));
    } catch { /* D1 fallback falhou, segue sem sinais */ }
  }

  try {
    // Trades fechados (ultimos 7 dias)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const tradeRows = await env.DB.prepare(
      "SELECT strategy, direction, pnl_pct FROM trades WHERE status = 'closed' AND exit_date > ? ORDER BY exit_date DESC LIMIT 20"
    ).bind(sevenDaysAgo).all();
    data.trades_closed_7d = (tradeRows.results || []).map((r: Record<string, unknown>) => ({
      strategy: r.strategy as string,
      direction: r.direction as string,
      pnl_pct: r.pnl_pct != null ? Number(r.pnl_pct) : 0,
    }));
  } catch (err) {
    console.error("[briefing] trades query failed:", err instanceof Error ? err.message : String(err));
  }

  try {
    // Preco 7 dias
    const ohlcvRows = await env.DB.prepare(
      "SELECT timestamp, close FROM prices WHERE interval = '1d' ORDER BY timestamp DESC LIMIT 7"
    ).all();
    data.btc_7d = (ohlcvRows.results || []).map((r: Record<string, unknown>) => ({
      date: (r.timestamp as string).slice(0, 10),
      close: Number(r.close),
    })).reverse();
  } catch (err) {
    console.error("[briefing] ohlcv query failed:", err instanceof Error ? err.message : String(err));
  }

  // Fallback: buscar OHLCV 7 dias direto da OKX se D1 estiver vazio
  if (data.btc_7d.length === 0) {
    try {
      const ohlcvRes = await fetch("https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1D&limit=7");
      if (ohlcvRes.ok) {
        const ohlcvJson = await ohlcvRes.json() as { code: string; data: Array<[string, string, string, string, string, string]> };
        if (ohlcvJson.code === "0" && ohlcvJson.data) {
          data.btc_7d = [...ohlcvJson.data].reverse().map((k) => ({
            date: new Date(parseInt(k[0])).toISOString().slice(0, 10),
            close: parseFloat(k[4]),
          }));
        }
      }
    } catch { /* segue sem historico */ }
  }

  return data;
}

// ─── Geracao programatica do texto (substitui OpenRouter) ───

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US");
}

function buildBriefingText(data: BriefingData): string {
  const p = data.price;
  const fg = data.fear_greed;
  const deriv = data.derivatives;
  const onchain = data.onchain;

  // ─── Helpers de formato ───
  const volBi = p.volume_24h / 1e9;
  const volStr = volBi >= 1
    ? `US$ ${volBi.toFixed(2)} bi`
    : `US$ ${(p.volume_24h / 1e6).toFixed(0)} milhoes`;

  const dirVerbo = p.change_24h >= 0 ? "sobe" : "cai";
  const absChange = Math.abs(p.change_24h);

  // ─── Contexto 7 dias ───
  const closes = data.btc_7d.map((d) => d.close);
  const weekHigh = closes.length > 0 ? Math.max(...closes) : p.high_24h;
  const weekLow = closes.length > 0 ? Math.min(...closes) : p.low_24h;
  const weekTrend = closes.length >= 2
    ? (closes[closes.length - 1]! - closes[0]!) / closes[0]! * 100
    : 0;

  // ─── Paragrafo 1: Preco + sentimento + contexto semanal ───
  let p1 = `BTC ${dirVerbo} ${absChange.toFixed(1)}% em 24h, cotado a US$ ${fmtUsd(p.current)}.`;
  p1 += ` Maxima de US$ ${fmtUsd(p.high_24h)} e minima de US$ ${fmtUsd(p.low_24h)}.`;
  p1 += ` Volume ${dirVerbo === "sobe" ? "de" : "em"} ${volStr}.`;

  if (data.btc_7d.length >= 3) {
    const dirSemana = weekTrend >= 0 ? "sobe" : "cai";
    p1 += ` Na semana, ${dirSemana} ${Math.abs(weekTrend).toFixed(1)}%,`;
    p1 += ` com maxima semanal de US$ ${fmtUsd(weekHigh)} e minima de US$ ${fmtUsd(weekLow)}.`;
  }

  if (fg) {
    const fgZone = fg.value <= 25 ? "medo extremo" :
                   fg.value <= 45 ? "medo" :
                   fg.value <= 55 ? "neutro" :
                   fg.value <= 75 ? "ganancia" : "ganancia extrema";
    p1 += ` Fear & Greed em ${fg.value}/100 (${fgZone}).`;
  }

  // ─── Paragrafo 2: Derivativos ───
  let p2 = "";
  if (deriv) {
    const fundingPct = deriv.funding_rate * 100;
    const oiBi = deriv.open_interest_usd / 1e9;

    // Interpretacao baseada em thresholds
    let fundingInterpretation: string;
    if (deriv.funding_rate > 0.005) {
      fundingInterpretation = "custo elevado para longs, pressionando compradores alavancados";
    } else if (deriv.funding_rate > 0.001) {
      fundingInterpretation = "vies comprador moderado, sem pressao excessiva";
    } else if (deriv.funding_rate < -0.005) {
      fundingInterpretation = "custo elevado para shorts, pressionando vendedores alavancados";
    } else if (deriv.funding_rate < -0.001) {
      fundingInterpretation = "vies vendedor moderado, sem pressao excessiva";
    } else {
      fundingInterpretation = "mercado equilibrado entre longs e shorts";
    }

    p2 = `Funding rate ${fundingPct > 0 ? "+" : ""}${fundingPct.toFixed(3)}% (${deriv.funding_annualized.toFixed(1)}% aa): ${fundingInterpretation}.`;

    if (oiBi > 0.01) {
      p2 += ` Open interest de US$ ${oiBi.toFixed(2)} bi.`;
    }
  }

  // ─── Paragrafo 3: On-chain, sinais, trades ───
  const bullets: string[] = [];

  if (onchain) {
    let ocLine = `Bloco ${onchain.block_height.toLocaleString("pt-BR")}`;
    if (onchain.hash_rate != null) ocLine += `, hash rate ${onchain.hash_rate.toFixed(0)} TH/s`;
    if (onchain.avg_fee_sats != null) ocLine += `, fee medio ${onchain.avg_fee_sats.toFixed(0)} sats`;
    ocLine += ".";
    bullets.push(ocLine);
  }

  if (data.signals.length > 0) {
    const relevant = data.signals
      .filter((s) => s.conviction >= 4)
      .slice(0, 8);

    if (relevant.length > 0) {
      const comprar = relevant.filter((s) => s.verdict === "COMPRAR");
      const aguardar = relevant.filter((s) => s.verdict === "AGUARDAR");
      const vender = relevant.filter((s) => s.verdict === "VENDER" || s.verdict === "REDUZIR");

      let sigLine = "Sinais:";
      if (comprar.length > 0) sigLine += ` ${comprar.length} compra`;
      if (aguardar.length > 0) sigLine += `, ${aguardar.length} aguardar`;
      if (vender.length > 0) sigLine += `, ${vender.length} venda`;
      sigLine += ".";
      bullets.push(sigLine);
    }
  }

  if (data.trades_closed_7d.length > 0) {
    const totalPnl = data.trades_closed_7d.reduce((sum, t) => sum + t.pnl_pct, 0);
    const pnlStr = totalPnl >= 0 ? `+${totalPnl.toFixed(1)}%` : `${totalPnl.toFixed(1)}%`;
    bullets.push(`Trades na semana: ${data.trades_closed_7d.length} fechado(s), PnL acumulado ${pnlStr}.`);
  }

  // ─── Montagem final ───
  const paragraphs = [p1];
  if (p2) paragraphs.push(p2);
  if (bullets.length > 0) {
    paragraphs.push(bullets.join(" "));
  }

  return paragraphs.join("\n\n");
}

// ─── Geracao via OpenRouter (desabilitada; usar generateBriefing com template) ───
// const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// const BRIEFING_MODEL = "deepseek/deepseek-v4-pro";

export async function generateBriefing(env: Env): Promise<{ date: string; summary: string; model: string }> {
  const data = await collectData(env);
  const summary = buildBriefingText(data);
  const today = new Date().toISOString().slice(0, 10);

  // Texto deterministico, sem dependencia de LLM externo
  return { date: today, summary, model: "template" };
}

export async function storeBriefing(
  env: Env,
  briefing: { date: string; summary: string; model: string },
): Promise<number> {
  const generatedAt = new Date().toISOString();

  const result = await env.DB.prepare(
    `INSERT OR REPLACE INTO briefings (date, generated_at, model, prompt_version, summary)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(briefing.date, generatedAt, briefing.model, "1.0", briefing.summary).run();

  if (!result.meta?.last_row_id) {
    throw new Error("Falha ao inserir briefing no banco");
  }

  // Cache no KV (expira em 24h)
  const cacheKey = `briefing:latest`;
  await env.KV.put(cacheKey, JSON.stringify({
    id: result.meta.last_row_id,
    date: briefing.date,
    generated_at: generatedAt,
    summary: briefing.summary,
    model: briefing.model,
  }), { expirationTtl: 86400 });

  return result.meta.last_row_id as number;
}
