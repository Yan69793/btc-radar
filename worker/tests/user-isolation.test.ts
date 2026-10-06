import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { alertRoutes } from "../src/routes/alerts";
import { portfolioRoutes } from "../src/routes/portfolio";
import type { Env } from "../src/types";

const A = "a".repeat(64);
const B = "b".repeat(64);

type AlertRow = { id:number; user_id:number; created_at:string; type:string; condition:string; triggered_at:string|null; acknowledged:number; payload:string|null };
type SnapRow = { id:number; user_id:number; timestamp:string; btc_balance:number; usd_balance:number; btc_price:number; total_value_usd:number };

function makeEnv(): Env {
  const sessions: Record<string,string> = {
    [`session:${A}`]: JSON.stringify({ user_id: 1, name: "A", email: "a@example.com" }),
    [`session:${B}`]: JSON.stringify({ user_id: 2, name: "B", email: "b@example.com" }),
  };
  const alerts: AlertRow[] = [
    { id:1,user_id:1,created_at:"2026-10-01T00:00:00Z",type:"price",condition:"price_above_1",triggered_at:null,acknowledged:0,payload:null },
    { id:2,user_id:2,created_at:"2026-10-01T00:00:00Z",type:"price",condition:"price_above_2",triggered_at:null,acknowledged:0,payload:null },
  ];
  const snaps: SnapRow[] = [
    { id:1,user_id:1,timestamp:"2026-10-01T00:00:00Z",btc_balance:1,usd_balance:10,btc_price:1,total_value_usd:11 },
    { id:2,user_id:2,timestamp:"2026-10-01T00:00:00Z",btc_balance:2,usd_balance:20,btc_price:1,total_value_usd:22 },
  ];

  const DB = {
    prepare(sql:string) {
      let params:any[] = [];
      const stmt:any = {
        bind(...xs:any[]) { params = xs; return stmt; },
        async all() {
          if (sql.includes("FROM alerts")) return { results: alerts.filter(x => x.user_id === Number(params[0])) };
          if (sql.includes("FROM portfolio_snapshots")) return { results: snaps.filter(x => x.user_id === Number(params[0])) };
          return { results: [] };
        },
        async first() {
          if (sql.includes("FROM alerts")) return alerts.find(x => x.id === Number(params[0]) && x.user_id === Number(params[1])) ?? null;
          return null;
        },
        async run() {
          if (sql.startsWith("UPDATE alerts")) {
            const row = alerts.find(x => x.id === Number(params[1]) && x.user_id === Number(params[2]));
            if (row) row.acknowledged = Number(params[0]);
          }
          if (sql.startsWith("DELETE FROM alerts")) {
            const i = alerts.findIndex(x => x.id === Number(params[0]) && x.user_id === Number(params[1]));
            if (i >= 0) alerts.splice(i, 1);
          }
          return { meta: { last_row_id: 0 } };
        },
      };
      return stmt;
    },
  };

  return {
    KV: { get: async (key:string) => sessions[key] ?? null },
    DB,
  } as unknown as Env;
}

function auth(token:string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.route("/api/alerts", alertRoutes);
  a.route("/api/portfolio", portfolioRoutes);
  return a;
}
describe("isolamento por usuario", () => {
  it("A ve apenas alertas de A e B ve apenas alertas de B", async () => {
    const env = makeEnv(); const a = app();
    const ra = await a.request("/api/alerts", auth(A), env);
    const rb = await a.request("/api/alerts", auth(B), env);
    const ja:any = await ra.json(); const jb:any = await rb.json();
    expect(ja.data.map((x:any) => x.id)).toEqual([1]);
    expect(jb.data.map((x:any) => x.id)).toEqual([2]);
  });

  it("A nao consegue alterar alerta de B", async () => {
    const env = makeEnv(); const a = app();
    const r = await a.request("/api/alerts/2", {
      method:"PUT", ...auth(A),
      headers:{ ...auth(A).headers, "Content-Type":"application/json" },
      body:JSON.stringify({ acknowledged:true }),
    }, env);
    expect(r.status).toBe(404);
  });

  it("A nao consegue excluir alerta de B", async () => {
    const env = makeEnv(); const a = app();
    const r = await a.request("/api/alerts/2", { method:"DELETE", ...auth(A) }, env);
    expect(r.status).toBe(404);
  });
  it("historico de portfolio e segregado por sessao", async () => {
    const env = makeEnv(); const a = app();
    const ra = await a.request("/api/portfolio/history?limit=30", auth(A), env);
    const rb = await a.request("/api/portfolio/history?limit=30", auth(B), env);
    const ja:any = await ra.json(); const jb:any = await rb.json();
    expect(ja.data.map((x:any) => x.usd_balance)).toEqual([10]);
    expect(jb.data.map((x:any) => x.usd_balance)).toEqual([20]);
  });

  it("rotas privadas recusam leitura sem sessao", async () => {
    const env = makeEnv(); const a = app();
    expect((await a.request("/api/alerts", {}, env)).status).toBe(401);
    expect((await a.request("/api/portfolio/history", {}, env)).status).toBe(401);
  });
});
