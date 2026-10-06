import { describe, expect, it } from "vitest";
import { computeConsensus } from "../src/lib/consensus";
import { evaluatePortfolioCycle, initialPortfolioState } from "../src/lib/aureus-portfolio";
import type { SignalDocument, Timeframe, Verdict } from "../src/types";
const signal = (tf:Timeframe, verdict:Verdict, conviction=10):SignalDocument => ({
  signal_id:tf+verdict, timeframe:tf, verdict, conviction, entry_price:100, stop_loss:90,
  target_1:110, target_2:120, strategy:"rsi", symbol:"BTC-USD", market_date:"2026-01-01",
  generated_at:"2026-01-01T00:00:00Z", risk_reward:2, payload:{} as SignalDocument["payload"],
});
const all = (v:Verdict,c=10) => (["short","medium","long"] as Timeframe[]).map(tf=>signal(tf,v,c));
describe("F04 REDUZIR como redução de exposição",()=>{
  it("unanimidade REDUZIR produz REDUZIR e vende metade",()=>{
    const consensus=computeConsensus(all("REDUZIR"))!;
    expect(consensus.verdict).toBe("REDUZIR");
    const candle={timestamp:"2026-01-01T00:00:00Z",open:100,high:100,low:100,close:100};
    const bought=evaluatePortfolioCycle(initialPortfolioState(),{timestamp:candle.timestamp,action:"COMPRAR",candle,stopLoss:90});
    const reduced=evaluatePortfolioCycle(bought.state,{timestamp:candle.timestamp,action:consensus.verdict,candle});
    expect(reduced.state.position!.quantity).toBeCloseTo(bought.state.position!.quantity/2,12);
    expect(reduced.snapshot.exposure).toBeLessThan(bought.snapshot.exposure);
  });
  it.each(["COMPRAR","VENDER","AGUARDAR","REDUZIR"] as Verdict[])("mantém a semântica da unanimidade %s",v=>{
    expect(computeConsensus(all(v))!.verdict).toBe(v);
  });
  it("ABSTER/indisponível permanece null, manter permanece AGUARDAR",()=>{
    expect(computeConsensus([])).toBeNull();
    expect(computeConsensus(all("REDUZIR",0))).toBeNull();
    expect(computeConsensus(all("AGUARDAR"))!.verdict).toBe("AGUARDAR");
  });
  it("empate de convicção independe da ordem do array e favorece risco menor",()=>{
    const rows=(["short","medium","long"] as Timeframe[]).flatMap(tf=>[signal(tf,"COMPRAR"),signal(tf,"VENDER"),signal(tf,"REDUZIR")]);
    expect(computeConsensus(rows)!.verdict).toBe("VENDER");
    expect(computeConsensus([...rows].reverse())!.verdict).toBe("VENDER");
  });
  it("adicionar REDUZIR não promove abstinência para COMPRAR",()=>{
    for(let confidence=1;confidence<=10;confidence++){
      const before=[signal("long","COMPRAR",confidence)];
      for(const tf of ["short","medium"] as Timeframe[]){
        const result=computeConsensus([...before,signal(tf,"REDUZIR",10)])!;
        if(computeConsensus(before)!.verdict!=="COMPRAR")expect(result.verdict).not.toBe("COMPRAR");
      }
    }
  });
});
