// Aureus — Testes unitários do resolvedor prospectivo
// Cobrem regras: 4 (candle ambíguo / stop primeiro), 5 (t1 50% + t2 50%,
//   depois stop), 6 (short simétrico), 8 (buildSignalId idempotente),
//   11 (vencimento, gap de dados), idempotência de versão, entrada prospectiva (look-ahead).

import { describe, expect, it } from "vitest";
import type { OHLCV, Timeframe } from "../src/types";
import {
  buildSignalId,
  computeExpiresAt,
  computeReturnPct,
  resolveProspectively,
  verdictToDirection,
  TIMEFRAME_EXPIRATION_HOURS,
} from "../src/lib/signal-history";

function hourlySeries(baseTs: string, n: number, startPrice = 100, step = 1, wiggle = 0): OHLCV[] {
  const out: OHLCV[] = [];
  const t0 = new Date(baseTs).getTime();
  for (let i = 0; i < n; i++) {
    const ts = t0 + i * 3600_000;
    const close = startPrice + i * step + (i % 2 ? wiggle : -wiggle);
    out.push({
      timestamp: new Date(ts).toISOString(),
      open: close - wiggle,
      high: close + Math.abs(wiggle) + Math.abs(step * 0.2),
      low: close - Math.abs(wiggle) - Math.abs(step * 0.2),
      close,
      volume: 10,
      interval: "1h",
      source: "test",
    });
  }
  return out;
}

describe("signal-history: helpers puros", () => {
  it("verdictToDirection mapeia COMPRAR=long / VENDER e REDUZIR=short / AGUARDAR=flat", () => {
    expect(verdictToDirection("COMPRAR")).toBe("long");
    expect(verdictToDirection("VENDER")).toBe("short");
    expect(verdictToDirection("REDUZIR")).toBe("short");
    expect(verdictToDirection("AGUARDAR")).toBe("flat");
  });

  it("computeExpiresAt respeita 72h / 720h / 4320h para short/medium/long", () => {
    const now = "2026-01-01T00:00:00.000Z";
    for (const tf of ["short", "medium", "long"] as Timeframe[]) {
      const exp = new Date(computeExpiresAt(now, tf)).getTime() - new Date(now).getTime();
      expect(exp / 3600_000).toBe(TIMEFRAME_EXPIRATION_HOURS[tf]);
    }
  });

  it("computeReturnPct long retorna (exit/entry-1)%, short retorna (1-exit/entry)% e desconta custos bilaterais", () => {
    // long +10%
    const long = computeReturnPct({ direction: "long", entryPrice: 100, exitPrice: 110, feePerSide: 0, slippagePct: 0 });
    expect(long.gross_pct).toBeCloseTo(10, 3);
    // short -10% no preço → lucra 10%
    const sh = computeReturnPct({ direction: "short", entryPrice: 100, exitPrice: 90, feePerSide: 0, slippagePct: 0 });
    expect(sh.gross_pct).toBeCloseTo(10, 3);
    // custos bilaterais: 0.1% de 100 em entrada e 0.1% em saída = 0.2% total
    const costs = computeReturnPct({ direction: "long", entryPrice: 100, exitPrice: 100, feePerSide: 0.001, slippagePct: 0 });
    expect(costs.net_pct).toBeCloseTo(-0.2, 3);
  });

  it("buildSignalId é estável (idempotente) com mesma entrada", () => {
    const id1 = buildSignalId({ strategy: "trend_following", timeframe: "short", direction: "long", generatedAt: "2026-01-01T12:34:56.000Z", strategyVersion: "1.0.0" });
    const id2 = buildSignalId({ strategy: "trend_following", timeframe: "short", direction: "long", generatedAt: "2026-01-01T12:34:56.000Z", strategyVersion: "1.0.0" });
    expect(id1).toBe(id2);
    // horário diferente muda
    const id3 = buildSignalId({ strategy: "trend_following", timeframe: "short", direction: "long", generatedAt: "2026-01-01T12:35:00.000Z", strategyVersion: "1.0.0" });
    expect(id3).not.toBe(id1);
    // versão diferente muda (mudança de versão cria oportunidade nova)
    const id4 = buildSignalId({ strategy: "trend_following", timeframe: "short", direction: "long", generatedAt: "2026-01-01T12:34:56.000Z", strategyVersion: "2.0.0" });
    expect(id4).not.toBe(id1);
    expect(id1).toMatch(/^sig-trend_following-short-long-202601011234-1\.0\.0$/);
  });
});

describe("signal-history: resolveProspectively (regras de resolução)", () => {
  const baseTs = "2026-02-01T00:00:00.000Z";

  it("regra 10: entrada no primeiro candle FECHADO após generated_at (não look-ahead)", () => {
    const genAt = "2026-02-01T09:30:00.000Z";
    // candles 24h starting 00:00 de 1/fev → hour 9:30 está entre candle 9 e 10
    const s = hourlySeries(baseTs, 30, 100, 1);
    // entry_price nominal = 100 (é sobrescrito pelo close do primeiro candle após genAt)
    const r = resolveProspectively({
      signal: {
        signal_id: "sig1", direction: "long", entry_price: 100,
        stop_loss: 90, target_1: 120, target_2: 140,
        generated_at: genAt, expires_at: computeExpiresAt(genAt, "short"),
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: s,
    });
    expect(r.entry_candle).not.toBeNull();
    // timestamp é abertura. Candle09 fecha às10, primeiro close após09:30.
    expect(r.entry_candle!.close).toBeCloseTo(109);
    expect(r.entry_candle!.timestamp).toBe("2026-02-01T09:00:00.000Z");
  });

  it("long direto no target_2: 2 outcomes 50% cada, ambos lucram", () => {
    const genAt = baseTs;
    const s = hourlySeries(baseTs, 80, 100, 2); // crescente +2/h → close=100,102,104,...
    const exp = computeExpiresAt(genAt, "short");
    const r = resolveProspectively({
      signal: {
        signal_id: "sig2", direction: "long", entry_price: 100,
        stop_loss: 80, target_1: 110, target_2: 120,
        generated_at: genAt, expires_at: exp,
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: s,
      feePerSide: 0,
      slippagePct: 0,
    });
    // t1 atinge ~5h depois (close 110), t2 atinge ~10h depois
    const byStatus: Record<string, any[]> = {};
    for (const o of r.outcomes) byStatus[o.status] = byStatus[o.status] ?? [];
    for (const o of r.outcomes) byStatus[o.status].push(o);
    expect(byStatus.target_1?.length).toBe(1);
    expect(byStatus.target_2?.length).toBe(1);
    expect(byStatus.target_1![0].position_fraction).toBeCloseTo(0.5);
    expect(byStatus.target_2![0].position_fraction).toBeCloseTo(0.5);
    expect(r.closed_fraction).toBeCloseTo(1);
  });

  it("regra 5: target_1 (50%) e depois stop — cálculo ponderado correto", () => {
    // Série: close progressiva que atinge target_1 (entry+10% no candle 2, depois vai até stop entry-10%.
    // Usamos generated_at NO candle 0 (2026-02-01T00:00 com close=100. O entry de verdade
    // é o close do primeiro candle APÓS generated_at (candle 1, hora 1, close=105 já estava
    // no close do candle 1. Para controle, ajustamos a série para que a entrada real seja
    // exatamente 100 (candle1 close=100), depois target_1 a 110 (10% a mais) e depois
    // stop a 90 (10% a menos).
    const genAt = baseTs;
    // hora -1: sinal gerado ANTES do primeiro candle.
    const prices: number[] = [];
    prices.push(100);                 // candle 0 (hora 0) close = 100 → será o entry real).
    // subida até 110 em 5 candles
    for (let i = 1; i <= 4; i++) prices.push(100 + i * 2.5);
    // a partir daí, desce: 110, 108, 106, ..., 90 (20 candles depois)
    for (let i = 5; i < 25; i++) prices.push(110 - (i - 5) * 1);
    for (let i = 25; i < 100; i++) prices.push(90 - 1);
    const s = prices.map((p, i) => ({
      timestamp: new Date(new Date(baseTs).getTime() + i * 3600_000).toISOString(),
      open: p, high: p + 0.6, low: p - 0.6, close: p, volume: 10, interval: "1h" as const, source: "test",
    }));
    const r = resolveProspectively({
      signal: {
        signal_id: "sig3", direction: "long", entry_price: 100,
        stop_loss: 90, target_1: 110, target_2: 140,
        generated_at: genAt, expires_at: computeExpiresAt(genAt, "short"),
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: s,
      feePerSide: 0,
      slippagePct: 0,
    });
    const byStatus: Record<string, any[]> = {};
    for (const o of r.outcomes) (byStatus[o.status] ||= []).push(o);
    expect(byStatus.target_1).toBeDefined();
    expect(byStatus.stop_loss).toBeDefined();
    // O candle do stop abre em 89, abaixo do stop teórico de 90: é um gap-through.
    // A regra conservadora preenche na abertura (89), não no nível do stop (90). O stop
    // rende então -11% e o resultado ponderado é +10%×0.5 + (-11%)×0.5 = -0.5.
    expect(byStatus.stop_loss![0].resolved_price).toBeCloseTo(89, 10);
    const weighted =
      byStatus.target_1![0].net_return_pct * byStatus.target_1![0].position_fraction +
      byStatus.stop_loss![0].net_return_pct * byStatus.stop_loss![0].position_fraction;
    expect(weighted).toBeCloseTo(-0.5, 10);
  });

  it("regra 4: candle ambíguo (stop e target no mesmo candle) → resolve só stop primeiro", () => {
    const genAt = baseTs;
    // série: até t=2 cresce; t=3: um candle com HIGH=120 (acima de target_1=115) e LOW=88 (abaixo de stop=90)
    const s = hourlySeries(baseTs, 20, 100, 1).map((c, i) => i === 3 ? { ...c, high: 120, low: 88 } : c);
    const r = resolveProspectively({
      signal: {
        signal_id: "sig4", direction: "long", entry_price: 100,
        stop_loss: 90, target_1: 115, target_2: 130,
        generated_at: genAt, expires_at: computeExpiresAt(genAt, "short"),
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: s,
      feePerSide: 0,
      slippagePct: 0,
    });
    expect(r.closed_fraction).toBeCloseTo(1);
    const stop = r.outcomes.find(o => o.status === "stop_loss");
    expect(stop).toBeDefined();
    expect(stop!.ambiguous_resolution).toBe(1);
    expect(stop!.ambiguous_triggers).toContain("stop");
    expect(stop!.ambiguous_triggers).toContain("t1");
    // só stop, nenhum target
    expect(r.outcomes.every(o => o.status === "stop_loss" || (o as any)._test)).toBe(true);
    expect(r.outcomes.length).toBe(1);
  });

  it("regra 6 (short simétrico): short lucra quando preço cai; stop atinge HIGH acima", () => {
    const genAt = baseTs;
    // queda de 100 → 85 em 20h, depois volta
    const s = hourlySeries(baseTs, 100, 100, -1);
    const r = resolveProspectively({
      signal: {
        signal_id: "sig5", direction: "short", entry_price: 100,
        stop_loss: 105, target_1: 90, target_2: 80,
        generated_at: genAt, expires_at: computeExpiresAt(genAt, "short"),
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: s,
      feePerSide: 0,
      slippagePct: 0,
    });
    const byStatus: Record<string, any[]> = {};
    for (const o of r.outcomes) (byStatus[o.status] ||= []).push(o);
    expect(byStatus.target_1?.length).toBe(1);
    expect(byStatus.target_2?.length).toBe(1);
    expect(byStatus.target_1![0].net_return_pct).toBeGreaterThan(0); // 10% lucro no short
  });

  it("regra 11 (vencimento): fecha no close do primeiro candle após expires_at", () => {
    const genAt = baseTs;
    const s = hourlySeries(baseTs, 90, 100, 0.01); // lateral, nunca toca stop nem alvo.
    // expires em 72h (exato 72 candles depois).
    const exp = new Date(new Date(baseTs).getTime() + 72 * 3600_000).toISOString();
    const r = resolveProspectively({
      signal: {
        signal_id: "sig6", direction: "long", entry_price: 100,
        stop_loss: 80, target_1: 130, target_2: 150,
        generated_at: genAt, expires_at: exp,
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: s,
    });
    expect(r.closed_fraction).toBeCloseTo(1);
    const expired = r.outcomes.find(o => o.status === "expired");
    expect(expired).toBeDefined();
    expect(expired!.position_fraction).toBeCloseTo(1);
    // resolved_ts = candle 73 (≥72h).
    const resolvedTs = new Date(expired!.resolved_at).getTime();
    const expTs = new Date(exp).getTime();
    expect(resolvedTs).toBeGreaterThanOrEqual(expTs);
    // diferença máxima 1h (próximo candle)
    expect(resolvedTs - expTs).toBeLessThanOrEqual(3600_000 + 1);
  });

  it("gap / dados insuficientes (nenhum candle após sinal): status data_gap, 0 como preço resolvedor não inventa preço", () => {
    const genAt = "2026-03-01T00:00:00.000Z";
    const s = hourlySeries("2026-02-01T00:00:00.000Z", 10, 100); // todos anteriores.
    const r = resolveProspectively({
      signal: {
        signal_id: "sig7", direction: "long", entry_price: 100,
        stop_loss: 90, target_1: 110, target_2: 120,
        generated_at: genAt, expires_at: computeExpiresAt(genAt, "short"),
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: s,
    });
    expect(r.has_gap).toBe(true);
    expect(r.outcomes.length).toBe(1);
    expect(r.outcomes[0].status).toBe("data_gap");
    expect(r.outcomes[0].gross_return_pct).toBeNull();
    expect(r.outcomes[0].net_return_pct).toBeNull();
  });

  it("oportunidade sinal flat / sem entry_price não cria resolução", () => {
    const r = resolveProspectively({
      signal: {
        signal_id: "sig8", direction: "flat", entry_price: 100,
        stop_loss: 90, target_1: 110, target_2: 120,
        generated_at: baseTs, expires_at: computeExpiresAt(baseTs, "short"),
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: hourlySeries(baseTs, 100, 100, 1),
    });
    expect(r.outcomes.length).toBe(0);
    expect(r.closed_fraction).toBe(0);
    expect(r.notes.some(n => n.includes("não é oportunidade"))).toBe(true);
  });

  it("sinais simultâneos (2 estratégias independentes) resolvem separadamente, sem colisão", () => {
    const genAt = baseTs;
    const s = hourlySeries(baseTs, 80, 100, 2);
    const signalA = {
      signal_id: "sig-stratA", strategy: "A", timeframe: "short" as Timeframe, direction: "long" as const,
      entry_price: 100, stop_loss: 80, target_1: 110, target_2: 120,
      generated_at: genAt, expires_at: computeExpiresAt(genAt, "short"),
      strategy_version: "1", engine_version: "1",
    };
    const signalB = { ...signalA, signal_id: "sig-stratB", strategy: "B", stop_loss: 110, target_1: 120, target_2: 140 };
    const rA = resolveProspectively({ signal: signalA, series: s });
    const rB = resolveProspectively({ signal: signalB, series: s });
    // A fecha tudo (cresce bastante), B fecha também.
    expect(rA.closed_fraction).toBe(1);
    expect(rB.closed_fraction).toBe(1);
    expect(rA.outcomes.every(o => o.signal_id === "sig-stratA")).toBe(true);
    expect(rB.outcomes.every(o => o.signal_id === "sig-stratB")).toBe(true);
  });

  it("mudança de versão em estratégia cria oportunidade distinta (não sofre conflito)", () => {
    const genAt = baseTs;
    const oldSig = buildSignalId({ strategy: "s", timeframe: "long", direction: "long", generatedAt: genAt, strategyVersion: "1.0.0" });
    const newSig = buildSignalId({ strategy: "s", timeframe: "long", direction: "long", generatedAt: genAt, strategyVersion: "1.1.0" });
    expect(oldSig).not.toBe(newSig);
  });

  it("P0: vencido sem s?rie at? expires_at terminaliza restante como data_gap", () => {
    const genAt = "2026-03-01T00:00:00.000Z";
    const exp = computeExpiresAt(genAt, "short");
    const series = hourlySeries(genAt, 12, 100, 0.1);
    const r = resolveProspectively({
      signal: { signal_id: "sig-expired-gap", direction: "long", entry_price: 100, stop_loss: 50, target_1: 200, target_2: 300, generated_at: genAt, expires_at: exp, strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1" },
      series, feePerSide: 0, slippagePct: 0,
    });
    const gap = r.outcomes.find(o => o.status === "data_gap");
    expect(gap).toBeDefined();
    expect(gap!.position_fraction).toBeCloseTo(1);
    expect(gap!.resolved_at).toBe(exp);
    expect(r.closed_fraction).toBeCloseTo(1);
    expect(r.has_gap).toBe(true);
  });

  it("F01: stop e alvo que abrem além do nível executam no preço de abertura (gap-through)", () => {
    const genAt = baseTs;
    const mk = (i: number, o: number, h: number, l: number, c: number): OHLCV => ({
      timestamp: new Date(new Date(baseTs).getTime() + i * 3600_000).toISOString(),
      open: o, high: h, low: l, close: c, volume: 10, interval: "1h", source: "test",
    });

    // Stop gap-through: o candle 2 abre em 85, abaixo do stop de 90.
    const stopRun = resolveProspectively({
      signal: {
        signal_id: "sig-gap-stop", direction: "long", entry_price: 100,
        stop_loss: 90, target_1: 130, target_2: 140,
        generated_at: genAt, expires_at: computeExpiresAt(genAt, "short"),
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: [mk(0, 100, 100.5, 99.5, 100), mk(1, 98, 99, 97, 98), mk(2, 85, 86, 84, 85)],
      feePerSide: 0, slippagePct: 0,
    });
    const stop = stopRun.outcomes.find(o => o.status === "stop_loss")!;
    expect(stop.resolved_price).toBeCloseTo(85, 10); // abertura, não 90
    expect(stop.net_return_pct).toBeCloseTo(-15, 10); // (85/100-1)*100

    // Alvo gap-through: o candle 2 abre em 120, acima dos dois alvos.
    const targetRun = resolveProspectively({
      signal: {
        signal_id: "sig-gap-target", direction: "long", entry_price: 100,
        stop_loss: 80, target_1: 110, target_2: 115,
        generated_at: genAt, expires_at: computeExpiresAt(genAt, "short"),
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: [mk(0, 100, 100.5, 99.5, 100), mk(1, 100, 100.5, 99.5, 100), mk(2, 120, 125, 118, 120)],
      feePerSide: 0, slippagePct: 0,
    });
    const targets = targetRun.outcomes.filter(o => o.status === "target_1" || o.status === "target_2");
    expect(targets).toHaveLength(2);
    for (const o of targets) expect(o.resolved_price).toBeCloseTo(118, 10); // low=118 > alvo teórico
    expect(targetRun.closed_fraction).toBeCloseTo(1);
  });

  it("F06: candle ausente no meio da série vira data_gap sem inventar preço", () => {
    const genAt = baseTs;
    const mk = (i: number): OHLCV => ({
      timestamp: new Date(new Date(baseTs).getTime() + i * 3600_000).toISOString(),
      open: 100, high: 100.5, low: 99.5, close: 100, volume: 10, interval: "1h", source: "test",
    });
    // Falta o candle da hora +2 (buraco interno na série).
    const r = resolveProspectively({
      signal: {
        signal_id: "sig-gap-internal", direction: "long", entry_price: 100,
        stop_loss: 80, target_1: 130, target_2: 150,
        generated_at: genAt, expires_at: computeExpiresAt(genAt, "short"),
        strategy: "x", timeframe: "short", strategy_version: "1", engine_version: "1",
      },
      series: [mk(0), mk(1), mk(3)],
      feePerSide: 0, slippagePct: 0,
    });
    expect(r.has_gap).toBe(true);
    expect(r.notes.some(n => n.includes("candle ausente"))).toBe(true);
    const gap = r.outcomes.find(o => o.status === "data_gap")!;
    expect(gap).toBeDefined();
    expect(gap.resolved_price).toBe(0);
    expect(gap.net_return_pct).toBeNull();
    expect(gap.position_fraction).toBeCloseTo(1);
    expect(r.closed_fraction).toBeCloseTo(1);
  });

});
