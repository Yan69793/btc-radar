import type { OHLCV } from "../types";

const BASE = "https://api.exchange.coinbase.com/products/BTC-USD/candles";
type Row = [number, number, number, number, number, number];

function aggregate(rows: OHLCV[], interval: "4h" | "1w", bucketMs: number): OHLCV[] {
  const groups = new Map<number, OHLCV[]>();
  for (const row of rows) {
    const t = new Date(row.timestamp).getTime();
    const bucket = interval === "1w"
      ? (() => { const d = new Date(t); const day=(d.getUTCDay()+6)%7; return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day); })()
      : Math.floor(t / bucketMs) * bucketMs;
    const list=groups.get(bucket) ?? []; list.push(row); groups.set(bucket,list);
  }
  return [...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([t,g])=>({
    timestamp:new Date(t).toISOString(), open:g[0]!.open,
    high:Math.max(...g.map(x=>x.high)), low:Math.min(...g.map(x=>x.low)),
    close:g[g.length-1]!.close, volume:g.reduce((n,x)=>n+x.volume,0),
    interval, source:"Coinbase",
  }));
}

export async function fetchCoinbaseOHLCV(interval: "1h"|"4h"|"1d"|"1w"="1d", limit=200): Promise<OHLCV[]> {
  const baseInterval = interval === "4h" ? "1h" : interval === "1w" ? "1d" : interval;
  const granularity = baseInterval === "1h" ? 3600 : 86400;
  const multiplier = interval === "4h" ? 4 : interval === "1w" ? 7 : 1;
  const requested = Math.min(300, Math.max(2, limit * multiplier + multiplier));
  const end = new Date();
  const start = new Date(end.getTime() - requested * granularity * 1000);
  const url = BASE+"?granularity="+granularity+"&start="+encodeURIComponent(start.toISOString())+"&end="+encodeURIComponent(end.toISOString());
  const res=await fetch(url,{headers:{"User-Agent":"BTC-Radar/1.0","Accept":"application/json"}});
  if(!res.ok) throw new Error("Coinbase OHLCV error: "+res.status+" "+res.statusText);
  const json=await res.json() as Row[];
  if(!Array.isArray(json) || !json.length) throw new Error("Coinbase OHLCV payload ausente");
  let rows=json.sort((a,b)=>a[0]-b[0]).map(k=>({
    // F11: k[0] = tempo INICIAL (abertura) do bucket. timestamp = abertura, como nos demais providers.
    timestamp:new Date(k[0]*1000).toISOString(), low:Number(k[1]), high:Number(k[2]),
    open:Number(k[3]), close:Number(k[4]), volume:Number(k[5]), interval:baseInterval as "1h"|"1d", source:"Coinbase",
  }));
  if(interval==="4h") rows=aggregate(rows,"4h",4*3600_000) as any;
  if(interval==="1w") rows=aggregate(rows,"1w",7*86400_000) as any;
  return (rows as OHLCV[]).slice(-Math.max(1,limit));
}
