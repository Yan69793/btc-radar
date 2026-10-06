import type { OHLCV } from "../types";
const BASE="https://data-api.binance.vision/api/v3/klines";
const MAP:Record<string,string>={"1h":"1h","4h":"4h","1d":"1d","1w":"1w"};
type Row=[number,string,string,string,string,string,number,string,number,string,string,string];

export async function fetchBinanceOHLCV(interval:"1h"|"4h"|"1d"|"1w"="1d",limit=200):Promise<OHLCV[]>{
  const url=BASE+"?symbol=BTCUSDT&interval="+MAP[interval]+"&limit="+Math.min(1000,Math.max(1,limit));
  const res=await fetch(url);
  if(!res.ok) throw new Error("Binance OHLCV error: "+res.status+" "+res.statusText);
  const json=await res.json() as Row[];
  if(!Array.isArray(json)||!json.length) throw new Error("Binance OHLCV payload ausente");
  return json.map(k=>({timestamp:new Date(k[0]).toISOString(),open:Number(k[1]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),volume:Number(k[5]),interval,source:"Binance"}));
}

