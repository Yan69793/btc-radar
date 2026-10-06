// BTC Radar — Testes da guarda de escrita
// O caso critico e o cliente do demo: ele tem sessao valida (qualquer um pode
// se cadastrar), entao sessao sozinha nao autoriza escrita.

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { writeGuard } from "../src/lib/write-guard";
import type { Env } from "../src/types";

const DONO_TOKEN = "a".repeat(64);
const CLIENTE_TOKEN = "b".repeat(64);

function makeEnv(): Env {
  const sessions: Record<string, string> = {
    [`session:${DONO_TOKEN}`]: JSON.stringify({ user_id: 1, name: "Dono", email: "Dono@Example.com" }),
    [`session:${CLIENTE_TOKEN}`]: JSON.stringify({ user_id: 2, name: "Cliente", email: "cliente@example.com" }),
  };
  return {
    ADMIN_EMAILS: "dono@example.com",
    KV: { get: async (key: string) => sessions[key] ?? null },
  } as unknown as Env;
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/api/*", writeGuard);
  app.get("/api/price", (c) => c.json({ ok: true }));
  app.post("/api/auth/login", (c) => c.json({ ok: true }));
  app.post("/api/whatsapp/webhook", (c) => c.json({ ok: true }));
  app.delete("/api/trades/:id", (c) => c.json({ ok: true }));
  app.post("/api/portfolio/snapshot", (c) => c.json({ ok: true }));
  return app;
}

function auth(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

describe("writeGuard", () => {
  const app = makeApp();
  const env = makeEnv();

  it("deixa leitura passar sem sessao", async () => {
    const res = await app.request("/api/price", {}, env);
    expect(res.status).toBe(200);
  });

  it("deixa passar as escritas publicas declaradas", async () => {
    expect((await app.request("/api/auth/login", { method: "POST" }, env)).status).toBe(200);
    expect((await app.request("/api/whatsapp/webhook", { method: "POST" }, env)).status).toBe(200);
  });

  it("bloqueia escrita sem sessao com 401", async () => {
    const res = await app.request("/api/trades/7", { method: "DELETE" }, env);
    expect(res.status).toBe(401);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });

  it("bloqueia escrita de cliente autenticado com 403", async () => {
    // Sessao valida, mas fora do ADMIN_EMAILS. 403 e nao 401 para o painel
    // recusar a acao sem deslogar o visitante.
    const res = await app.request("/api/trades/7", { method: "DELETE", ...auth(CLIENTE_TOKEN) }, env);
    expect(res.status).toBe(403);
  });

  it("bloqueia token forjado com 401", async () => {
    const res = await app.request("/api/trades/7", { method: "DELETE", ...auth("f".repeat(64)) }, env);
    expect(res.status).toBe(401);
  });

  it("libera escrita do dono, comparando email sem diferenciar maiuscula", async () => {
    const res = await app.request("/api/trades/7", { method: "DELETE", ...auth(DONO_TOKEN) }, env);
    expect(res.status).toBe(200);
  });

  it("protege rota de escrita nova sem precisar declara-la (nega por padrao)", async () => {
    const res = await app.request("/api/portfolio/snapshot", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });

  it("nao aceita barra final como desvio da guarda", async () => {
    const res = await app.request("/api/trades/7/", { method: "DELETE" }, env);
    expect(res.status).toBe(401);
  });
});
