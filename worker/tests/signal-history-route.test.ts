// Aureus — Guarda de regressão de roteamento (P2-5).
//
// `src/index.ts` registra `app.route("/api/signals", signalRoutes)` (com
// `GET /:strategy`) ANTES de `app.route("/api/signals/history", signalHistoryRoutes)`
// (com `GET /`). As duas casam o caminho `/api/signals/history`. Este teste prova,
// com o app Hono REAL, que a rota estática de histórico vence o parâmetro
// `:strategy` e que o shape devolvido é o do histórico (ok:true), não o da
// estratégia (success:true). Se algum dia o roteador passar a sombrear, o teste
// quebra e a ordem de registro deve ser invertida.

import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Env } from "../src/types";
import { HISTORY_STRATEGY_VERSION } from "../src/lib/signal-history";

// Env mínimo: DB falso que responde às queries de histórico com arrays vazios.
// Não toca rede nem KV real.
function makeEnv(): Env {
  const DB = {
    prepare(_sql: string) {
      const stmt: any = {
        bind: (..._a: unknown[]) => stmt,
        async all() {
          return { success: true, results: [] as unknown[] };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true, meta: { rows_written: 0 } };
        },
      };
      return stmt;
    },
  };
  return { DB, CORS_ORIGINS: "" } as unknown as Env;
}

describe("roteamento /api/signals/history", () => {
  it("GET /api/signals/history cai na rota de histórico, não em /:strategy", async () => {
    const res = await app.fetch(new Request("http://localhost/api/signals/history"), makeEnv());
    expect(res.status).toBe(200);
    const body: any = await res.json();
    // Shape da rota de histórico (signal-history.ts).
    expect(body.ok).toBe(true);
    expect(body.history_strategy_version).toBe(HISTORY_STRATEGY_VERSION);
    expect(Array.isArray(body.data)).toBe(true);
    // Shape da rota de estratégia (signals.ts) — NÃO deve aparecer aqui.
    expect(body.success).toBeUndefined();
  });

  it("GET /api/signals/history/summary também cai no histórico (shape com methodology)", async () => {
    const res = await app.fetch(new Request("http://localhost/api/signals/history/summary"), makeEnv());
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.methodology).toBeDefined();
    expect(body.success).toBeUndefined();
  });
});
