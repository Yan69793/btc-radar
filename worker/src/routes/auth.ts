// BTC Radar — Rotas de autenticacao do demo comercial
// POST /api/auth/register — cadastro (nome, email, senha), ja loga
// POST /api/auth/login    — login por email e senha
// GET  /api/auth/me       — dados da sessao (Bearer token)
// POST /api/auth/logout   — encerra a sessao

import { Hono } from "hono";
import type { Env } from "../types";
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  deleteSession,
  bearerToken,
  rateLimitOk,
} from "../lib/auth";

export const authRoutes = new Hono<{ Bindings: Env }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RL_MAX = 20;
const RL_WINDOW_S = 600;

function clientIp(headers: Headers): string {
  return headers.get("CF-Connecting-IP") ?? "unknown";
}

function fail(status: 400 | 401 | 409 | 429 | 500, error: string) {
  return {
    body: { success: false, data: null, error, timestamp: new Date().toISOString() },
    status,
  };
}

// ─── POST /api/auth/register ───

authRoutes.post("/register", async (c) => {
  try {
    if (!(await rateLimitOk(c.env, `auth:${clientIp(c.req.raw.headers)}`, RL_MAX, RL_WINDOW_S))) {
      const f = fail(429, "Muitas tentativas. Aguarde alguns minutos.");
      return c.json(f.body, f.status);
    }

    const body = await c.req.json<{ name?: string; email?: string; password?: string }>().catch(() => null);
    const name = body?.name?.trim() ?? "";
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";

    if (name.length < 2 || name.length > 120) {
      const f = fail(400, "Informe seu nome completo.");
      return c.json(f.body, f.status);
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      const f = fail(400, "Email invalido.");
      return c.json(f.body, f.status);
    }
    if (password.length < 8 || password.length > 128) {
      const f = fail(400, "A senha precisa ter pelo menos 8 caracteres.");
      return c.json(f.body, f.status);
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);

    let userId: number;
    try {
      const result = await c.env.DB.prepare(
        `INSERT INTO users (name, email, password_hash, created_at, last_login_at, login_count)
         VALUES (?, ?, ?, ?, ?, 1)`
      )
        .bind(name, email, passwordHash, now, now)
        .run();
      userId = Number(result.meta?.last_row_id ?? 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("UNIQUE")) {
        const f = fail(409, "Este email ja esta cadastrado. Use a aba Entrar.");
        return c.json(f.body, f.status);
      }
      throw err;
    }

    const token = await createSession(c.env, { user_id: userId, name, email });
    return c.json({
      success: true,
      data: { token, user: { name, email } },
      timestamp: new Date().toISOString(),
    }, 201);
  } catch (err) {
    console.error(`[auth] register: ${err instanceof Error ? err.message : err}`);
    const f = fail(500, "Erro ao cadastrar. Tente novamente.");
    return c.json(f.body, f.status);
  }
});

// ─── POST /api/auth/login ───

authRoutes.post("/login", async (c) => {
  try {
    if (!(await rateLimitOk(c.env, `auth:${clientIp(c.req.raw.headers)}`, RL_MAX, RL_WINDOW_S))) {
      const f = fail(429, "Muitas tentativas. Aguarde alguns minutos.");
      return c.json(f.body, f.status);
    }

    const body = await c.req.json<{ email?: string; password?: string }>().catch(() => null);
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";

    if (!EMAIL_RE.test(email) || password.length === 0) {
      const f = fail(400, "Informe email e senha.");
      return c.json(f.body, f.status);
    }

    const user = await c.env.DB.prepare(
      "SELECT id, name, email, password_hash FROM users WHERE email = ?"
    )
      .bind(email)
      .first<{ id: number; name: string; email: string; password_hash: string }>();

    // Mensagem generica: nao revelar se o email existe
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      const f = fail(401, "Email ou senha incorretos.");
      return c.json(f.body, f.status);
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      "UPDATE users SET last_login_at = ?, login_count = login_count + 1 WHERE id = ?"
    )
      .bind(now, user.id)
      .run();

    const token = await createSession(c.env, { user_id: user.id, name: user.name, email: user.email });
    return c.json({
      success: true,
      data: { token, user: { name: user.name, email: user.email } },
      timestamp: now,
    });
  } catch (err) {
    console.error(`[auth] login: ${err instanceof Error ? err.message : err}`);
    const f = fail(500, "Erro ao entrar. Tente novamente.");
    return c.json(f.body, f.status);
  }
});

// ─── GET /api/auth/me ───

authRoutes.get("/me", async (c) => {
  const token = bearerToken(c.req.header("Authorization"));
  const session = await getSession(c.env, token);
  if (!session) {
    const f = fail(401, "Sessao invalida ou expirada.");
    return c.json(f.body, f.status);
  }
  return c.json({
    success: true,
    data: { name: session.name, email: session.email },
    timestamp: new Date().toISOString(),
  });
});

// ─── POST /api/auth/logout ───

authRoutes.post("/logout", async (c) => {
  const token = bearerToken(c.req.header("Authorization"));
  if (token) await deleteSession(c.env, token);
  return c.json({
    success: true,
    data: { logged_out: true },
    timestamp: new Date().toISOString(),
  });
});
