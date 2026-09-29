import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cutoffArg = process.argv.find((a) => a.startsWith("--from="));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const cutoff = cutoffArg ? Date.parse(cutoffArg.slice(7)) : Date.parse("2018-01-01T00:00:00Z");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const outPath = outArg
  ? resolve(outArg.slice(6))
  : resolve(scriptDir, "../results/okx-daily-backfill.sql");

if (!Number.isFinite(cutoff)) throw new Error("--from deve ser uma data ISO valida");

const rows = new Map();
let after = null;
let pages = 0;

while (pages < 40) {
  const url = new URL("https://www.okx.com/api/v5/market/history-candles");
  url.searchParams.set("instId", "BTC-USDT");
  url.searchParams.set("bar", "1D");
  url.searchParams.set("limit", "100");
  if (after) url.searchParams.set("after", after);

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== "0" || !Array.isArray(json.data)) {
    throw new Error(`OKX code=${json.code} msg=${json.msg ?? ""}`);
  }
  if (json.data.length === 0) break;

  let oldest = Infinity;
  for (const k of json.data) {
    const ts = Number(k[0]);
    if (!Number.isFinite(ts)) continue;
    oldest = Math.min(oldest, ts);
    if (ts < cutoff) continue;
    if (String(k[8]) !== "1") continue;
    rows.set(ts, {
      timestamp: new Date(ts).toISOString(),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    });
  }

  pages += 1;
  if (!Number.isFinite(oldest) || oldest <= cutoff) break;
  after = String(oldest);
  await new Promise((r) => setTimeout(r, 150));
}

const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
const esc = (s) => String(s).replaceAll("'", "''");
const lines = [
  "-- BTC Radar daily OHLCV backfill from OKX. Generated locally; review before remote apply.",
  "BEGIN TRANSACTION;",
  ...ordered.map((r) =>
    `INSERT OR IGNORE INTO prices (symbol,timestamp,open,high,low,close,volume,interval,source) VALUES ('BTC-USD','${esc(r.timestamp)}',${r.open},${r.high},${r.low},${r.close},${r.volume},'1d','OKX');`
  ),
  "COMMIT;",
  "",
];

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, lines.join("\n"), "utf8");

console.log(JSON.stringify({
  ok: true,
  pages,
  candles: ordered.length,
  from: ordered[0]?.timestamp ?? null,
  to: ordered.at(-1)?.timestamp ?? null,
  output: outPath,
}, null, 2));
