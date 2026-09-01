// BTC Radar — Conectores de noticias
// CryptoPanic: bloqueia IPs de Cloudflare Workers (WAF).
// CoinGecko /news: virou PRO (pago) em 2025.
// Reddit JSON: bloqueia/serve HTML para IPs de datacenter.
// CoinDesk RSS: funciona, sem auth, sem bloqueio.

import type { NewsItem } from "../types";

// ─── RSS Parser (CoinDesk) ───

const COINDESK_RSS = "https://www.coindesk.com/arc/outboundfeeds/rss/";

interface RSSItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  creator?: string;
}

function parseRSSItems(xml: string): RSSItem[] {
  const items: RSSItem[] = [];
  // Extrai blocos <item>...</item>
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]!;
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const description = extractTag(block, "description");
    const creator = extractTag(block, "dc:creator");

    if (title && link) {
      items.push({ title, link, pubDate, description, creator });
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = regex.exec(xml);
  if (!match?.[1]) return "";
  return decodeEntities(match[1].trim());
}

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1") // extrai CDATA antes de strip HTML
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/<[^>]*>/g, "") // strip HTML tags (apos CDATA)
    .trim();
}

function deriveSentiment(title: string): "positive" | "neutral" | "negative" | null {
  const lower = title.toLowerCase();
  const bullish = ["surge", "rally", "bull", "breakout", "soar", "jump", "adoption", "approve", "etf", "all-time", "record high", "gains"];
  const bearish = ["crash", "plunge", "dump", "bear", "collapse", "ban", "crackdown", "hack", "exploit", "tumbled", "fell", "drop", "sell-off"];
  if (bullish.some((w) => lower.includes(w))) return "positive";
  if (bearish.some((w) => lower.includes(w))) return "negative";
  return null;
}

export async function fetchCoinDeskNews(limit: number = 20): Promise<NewsItem[]> {
  const res = await fetch(COINDESK_RSS, {
    headers: {
      "User-Agent": "BTC-Radar/1.0",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`CoinDesk RSS HTTP ${res.status}`);
  }

  const xml = await res.text();
  const items = parseRSSItems(xml);

  if (items.length === 0) {
    return [];
  }

  return items.slice(0, limit).map((item) => ({
    id: `cd-${btoa(item.link).slice(0, 16)}`,
    title: item.title,
    url: item.link,
    source: item.creator ? `CoinDesk (${item.creator})` : "CoinDesk",
    published_at: new Date(item.pubDate).toISOString(),
    sentiment: deriveSentiment(item.title),
    summary: item.description.slice(0, 300),
  }));
}

// ─── Aggregator ───

export type NewsFilter = "hot" | "bullish" | "bearish" | "important";

export async function fetchNewsAggregated(
  _filter: NewsFilter = "hot",
  limit: number = 20,
): Promise<NewsItem[]> {
  try {
    return await fetchCoinDeskNews(limit);
  } catch (err) {
    console.log(`[btc-radar] CoinDesk RSS failed: ${err instanceof Error ? err.message : "unknown"}`);
    return [];
  }
}
