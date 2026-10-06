import { describe, expect, it, vi } from "vitest";
import { collectProspectiveSignals } from "../src/prospective-signal-generator";
import type { D1Database } from "@cloudflare/workers-types";
import type { OHLCV } from "../src/types";
const now="2026-01-10T00:00:00.000Z";
const intervals={"1h":3600000,"4h":14400000,"1d":86400000};
const bars=(interval:keyof typeof intervals,limit:number):OHLCV[]=>Array.from({length:limit},(_,i)=>({
  timestamp:new Date(Date.parse(now)-(limit-i)*intervals[interval]).toISOString(),
  open:100+i*.1,high:102+i*.1,low:98+i*.1,close:101+i*.1,volume:1,interval,source:"fixture",
}));
describe("F07 horizontes canônicos no gerador prospectivo",()=>{
  it("entrega 1h/4h/1d aos horizontes e persiste sua proveniência",async()=>{
    const load=vi.fn(async(_db:D1Database,interval:"1h"|"4h"|"1d"|"1w",limit:number)=>bars(interval as keyof typeof intervals,limit));
    const result=await collectProspectiveSignals({} as D1Database,null,now,load);
    expect(load.mock.calls.map(c=>[c[1],c[2]])).toEqual([["1h",72],["4h",180],["1d",200]]);
    for(const [tf,interval] of [["short","1h"],["medium","4h"],["long","1d"]]){
      const signals=result.allSignals.filter(s=>s.timeframe===tf);
      expect(signals.length).toBeGreaterThan(0);
      expect(signals.every(s=>s.price_interval===interval)).toBe(true);
    }
    expect(result.portfolioCandle?.interval).toBe("1h");
    expect(result.portfolioCandle?.closedAt).toBe(now);
    expect(result.errors).toEqual([]);
  });
  it("não utiliza candle aberto nem executa sobre preço stale",async()=>{
    const load=vi.fn(async(_db:D1Database,interval:"1h"|"4h"|"1d"|"1w",limit:number)=>{
      const rows=bars(interval as keyof typeof intervals,limit);
      rows.push({...rows[rows.length-1],timestamp:now});
      return rows;
    });
    const result=await collectProspectiveSignals({} as D1Database,null,now,load);
    expect(result.portfolioCandle?.timestamp).not.toBe(now);
    const stale=await collectProspectiveSignals({} as D1Database,null,"2026-02-10T00:00:00Z",load);
    expect(stale.portfolioCandle).toBeNull();
    expect(stale.errors).toHaveLength(3);
  });
});
