// BTC Radar — Queries D1
// Funções tipadas para acesso ao banco

// ─── Prices ───

export function insertPriceQuery(): string {
  return `INSERT OR REPLACE INTO prices (symbol, timestamp, open, high, low, close, volume, interval, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}

// ─── Fear & Greed ───

export function insertFearGreedQuery(): string {
  return `INSERT OR REPLACE INTO fear_greed (date, value, classification, timestamp, source)
          VALUES (?, ?, ?, ?, ?)`;
}

// ─── News ───

export function insertNewsQuery(): string {
  return `INSERT OR IGNORE INTO news (published_at, title, url, source, sentiment, summary)
          VALUES (?, ?, ?, ?, ?, ?)`;
}
