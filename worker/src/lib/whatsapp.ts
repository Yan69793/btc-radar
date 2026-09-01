// BTC Radar — Cliente WhatsApp Cloud API (Meta Graph API v23.0)
// Fetch puro, sem dependencias externas.
// Ref: https://developers.facebook.com/docs/whatsapp/cloud-api

import type { SignalDocument } from "../types";

const GRAPH_VERSION = "v23.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ─── Tipos internos ───

interface WAMessage {
  messaging_product: string;
  to: string;
  type: string;
  text?: { body: string };
  template?: {
    name: string;
    language: { code: string };
    components?: Array<{
      type: string;
      parameters: Array<{ type: string; text: string }>;
    }>;
  };
}

interface WAIncoming {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ wa_id: string; profile: { name: string } }>;
        messages?: Array<{
          id: string;
          from: string;
          timestamp: string;
          text: { body: string };
          type: string;
        }>;
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
        }>;
      };
    }>;
  }>;
}

interface WAIncomingMessage {
  from: string;
  text: string;
  timestamp: string;
  messageId: string;
  name: string;
}

export interface WAStatus {
  messageId: string;
  status: string;
  timestamp: string;
  recipientId: string;
}

// ─── Config ───

function getConfig(env: { WHATSAPP_TOKEN?: string; WHATSAPP_PHONE_NUMBER_ID?: string }) {
  const token = env.WHATSAPP_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp nao configurado: WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID sao obrigatorios");
  }
  return { token, phoneNumberId };
}

// ─── Envio ───

async function sendMessage(
  env: { WHATSAPP_TOKEN?: string; WHATSAPP_PHONE_NUMBER_ID?: string },
  message: WAMessage,
): Promise<{ messageId: string; status: string }> {
  const { token, phoneNumberId } = getConfig(env);
  const url = `${BASE_URL}/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  const body = await res.json() as { messages?: Array<{ id: string }>; error?: { message: string; type: string; code: number } };

  if (!res.ok || body.error) {
    const errMsg = body.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`WhatsApp API error: ${errMsg} (code: ${body.error?.code ?? res.status})`);
  }

  return {
    messageId: body.messages?.[0]?.id ?? "unknown",
    status: "sent",
  };
}

// ─── API publica ───

export async function sendTextMessage(
  env: { WHATSAPP_TOKEN?: string; WHATSAPP_PHONE_NUMBER_ID?: string },
  to: string,
  text: string,
): Promise<{ messageId: string; status: string }> {
  return sendMessage(env, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

const HORIZONTE_LABEL: Record<string, string> = {
  short: "Curto Prazo (1-3d)",
  medium: "Medio Prazo (3-30d)",
  long: "Longo Prazo (6m+)",
};

const ESTRATEGIA_LABEL: Record<string, string> = {
  dca: "DCA (Acumulacao)",
  fear_greed_contrarian: "Fear & Greed Contrarian",
  trend_following: "EMA Cross (Tendencia)",
  macd: "MACD",
  rsi: "RSI",
  grid_trading: "Grid Trading",
};

// Template signal: usado para push automatico de sinais
// Formato enxuto que cabe em 1-2 linhas no WhatsApp
export function formatSignalForWhatsApp(signal: SignalDocument): string {
  const estrategia = ESTRATEGIA_LABEL[signal.strategy] ?? signal.strategy;
  const horizonte = HORIZONTE_LABEL[signal.timeframe] ?? signal.timeframe;
  const convictionBar = "█".repeat(signal.conviction) + "░".repeat(10 - signal.conviction);

  const lines = [
    `*BTC Radar — Sinal de Trading*`,
    ``,
    `*Estrategia:* ${estrategia}`,
    `*Horizonte:* ${horizonte}`,
    `*Verito:* ${signal.verdict}`,
    `*Conviccao:* ${signal.conviction}/10 ${convictionBar}`,
  ];

  if (signal.entry_price != null) {
    lines.push(``);
    lines.push(`*Entrada:* $${signal.entry_price.toLocaleString("en-US")}`);
  }
  if (signal.stop_loss != null) {
    lines.push(`*Stop Loss:* $${signal.stop_loss.toLocaleString("en-US")}`);
  }
  if (signal.target_1 != null) {
    lines.push(`*Alvo 1:* $${signal.target_1.toLocaleString("en-US")}`);
  }
  if (signal.target_2 != null) {
    lines.push(`*Alvo 2:* $${signal.target_2.toLocaleString("en-US")}`);
  }
  if (signal.risk_reward != null) {
    lines.push(`*Risk/Reward:* ${signal.risk_reward}`);
  }

  lines.push(``);
  lines.push(`*Motivo:* ${signal.payload.rationale}`);

  // Indicadores tecnicos
  const indicadores = Object.entries(signal.payload.technical_indicators)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? (Math.round(v * 100) / 100) : v}`)
    .join(" | ");
  if (indicadores) {
    lines.push(``);
    lines.push(`*Indicadores:* ${indicadores}`);
  }

  lines.push(``);
  lines.push(`_BTC Radar · btc-radar.pages.dev_`);

  return lines.join("\n");
}

// Formato curto para template (cabe em 1 template message com parametros)
export function formatSignalShort(signal: SignalDocument): { strategy: string; timeframe: string; verdict: string; conviction: string; entry: string; stop: string; target: string } {
  const estrategia = ESTRATEGIA_LABEL[signal.strategy] ?? signal.strategy;
  const horizonte = HORIZONTE_LABEL[signal.timeframe] ?? signal.timeframe;

  return {
    strategy: estrategia,
    timeframe: signal.timeframe === "short" ? "Curto" : signal.timeframe === "medium" ? "Medio" : "Longo",
    verdict: signal.verdict,
    conviction: `${signal.conviction}/10`,
    entry: signal.entry_price != null ? `$${signal.entry_price.toLocaleString("en-US")}` : "N/D",
    stop: signal.stop_loss != null ? `$${signal.stop_loss.toLocaleString("en-US")}` : "N/D",
    target: signal.target_1 != null ? `$${signal.target_1.toLocaleString("en-US")}` : "N/D",
  };
}

export async function sendSignalCard(
  env: { WHATSAPP_TOKEN?: string; WHATSAPP_PHONE_NUMBER_ID?: string },
  to: string,
  signal: SignalDocument,
): Promise<{ messageId: string; status: string }> {
  const text = formatSignalForWhatsApp(signal);
  return sendTextMessage(env, to, text);
}

// ─── Webhook ───

export function verifyWebhook(
  mode: string,
  token: string,
  challenge: string,
  verifyToken: string,
): { verified: boolean; challenge?: string; error?: string } {
  if (mode !== "subscribe") {
    return { verified: false, error: "mode deve ser subscribe" };
  }
  if (token !== verifyToken) {
    return { verified: false, error: "token de verificacao invalido" };
  }
  return { verified: true, challenge };
}

export function parseIncomingMessage(body: WAIncoming): {
  messages: WAIncomingMessage[];
  statuses: WAStatus[];
} {
  const messages: WAIncomingMessage[] = [];
  const statuses: WAStatus[] = [];

  if (body.object !== "whatsapp_business_account") {
    return { messages, statuses };
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (value.messaging_product !== "whatsapp") continue;

      // Mensagens recebidas
      for (const msg of value.messages ?? []) {
        if (msg.type === "text" && msg.text?.body) {
          const contact = value.contacts?.find((c) => c.wa_id === msg.from);
          messages.push({
            from: msg.from,
            text: msg.text.body.trim(),
            timestamp: msg.timestamp,
            messageId: msg.id,
            name: contact?.profile?.name ?? msg.from,
          });
        }
      }

      // Status de entrega
      for (const status of value.statuses ?? []) {
        statuses.push({
          messageId: status.id,
          status: status.status,
          timestamp: status.timestamp,
          recipientId: status.recipient_id,
        });
      }
    }
  }

  return { messages, statuses };
}

// ─── Processamento de comandos ───

const COMMANDS: Record<string, string> = {
  "ativar": "subscribe",
  "sinais": "signals",
  "status": "status",
  "pausar": "pause",
  "retomar": "resume",
  "ajuda": "help",
  "help": "help",
};

export function parseCommand(text: string): { command: string; args: string } | null {
  const normalized = text.toLowerCase().trim();
  const parts = normalized.split(/\s+/);
  const cmd = COMMANDS[parts[0]!];
  if (!cmd) return null;
  return { command: cmd, args: parts.slice(1).join(" ") };
}

export function getHelpMessage(): string {
  return [
    "*BTC Radar — Comandos WhatsApp*",
    ``,
    `*ATIVAR* — Ativar recebimento de sinais`,
    `*SINAIS* — Receber sinais atuais agora`,
    `*STATUS* — Ver status da sua assinatura`,
    `*PAUSAR* — Pausar notificacoes`,
    `*RETOMAR* — Retomar notificacoes`,
    `*AJUDA* — Mostrar este menu`,
    ``,
    `_Responda com qualquer comando a qualquer momento._`,
    ``,
    `_BTC Radar · btc-radar.pages.dev_`,
  ].join("\n");
}
