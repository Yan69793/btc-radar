// Mercado Bitcoin API connector — microestrutura BTC/BRL
// API pública, sem chave, sem autenticação para dados de mercado.
// Endpoint oficial de exemplo: /api/v4/BTC-BRL/orderbook
// Docs: https://api.mercadobitcoin.net/api/v4/docs

const BASE_URL = "https://api.mercadobitcoin.net/api/v4";

// Nível do book: [preço, quantidade] — ambos como string na API.
export interface MBLevel {
  price: number;
  amount: number;
}

export interface MBOrderBook {
  asks: MBLevel[];
  bids: MBLevel[];
}

export interface Microstructure {
  symbol: string; // "BTC-BRL"
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  spread: number | null;
  spreadBps: number | null;
  bidDepth: number | null; // BRL acumulado nas N primeiras linhas de bid
  askDepth: number | null; // BRL acumulado nas N primeiras linhas de ask
  depthLevels: number; // quantos níveis entraram no depth
  timestamp: string; // ISO 8601 UTC (hora do fetch)
  source: string;
}

function toLevel(entry: unknown): MBLevel | null {
  if (!Array.isArray(entry) || entry.length < 2) return null;
  const price = Number(entry[0]);
  const amount = Number(entry[1]);
  if (!Number.isFinite(price) || !Number.isFinite(amount) || price <= 0 || amount < 0) {
    return null;
  }
  return { price, amount };
}

/**
 * Converte o envelope bruto da MB em níveis válidos, de forma defensiva.
 * Aceita tanto o envelope {asks, bids} quanto os arrays diretos.
 * Níveis inválidos (preço <= 0, quantidade NaN) são descartados.
 */
export function parseOrderBook(raw: unknown): MBOrderBook {
  const obj = (raw ?? {}) as { asks?: unknown; bids?: unknown };
  const asksRaw = Array.isArray(obj.asks) ? obj.asks : Array.isArray(raw) ? raw : [];
  const bidsRaw = Array.isArray(obj.bids) ? obj.bids : [];

  const parseSide = (side: unknown): MBLevel[] =>
    (Array.isArray(side) ? side : [])
      .map(toLevel)
      .filter((l): l is MBLevel => l !== null);

  const asks = parseSide(asksRaw).sort((a, b) => a.price - b.price);
  const bids = parseSide(bidsRaw).sort((a, b) => b.price - a.price);

  return { asks, bids };
}

/**
 * Calcula a microestrutura a partir do book já parseado.
 * Pura, sem I/O: testável e determinística.
 * - bestBid/bestAsk = topo do book (maior bid, menor ask)
 * - midpoint = (bestBid + bestAsk) / 2
 * - spread = bestAsk - bestBid; spreadBps = (spread / midpoint) * 10_000
 * - depth = soma (preço * quantidade) das N primeiras linhas de cada lado
 */
export function computeMicrostructure(
  book: MBOrderBook,
  depthLevels: number = 10,
  now: string = new Date().toISOString(),
): Microstructure {
  const bestBid = book.bids[0]?.price ?? null;
  const bestAsk = book.asks[0]?.price ?? null;

  const midpoint = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const spreadBps = spread != null && midpoint != null && midpoint > 0
    ? (spread / midpoint) * 10_000
    : null;

  const sumDepth = (levels: MBLevel[]): number | null => {
    if (levels.length === 0) return null;
    return levels
      .slice(0, depthLevels)
      .reduce((acc, l) => acc + l.price * l.amount, 0);
  };

  return {
    symbol: "BTC-BRL",
    bestBid,
    bestAsk,
    midpoint,
    spread,
    spreadBps: spreadBps != null ? round4(spreadBps) : null,
    bidDepth: sumDepth(book.bids),
    askDepth: sumDepth(book.asks),
    depthLevels,
    timestamp: now,
    source: "Mercado Bitcoin",
  };
}

/**
 * Prêmio/desconto do midpoint local (MB) contra uma referência global em BRL.
 * premiumPct = (midpoint / referenceBrl - 1) * 100.
 * Retorna null quando não há midpoint ou referência válida (N/D, nunca inventado).
 */
export function computeBrlPremium(
  midpoint: number | null,
  referenceBrl: number | null,
): number | null {
  if (midpoint == null || referenceBrl == null || referenceBrl <= 0) return null;
  return round4((midpoint / referenceBrl - 1) * 100);
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export async function fetchMBOrderBook(timeoutMs: number = 5000): Promise<MBOrderBook> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/BTC-BRL/orderbook`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Mercado Bitcoin orderbook error: HTTP ${res.status}`);
    }
    const raw = await res.json();
    return parseOrderBook(raw);
  } finally {
    clearTimeout(timer);
  }
}
