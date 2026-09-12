// BTC Radar — API Worker (Hono + Cloudflare Workers)
// Fase 1 MVP: price, news, sentiment, health

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { SERVICE_VERSION } from "./version";

// Rotas
import { priceRoutes } from "./routes/price";
import { sentimentRoutes } from "./routes/sentiment";
import { newsRoutes } from "./routes/news";
import { signalRoutes } from "./routes/signals";
import { onchainRoutes } from "./routes/onchain";
import { tradeRoutes } from "./routes/trades";
import { alertRoutes } from "./routes/alerts";
import { backtestRoutes } from "./routes/backtest";
import { derivativesRoutes } from "./routes/derivatives";
import { portfolioRoutes } from "./routes/portfolio";
import { briefingRoutes } from "./routes/briefing";
import { whatsappRoutes } from "./routes/whatsapp";
import { authRoutes } from "./routes/auth";
import { handleScheduled } from "./cron";
import { writeGuard } from "./lib/write-guard";

const app = new Hono<{ Bindings: Env }>();

// CORS fechado para as origens do CORS_ORIGINS (wrangler.toml). Fallback "*" so em dev sem var.
app.use("*", cors({
  origin: (origin, c) => {
    const allowed = (c.env?.CORS_ORIGINS ?? "")
      .split(",")
      .map((o: string) => o.trim())
      .filter(Boolean);
    if (allowed.length === 0) return "*";
    return allowed.includes(origin) ? origin : allowed[0];
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
}));

// Escrita so para o dono. Registrado antes das rotas para valer em todas elas.
app.use("/api/*", writeGuard);

// Health check
app.get("/api/health", async (c) => {
  // Freshness de operação: idade do último heartbeat do cron e do último preço/KV.
  // Falha de leitura não derruba o health; retorna null e o health segue ok.
  let freshness = {
    last_cron_at: null as string | null,
    last_cron_errors: null as number | null,
    last_cron_error_detail: null as string[] | null,
    last_price_age_s: null as number | null,
  };
  try {
    const lastRun = await c.env.DB.prepare(
      "SELECT run_at, error_count, successos_erros FROM cron_executions ORDER BY run_at DESC LIMIT 1"
    ).first<{ run_at: string; error_count: number; successos_erros: string | null }>();
    if (lastRun) {
      freshness.last_cron_at = lastRun.run_at;
      freshness.last_cron_errors = lastRun.error_count;
      // Detalhe dos erros no próprio health: sem isso, diagnosticar o cron
      // exige acesso direto à D1 (P2-001, 12/09/2026). Só strings, truncadas.
      try {
        const parsed = JSON.parse(lastRun.successos_erros ?? "{}") as { erros?: unknown };
        if (Array.isArray(parsed.erros) && parsed.erros.length > 0) {
          freshness.last_cron_error_detail = parsed.erros
            .slice(0, 5)
            .map((e) => String(e).slice(0, 200));
        }
      } catch { /* detalhe ilegível, contagem basta */ }
    }
  } catch { /* heartbeat indisponível ainda (tabela recém-criada) */ }

  try {
    const price = await c.env.KV.get("btc:price:v3");
    if (price) {
      const parsed = JSON.parse(price) as { cached_at?: string };
      if (parsed.cached_at) {
        freshness.last_price_age_s = Math.round((Date.now() - new Date(parsed.cached_at).getTime()) / 1000);
      }
    }
  } catch { /* sem preço em cache */ }

  return c.json({
    ok: true,
    service: "btc-radar",
    version: SERVICE_VERSION,
    news_source: "coindesk-rss",
    timestamp: new Date().toISOString(),
    freshness,
  });
});

// Rotas
app.route("/api/price", priceRoutes);
app.route("/api/sentiment", sentimentRoutes);
app.route("/api/news", newsRoutes);
app.route("/api/signals", signalRoutes);
app.route("/api/onchain", onchainRoutes);
app.route("/api/trades", tradeRoutes);
app.route("/api/alerts", alertRoutes);
app.route("/api/backtest", backtestRoutes);
app.route("/api/derivatives", derivativesRoutes);
app.route("/api/portfolio", portfolioRoutes);
app.route("/api/briefing", briefingRoutes);
app.route("/api/whatsapp", whatsappRoutes);
app.route("/api/auth", authRoutes);

// Cron handler — coleta batch programada
export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
