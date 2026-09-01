// BTC Radar — Motor de decisao de notificacao
// Filtra sinais, alertas e dispara push via WhatsApp

import type { Env, SignalDocument } from "../types";
import { generateSignals, type SignalInput } from "./signal-engine";
import { computeConsensus, type ConsensusResult } from "./consensus";
import { sendSignalCard, sendTextMessage } from "./whatsapp";

// ─── Config ───

const MIN_CONVICTION_FOR_PUSH = 6;
const VERDICTS_TO_PUSH = new Set(["COMPRAR", "VENDER"]);

// Consenso multi-timeframe: veredito que engatilha envio único de consenso.
const DIRECTIONAL_SET = new Set(["COMPRAR", "VENDER", "REDUZIR"]);
const MIN_CONSENSUS_CONVICTION = 6;

// ─── Helpers ───

interface Subscriber {
  phone: string;
  active: number;
  preferences: string; // JSON: { signals: boolean, alerts: boolean, briefing: boolean }
}

async function getActiveSubscribers(db: D1Database): Promise<Subscriber[]> {
  const result = await db.prepare(
    "SELECT phone, active, preferences FROM whatsapp_subscribers WHERE active = 1"
  ).all();
  return (result.results ?? []) as unknown as Subscriber[];
}

function subscriberWants(subscriber: Subscriber, key: "signals" | "alerts" | "briefing"): boolean {
  try {
    const prefs = JSON.parse(subscriber.preferences);
    return prefs[key] !== false; // default true
  } catch {
    return true; // se JSON invalido, envia tudo
  }
}

function shouldPushSignal(signal: SignalDocument): boolean {
  if (VERDICTS_TO_PUSH.has(signal.verdict)) return true;
  if (signal.conviction >= MIN_CONVICTION_FOR_PUSH) return true;
  return false;
}

// Converte um ConsensusResult em SignalDocument no mesmo shape dos sinais por
// estratégia, para reuso do fluxo de push/dedup. Conviction vem do consenso.
function buildConsensusSignal(consensus: ConsensusResult): SignalDocument {
  return {
    signal_id: `sig-consensus-${consensus.market_date}`,
    symbol: "BTC-USD",
    // O consenso tem horizonte próprio, mas SignalDocument.timeframe é de 3 valores.
    // Usa "long" como horizonte comercial dominante; a strategy "consensus" o identifica.
    timeframe: "long",
    verdict: consensus.verdict,
    market_date: consensus.market_date,
    generated_at: consensus.generated_at,
    entry_price: consensus.price,
    stop_loss: null,
    target_1: null,
    target_2: null,
    risk_reward: null,
    conviction: consensus.conviction,
    strategy: "consensus",
    payload: {
      rationale: consensus.rationale,
      technical_indicators: {},
      on_chain_context: "Indisponível (Fase 2)",
      sentiment_context: "",
      risk_notes: `Consenso ${consensus.agreement * 100}% alinhado, penalidade de divergência ${(consensus.divergence_penalty * 100).toFixed(0)}%.`,
      atr_value: 0,
      atr_multiplier_stop: 0,
      timeframe_hours: 0,
    },
  };
}

async function recordNotification(
  db: D1Database,
  phone: string,
  messageType: string,
  content: string,
  waMessageId: string,
  status: string,
): Promise<void> {
  // INSERT + UPDATE num batch único, 1 round-trip em vez de 2
  await db.batch([
    db.prepare(
      `INSERT INTO whatsapp_messages (phone, direction, message_type, content, timestamp, wa_message_id, status)
       VALUES (?, 'outbound', ?, ?, ?, ?, ?)`
    ).bind(phone, messageType, content.slice(0, 1000), new Date().toISOString(), waMessageId, status),
    db.prepare(
      `UPDATE whatsapp_subscribers SET last_notification_at = ?, notification_count = notification_count + 1 WHERE phone = ?`
    ).bind(new Date().toISOString(), phone),
  ]);
}

// ─── Notificacao de sinais ───

export async function notifyHighConvictionSignals(env: Env): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;

  try {
    // 1. Buscar assinantes ativos que querem sinais
    const subscribers = await getActiveSubscribers(env.DB);
    const signalSubscribers = subscribers.filter((s) => subscriberWants(s, "signals"));
    if (signalSubscribers.length === 0) return { sent: 0, errors: [] };

    // 2. Coletar OHLCV dos 3 horizontes para o signal engine
    const timeframes = ["1d", "4h", "1h"] as const;
    const tfMap: Record<string, { candles: SignalInput["candles"]; timeframe: SignalInput["timeframe"] }> = {};

    for (const interval of timeframes) {
      const rows = await env.DB.prepare(
        `SELECT * FROM prices WHERE interval = ? ORDER BY timestamp DESC LIMIT 200`
      ).bind(interval).all();

      if ((rows.results ?? []).length < 50) continue;

      const candles: SignalInput["candles"] = (rows.results ?? [])
        .map((r: Record<string, unknown>) => ({
          timestamp: r.timestamp as string,
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume: Number(r.volume),
          interval: r.interval as "1h" | "4h" | "1d" | "1w",
          source: (r.source as string) ?? "D1",
        }))
        .reverse();

      const tf: SignalInput["timeframe"] = interval === "1h" ? "short" : interval === "4h" ? "medium" : "long";
      tfMap[tf] = { candles, timeframe: tf };
    }

    if (Object.keys(tfMap).length === 0) {
      return { sent: 0, errors: ["Sem dados OHLCV suficientes para gerar sinais"] };
    }

    // 3. Buscar Fear & Greed do KV
    let fearGreed = null;
    try {
      const fgRaw = await env.KV.get("sentiment:fear-greed", "json");
      if (fgRaw) fearGreed = fgRaw as SignalInput["fearGreed"];
    } catch { /* sem fear & greed */ }

    // 4. Gerar sinais para cada timeframe disponivel
    const allSignals: SignalDocument[] = [];
    for (const [tf, data] of Object.entries(tfMap)) {
      try {
        const signals = generateSignals({
          candles: data.candles,
          fearGreed,
          timeframe: tf as SignalInput["timeframe"],
        });
        allSignals.push(...signals);
      } catch (err) {
        errors.push(`Erro ao gerar sinais ${tf}: ${err instanceof Error ? err.message : "erro"}`);
      }
    }

    // 4b. Consenso multi-timeframe: se o veredito agregado for direcional e forte,
    // envia UM card de consenso em vez de duplicar sinais per-timeframe.
    const consensus = computeConsensus(allSignals);
    let signalsToConsider = allSignals;
    if (consensus) {
      const consensusSignal = buildConsensusSignal(consensus);
      const consensusWins = DIRECTIONAL_SET.has(consensus.verdict) &&
        consensus.conviction >= MIN_CONSENSUS_CONVICTION;
      if (consensusWins) {
        signalsToConsider = [consensusSignal];
      }
    }

    // 5. Filtrar sinais que merecem push, e descartar os ja enviados nas ultimas 24h.
    // O signal_id e diario (sig-<strategy>-<tf>-<marketDate>), entao janela de 24h
    // limita a 1 envio por dia por sinal. O verdict entra no content para uma
    // reversao de verdict no mesmo dia nao ser suprimida pelo dedup.
    let alreadySent: Set<string> = new Set();
    try {
      const recentMsgs = await env.DB.prepare(
        `SELECT content FROM whatsapp_messages
          WHERE message_type = 'signal' AND timestamp >= ?`
      ).bind(new Date(Date.now() - 24 * 3600_000).toISOString()).all();
      alreadySent = new Set(
        (recentMsgs.results ?? []).map((r) => (r as { content: string }).content)
      );
    } catch (err) {
      console.error(`[notifier] dedup: ${err instanceof Error ? err.message : err}`);
    }

    const signalsToPush = signalsToConsider
      .filter(shouldPushSignal)
      .filter((s) => !alreadySent.has(`${s.signal_id}:${s.verdict}`));

    if (signalsToPush.length === 0) {
      return { sent: 0, errors: [] };
    }

    // 6. Enviar para cada assinante (envios em pool por assinante, D1 em batch no fim)
    const notifyStmts: D1PreparedStatement[] = [];
    const updateStmts: D1PreparedStatement[] = [];
    const deactivateStmts: D1PreparedStatement[] = [];

    for (const subscriber of signalSubscribers) {
      await Promise.all(
        signalsToPush.map(async (signal) => {
          try {
            const { messageId, status } = await sendSignalCard(env, subscriber.phone, signal);
            notifyStmts.push(
              env.DB.prepare(
                `INSERT INTO whatsapp_messages (phone, direction, message_type, content, timestamp, wa_message_id, status)
                 VALUES (?, 'outbound', 'signal', ?, ?, ?, ?)`
              ).bind(
                subscriber.phone,
                `${signal.signal_id}:${signal.verdict}`.slice(0, 1000),
                new Date().toISOString(),
                messageId,
                status
              )
            );
            updateStmts.push(
              env.DB.prepare(
                `UPDATE whatsapp_subscribers SET last_notification_at = ?, notification_count = notification_count + 1 WHERE phone = ?`
              ).bind(new Date().toISOString(), subscriber.phone)
            );
            sent++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "erro desconhecido";
            errors.push(`Falha ao enviar para ${subscriber.phone}: ${msg}`);
            // Se for erro de destinatario invalido, marca como inativo
            if (msg.includes("recipient") || msg.includes("131030") || msg.includes("131047")) {
              deactivateStmts.push(
                env.DB.prepare(
                  "UPDATE whatsapp_subscribers SET active = 0 WHERE phone = ?"
                ).bind(subscriber.phone)
              );
            }
          }
        })
      );
    }

    // Grava tudo em batches de 10
    const chunks = async (stmts: D1PreparedStatement[]) => {
      for (let i = 0; i < stmts.length; i += 10) {
        await env.DB.batch(stmts.slice(i, i + 10));
      }
    };
    await chunks(notifyStmts);
    await chunks(updateStmts);
    await chunks(deactivateStmts);

    // 7. Cache dos sinais no KV para o comando SINAIS
    await env.KV.put("btc:signals:latest", JSON.stringify(allSignals), { expirationTtl: 3600 });

  } catch (err) {
    errors.push(`notifyHighConvictionSignals: ${err instanceof Error ? err.message : "erro"}`);
  }

  return { sent, errors };
}

// ─── Notificacao de alertas disparados ───

export async function notifyTriggeredAlerts(
  env: Env,
  triggered: Array<{ id: number; condition: string }>,
  currentPrice: number | null,
): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;

  try {
    if (triggered.length === 0) return { sent: 0, errors: [] };

    const subscribers = await getActiveSubscribers(env.DB);
    const alertSubscribers = subscribers.filter((s) => subscriberWants(s, "alerts"));
    if (alertSubscribers.length === 0) return { sent: 0, errors: [] };

    const priceStr = currentPrice != null ? `$${currentPrice.toLocaleString("en-US")}` : "N/D";

    for (const triggeredAlert of triggered) {
      const text = [
        `*BTC Radar — Alerta Disparado*`,
        ``,
        `Condicao: ${triggeredAlert.condition}`,
        `Preco atual: ${priceStr}`,
        ``,
        `_Gerencie seus alertas em btc-radar.pages.dev/alerts_`,
      ].join("\n");

      for (const sub of alertSubscribers) {
        try {
          const { messageId, status } = await sendTextMessage(env, sub.phone, text);
          await recordNotification(env.DB, sub.phone, "alert_triggered", String(triggeredAlert.id), messageId, status);
          sent++;
        } catch (err) {
          errors.push(`Falha ao notificar alerta para ${sub.phone}: ${err instanceof Error ? err.message : "erro"}`);
        }
      }
    }
  } catch (err) {
    errors.push(`notifyTriggeredAlerts: ${err instanceof Error ? err.message : "erro"}`);
  }

  return { sent, errors };
}

// ─── Notificacao de briefing diario ───

export async function notifyBriefing(
  env: Env,
  summary: string,
): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sent = 0;

  try {
    const subscribers = await getActiveSubscribers(env.DB);
    const briefingSubscribers = subscribers.filter((s) => subscriberWants(s, "briefing"));
    if (briefingSubscribers.length === 0) return { sent: 0, errors: [] };

    // Limitar summary a 1500 chars para WhatsApp (cabe em 1 mensagem)
    const truncated = summary.length > 1500 ? summary.slice(0, 1497) + "..." : summary;
    const text = `*BTC Radar — Briefing Diario*\n\n${truncated}\n\n_Leia completo em btc-radar.pages.dev/briefing_`;

    for (const sub of briefingSubscribers) {
      try {
        const { messageId, status } = await sendTextMessage(env, sub.phone, text);
        await recordNotification(env.DB, sub.phone, "briefing", "daily", messageId, status);
        sent++;
      } catch (err) {
        errors.push(`Falha ao enviar briefing para ${sub.phone}: ${err instanceof Error ? err.message : "erro"}`);
      }
    }
  } catch (err) {
    errors.push(`notifyBriefing: ${err instanceof Error ? err.message : "erro"}`);
  }

  return { sent, errors };
}
