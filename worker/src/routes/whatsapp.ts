// BTC Radar — Rotas WhatsApp (webhook Meta + gestao de assinaturas)
// GET  /api/whatsapp/webhook   — verificacao do webhook (Meta)
// POST /api/whatsapp/webhook   — recebe mensagens e status (Meta)
// POST /api/whatsapp/subscribe — cadastrar numero
// GET  /api/whatsapp/subscribers — listar assinantes
// DELETE /api/whatsapp/subscribe/:phone — remover assinatura
// POST /api/whatsapp/test      — enviar mensagem de teste

import { Hono } from "hono";
import type { Env } from "../types";
import {
  verifyWebhook,
  parseIncomingMessage,
  parseCommand,
  getHelpMessage,
  sendTextMessage,
  formatSignalForWhatsApp,
} from "../lib/whatsapp";
import type { WhatsAppSubscriber, WhatsAppMessage } from "../types";

export const whatsappRoutes = new Hono<{ Bindings: Env }>();

// ─── Helpers ───

function subscriberFromRow(row: Record<string, unknown>): WhatsAppSubscriber {
  return {
    phone: row.phone as string,
    subscribed_at: row.subscribed_at as string,
    active: Boolean(row.active),
    last_notification_at: (row.last_notification_at as string) ?? null,
    notification_count: Number(row.notification_count ?? 0),
    preferences: row.preferences ? JSON.parse(row.preferences as string) : { signals: true, alerts: true, briefing: false },
  };
}

// ─── GET /api/whatsapp/webhook — verificacao do webhook Meta ───

whatsappRoutes.get("/webhook", (c) => {
  const mode = c.req.query("hub.mode") ?? "";
  const token = c.req.query("hub.verify_token") ?? "";
  const challenge = c.req.query("hub.challenge") ?? "";

  // Sem token configurado, webhook fica fechado: nunca usar default previsivel
  const verifyToken = c.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return c.text("Webhook nao configurado (WHATSAPP_VERIFY_TOKEN ausente)", 403);
  }
  const result = verifyWebhook(mode, token, challenge, verifyToken);

  if (!result.verified) {
    return c.text(result.error ?? "Erro de verificacao", 403);
  }

  return c.text(result.challenge ?? "", 200);
});

// ─── POST /api/whatsapp/webhook — recebe mensagens e status ───

// Comparacao em tempo constante para assinatura
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(appSecret: string, rawBody: string, signatureHeader: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = "sha256=" + Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return safeEqual(signatureHeader, expected);
}

whatsappRoutes.post("/webhook", async (c) => {
  try {
    // Valida assinatura do Meta quando o app secret esta configurado.
    // Sem ela, qualquer um que conheca a URL forja mensagens e o app envia
    // WhatsApp com custo na conta do dono.
    const appSecret = c.env.WHATSAPP_APP_SECRET;
    let body: unknown;
    if (appSecret) {
      const rawBody = await c.req.text();
      const signatureHeader = c.req.header("X-Hub-Signature-256") ?? "";
      if (!(await verifySignature(appSecret, rawBody, signatureHeader))) {
        console.error("[whatsapp webhook] assinatura invalida, payload descartado");
        return c.text("Forbidden", 403);
      }
      body = JSON.parse(rawBody);
    } else {
      console.warn("[whatsapp webhook] WHATSAPP_APP_SECRET ausente, assinatura nao validada");
      body = await c.req.json();
    }

    const { messages, statuses } = parseIncomingMessage(body as Parameters<typeof parseIncomingMessage>[0]);

    // Registrar mensagens e status em batch — pedacos de 10, mesmo padrao do cron
    const stmts: D1PreparedStatement[] = [];

    // Processar mensagens recebidas
    for (const msg of messages) {
      const parsed = parseCommand(msg.text);

      if (parsed) {
        await handleCommand(c.env, msg.from, parsed.command);
      } else {
        // Mensagem nao reconhecida — responde com ajuda
        // So responde se for texto (nao status, nao midia)
        if (msg.text && msg.text.length > 0 && !msg.text.startsWith("{")) {
          try {
            await sendTextMessage(c.env, msg.from, [
              `Comando nao reconhecido: "${msg.text}"`,
              ``,
              `Envie *AJUDA* para ver os comandos disponiveis.`,
            ].join("\n"));
          } catch { /* falha silenciosa em resposta automatica */ }
        }
      }

      // Registrar mensagem recebida
      try {
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO whatsapp_messages (phone, direction, message_type, content, timestamp, wa_message_id, status)
             VALUES (?, 'inbound', 'command', ?, ?, ?, 'received')`
          ).bind(msg.from, msg.text.slice(0, 1000), msg.timestamp, msg.messageId)
        );
      } catch { /* log apenas */ }
    }

    // Registrar status de entrega (status por mensagem via wa_message_id)
    for (const status of statuses) {
      try {
        stmts.push(
          c.env.DB.prepare(
            `UPDATE whatsapp_messages SET status = ? WHERE wa_message_id = ?`
          ).bind(status.status, status.messageId)
        );
      } catch { /* log apenas */ }
    }

    for (let i = 0; i < stmts.length; i += 10) {
      try {
        await c.env.DB.batch(stmts.slice(i, i + 10));
      } catch { /* log apenas */ }
    }

    return c.text("OK", 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro no webhook";
    console.error(`[whatsapp webhook] ${message}`);
    return c.text("OK", 200); // Sempre retorna 200 para o Meta nao reenviar
  }
});

// ─── Processar comandos do usuario ───

async function handleCommand(env: Env, phone: string, command: string): Promise<void> {
  switch (command) {
    case "subscribe": {
      // Verifica se ja existe
      const existing = await env.DB.prepare(
        "SELECT * FROM whatsapp_subscribers WHERE phone = ?"
      ).bind(phone).first();

      const now = new Date().toISOString();
      if (existing) {
        await env.DB.prepare(
          "UPDATE whatsapp_subscribers SET active = 1, subscribed_at = ? WHERE phone = ?"
        ).bind(now, phone).run();
        await sendTextMessage(env, phone, [
          "*BTC Radar — Assinatura Reativada*",
          ``,
          `Voce voltara a receber sinais de trading no WhatsApp.`,
          `Envie *PAUSAR* a qualquer momento para interromper.`,
          `Envie *SINAIS* para receber os sinais atuais agora.`,
        ].join("\n"));
      } else {
        await env.DB.prepare(
          `INSERT INTO whatsapp_subscribers (phone, subscribed_at, active, preferences)
           VALUES (?, ?, 1, '{"signals":true,"alerts":true,"briefing":false}')`
        ).bind(phone, now).run();
        await sendTextMessage(env, phone, [
          "*BTC Radar — Assinatura Ativada*",
          ``,
          `A partir de agora voce recebera sinais de trading e alertas de preco no WhatsApp.`,
          ``,
          `*Comandos disponiveis:*`,
          `SINAIS — Sinais atuais agora`,
          `STATUS — Status da assinatura`,
          `PAUSAR — Pausar notificacoes`,
          `RETOMAR — Retomar notificacoes`,
          `AJUDA — Menu de comandos`,
          ``,
          `_BTC Radar · btc-radar.pages.dev_`,
        ].join("\n"));
      }
      break;
    }

    case "signals": {
      const cached = await env.KV.get("btc:signals:latest", "json");
      if (!cached || !Array.isArray(cached) || cached.length === 0) {
        await sendTextMessage(env, phone, [
          "*BTC Radar — Sinais*",
          ``,
          `Nenhum sinal disponivel no momento. Os sinais sao gerados a cada hora.`,
          `Tente novamente em alguns minutos.`,
        ].join("\n"));
        return;
      }

      // Enviar sinais filtrados (apenas alta conviccao para nao floodar)
      const signals = cached as Array<{ verdict: string; conviction: number }>;
      const relevant = signals.filter(
        (s) => s.verdict === "COMPRAR" || s.verdict === "VENDER" || s.conviction >= 6
      );

      if (relevant.length === 0) {
        await sendTextMessage(env, phone, [
          "*BTC Radar — Sinais*",
          ``,
          `${signals.length} sinais gerados, nenhum de alta conviccao no momento.`,
          `Visite btc-radar.pages.dev/signals para ver todos.`,
        ].join("\n"));
        return;
      }

      for (const signal of relevant.slice(0, 3)) {
        // Limitar a 3 sinais para nao floodar
        await sendTextMessage(env, phone, formatSignalForWhatsApp(signal as any));
      }

      if (relevant.length > 3) {
        await sendTextMessage(env, phone,
          `_...e mais ${relevant.length - 3} sinais. Veja todos em btc-radar.pages.dev/signals_`
        );
      }
      break;
    }

    case "status": {
      const sub = await env.DB.prepare(
        "SELECT * FROM whatsapp_subscribers WHERE phone = ?"
      ).bind(phone).first();

      if (!sub) {
        await sendTextMessage(env, phone, "Voce nao tem assinatura ativa. Envie *ATIVAR* para comecar.");
        return;
      }

      const s = subscriberFromRow(sub as Record<string, unknown>);
      await sendTextMessage(env, phone, [
        "*BTC Radar — Status da Assinatura*",
        ``,
        `Status: ${s.active ? "Ativa" : "Pausada"}`,
        `Desde: ${new Date(s.subscribed_at).toLocaleDateString("pt-BR")}`,
        `Notificacoes enviadas: ${s.notification_count}`,
        `Ultima notificacao: ${s.last_notification_at ? new Date(s.last_notification_at).toLocaleString("pt-BR") : "Nenhuma"}`,
        ``,
        `Sinais: ${s.preferences.signals !== false ? "ON" : "OFF"}`,
        `Alertas: ${s.preferences.alerts !== false ? "ON" : "OFF"}`,
        `Briefing: ${s.preferences.briefing === true ? "ON" : "OFF"}`,
      ].join("\n"));
      break;
    }

    case "pause": {
      await env.DB.prepare(
        "UPDATE whatsapp_subscribers SET active = 0 WHERE phone = ?"
      ).bind(phone).run();
      await sendTextMessage(env, phone, "Notificacoes pausadas. Envie *RETOMAR* quando quiser voltar a receber.");
      break;
    }

    case "resume": {
      await env.DB.prepare(
        "UPDATE whatsapp_subscribers SET active = 1 WHERE phone = ?"
      ).bind(phone).run();
      await sendTextMessage(env, phone, "Notificacoes retomadas. Voce voltara a receber sinais e alertas.");
      break;
    }

    case "help": {
      await sendTextMessage(env, phone, getHelpMessage());
      break;
    }

    default:
      break;
  }
}

// ─── POST /api/whatsapp/subscribe — cadastrar numero (via app web) ───

whatsappRoutes.post("/subscribe", async (c) => {
  try {
    const body = await c.req.json<{ phone: string; preferences?: Record<string, boolean> }>();
    if (!body.phone) {
      return c.json({ success: false, data: null, error: "phone obrigatorio", timestamp: new Date().toISOString() }, 400);
    }

    // Normalizar: remover espacos, +, parenteses, tracos
    const phone = body.phone.replace(/[\s+()\-]/g, "");
    if (!/^\d{10,15}$/.test(phone)) {
      return c.json({ success: false, data: null, error: "formato de telefone invalido", timestamp: new Date().toISOString() }, 400);
    }

    const now = new Date().toISOString();
    const prefs = JSON.stringify({
      signals: body.preferences?.signals !== false,
      alerts: body.preferences?.alerts !== false,
      briefing: body.preferences?.briefing === true,
    });

    const existing = await c.env.DB.prepare(
      "SELECT phone FROM whatsapp_subscribers WHERE phone = ?"
    ).bind(phone).first();

    if (existing) {
      await c.env.DB.prepare(
        "UPDATE whatsapp_subscribers SET active = 1, preferences = ?, subscribed_at = ? WHERE phone = ?"
      ).bind(prefs, now, phone).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO whatsapp_subscribers (phone, subscribed_at, active, preferences)
         VALUES (?, ?, 1, ?)`
      ).bind(phone, now, prefs).run();
    }

    // Enviar mensagem de boas-vindas
    try {
      await sendTextMessage(c.env, phone, [
        "*BTC Radar — Bem-vindo*",
        ``,
        `Sua assinatura foi ativada com sucesso.`,
        `Voce recebera sinais de trading e alertas de preco no WhatsApp.`,
        ``,
        `Envie *SINAIS* para receber os sinais atuais agora.`,
        `Envie *AJUDA* para ver todos os comandos.`,
      ].join("\n"));
    } catch { /* falha no envio nao bloqueia cadastro */ }

    return c.json({
      success: true,
      data: { phone, subscribed_at: now, active: true },
      timestamp: new Date().toISOString(),
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao cadastrar";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── GET /api/whatsapp/subscribers — listar assinantes ───

whatsappRoutes.get("/subscribers", async (c) => {
  try {
    const result = await c.env.DB.prepare(
      "SELECT * FROM whatsapp_subscribers ORDER BY subscribed_at DESC LIMIT 100"
    ).all();

    const subscribers: WhatsAppSubscriber[] = (result.results ?? []).map(subscriberFromRow);

    return c.json({
      success: true,
      data: subscribers,
      count: subscribers.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao listar assinantes";
    return c.json({ success: false, data: [], error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── DELETE /api/whatsapp/subscribe/:phone — remover assinatura ───

whatsappRoutes.delete("/subscribe/:phone", async (c) => {
  try {
    const phone = c.req.param("phone");

    const existing = await c.env.DB.prepare(
      "SELECT phone FROM whatsapp_subscribers WHERE phone = ?"
    ).bind(phone).first();

    if (!existing) {
      return c.json({
        success: false, data: null,
        error: "Assinante nao encontrado",
        timestamp: new Date().toISOString(),
      }, 404);
    }

    await c.env.DB.prepare(
      "UPDATE whatsapp_subscribers SET active = 0 WHERE phone = ?"
    ).bind(phone).run();

    return c.json({
      success: true,
      data: { phone, deleted: true },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao remover";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});

// ─── POST /api/whatsapp/test — enviar mensagem de teste ───

whatsappRoutes.post("/test", async (c) => {
  try {
    const body = await c.req.json<{ phone: string }>();
    if (!body.phone) {
      return c.json({ success: false, data: null, error: "phone obrigatorio", timestamp: new Date().toISOString() }, 400);
    }

    const phone = body.phone.replace(/[\s+()\-]/g, "");
    const result = await sendTextMessage(c.env, phone, [
      "*BTC Radar — Teste de Notificacao*",
      ``,
      `Se voce esta recebendo esta mensagem, o WhatsApp Push esta funcionando corretamente.`,
      ``,
      `Voce recebera sinais de trading e alertas de preco automaticamente.`,
      ``,
      `_Enviado em ${new Date().toLocaleString("pt-BR")}_`,
    ].join("\n"));

    return c.json({
      success: true,
      data: { phone, messageId: result.messageId, status: result.status },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao enviar teste";
    return c.json({ success: false, data: null, error: message, timestamp: new Date().toISOString() }, 500);
  }
});
