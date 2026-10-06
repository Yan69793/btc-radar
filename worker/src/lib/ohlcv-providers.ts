import type { OHLCV } from "../types";
import { fetchCoinbaseOHLCV } from "./coinbase";
import { fetchBinanceOHLCV } from "./binance";
import { fetchKrakenOHLCV } from "./kraken";
import { fetchOKXOHLCV } from "./okx";

export type OhlcvProvider = "Coinbase"|"Binance"|"Kraken"|"OKX";
export async function fetchOHLCVWithFallback(interval:"1h"|"4h"|"1d"|"1w",limit=200):Promise<OHLCV[]>{
  const providers:[OhlcvProvider,(i:any,l:number)=>Promise<OHLCV[]>][]=[
    ["Binance",fetchBinanceOHLCV],["Coinbase",fetchCoinbaseOHLCV],["Kraken",fetchKrakenOHLCV],["OKX",fetchOKXOHLCV],
  ];
  const errors:string[]=[];
  for(const [name,fn] of providers){
    try { const rows=await fn(interval,limit); if(rows.length) return rows; errors.push(name+": empty"); }
    catch(e){ errors.push(name+": "+(e instanceof Error?e.message:String(e))); }
  }
  throw new Error("OHLCV providers exhausted: "+errors.join(" | "));
}

export async function crossCheckOHLCV(interval:"1h"|"4h"|"1d"|"1w"):Promise<{ok:boolean;divergence_pct:number|null;coinbase:number|null;binance:number|null}>{
  try{
    const [a,b]=await Promise.all([fetchCoinbaseOHLCV(interval,2),fetchBinanceOHLCV(interval,2)]);
    const ac=a[a.length-2]?.close ?? a[a.length-1]?.close;
    const bc=b[b.length-2]?.close ?? b[b.length-1]?.close;
    if(!ac||!bc) return {ok:false,divergence_pct:null,coinbase:ac??null,binance:bc??null};
    const d=Math.abs(ac-bc)/((ac+bc)/2)*100;
    return {ok:d<=0.75,divergence_pct:Number(d.toFixed(4)),coinbase:ac,binance:bc};
  }catch{return {ok:false,divergence_pct:null,coinbase:null,binance:null};}
}

