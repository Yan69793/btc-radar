// BTC Radar — Autenticacao: hash de senha (PBKDF2/WebCrypto), sessao em KV
// e rate limit simples por IP. Sem dependencia externa; tudo nativo do runtime.

import type { Env } from "../types";

// 100k iteracoes e a referencia da doc da Cloudflare para PBKDF2 em Workers.
const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 dias
const SESSION_PREFIX = "session:";

export interface SessionData {
  user_id: number;
  name: string;
  email: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

// Formato: pbkdf2:<iteracoes>:<salt hex>:<hash hex>
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltHex, hashHex] = stored.split(":");
  if (scheme !== "pbkdf2" || !iterStr || !saltHex || !hashHex) return false;
  const iterations = parseInt(iterStr, 10);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const salt = fromHex(saltHex);
  const expected = fromHex(hashHex);
  const actual = await deriveBits(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  // Comparacao em tempo constante
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}

export async function createSession(env: Env, data: SessionData): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await env.KV.put(SESSION_PREFIX + token, JSON.stringify(data), { expirationTtl: SESSION_TTL_S });
  return token;
}

export async function getSession(env: Env, token: string | null): Promise<SessionData | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const raw = await env.KV.get(SESSION_PREFIX + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  if (/^[0-9a-f]{64}$/.test(token)) {
    await env.KV.delete(SESSION_PREFIX + token);
  }
}

export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice(7).trim();
}

// Dono do sistema. Fonte de verdade e a env var, nao o banco: assim ninguem
// vira dono escrevendo na tabela users, e mudar a lista nao exige migracao.
export function isAdminEmail(env: Env, email: string | undefined): boolean {
  if (!email) return false;
  const admins = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

// Rate limit por chave (ex.: IP). KV e eventualmente consistente, serve como
// freio grosso contra forca bruta, nao como contador exato.
export async function rateLimitOk(env: Env, key: string, max: number, windowS: number): Promise<boolean> {
  const kvKey = `rl:${key}`;
  const raw = await env.KV.get(kvKey);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= max) return false;
  await env.KV.put(kvKey, String(count + 1), { expirationTtl: windowS });
  return true;
}
