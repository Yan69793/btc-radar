// BTC Radar — Guarda de escrita da API
// Leitura e publica (o demo mostra preco, sinais e on-chain a qualquer um).
// Escrita exige sessao do dono. O guard e centralizado e nega por padrao:
// rota nova que mute estado ja nasce protegida sem ninguem lembrar disso.

import type { MiddlewareHandler } from "hono";
import type { Env } from "../types";
import { bearerToken, getSession, isAdminEmail } from "./auth";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Escrita legitimamente aberta ao publico. Cada entrada precisa de motivo:
//   auth/register, auth/login  — quem ainda nao tem sessao precisa criar uma
//   auth/logout                — encerrar a propria sessao nao muda dado de negocio
//   whatsapp/webhook           — chamada da Meta, autenticada por HMAC no proprio handler
const PUBLIC_WRITES = new Set([
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/whatsapp/webhook",
]);

function deny(status: 401 | 403, error: string) {
  return Response.json(
    { success: false, data: null, error, timestamp: new Date().toISOString() },
    { status }
  );
}

export const writeGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const path = new URL(c.req.url).pathname.replace(/\/+$/, "") || "/";
  if (PUBLIC_WRITES.has(path)) return next();

  const session = await getSession(c.env, bearerToken(c.req.header("Authorization")));
  // Sem sessao valida e sessao sem permissao sao casos diferentes: 401 derruba
  // o login no frontend, 403 apenas recusa a acao e mantem o visitante logado.
  if (!session) return deny(401, "Faca login para executar esta acao.");
  if (!isAdminEmail(c.env, session.email)) {
    return deny(403, "Somente o responsavel pelo BTC Radar pode alterar dados.");
  }

  return next();
};
