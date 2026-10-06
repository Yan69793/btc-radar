// BTC Radar — Testes do modulo de autenticacao (hash e verificacao de senha)
// Roda no Node do vitest; crypto.subtle e global desde o Node 18.

import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, bearerToken } from "../src/lib/auth";

describe("hashPassword / verifyPassword", () => {
  it("aceita a senha correta (roundtrip)", async () => {
    const stored = await hashPassword("Coragem@10!");
    expect(await verifyPassword("Coragem@10!", stored)).toBe(true);
  });

  it("rejeita senha errada", async () => {
    const stored = await hashPassword("senha-forte-123");
    expect(await verifyPassword("senha-forte-124", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("gera salt distinto por hash (mesma senha, hashes diferentes)", async () => {
    const a = await hashPassword("mesma-senha-8");
    const b = await hashPassword("mesma-senha-8");
    expect(a).not.toBe(b);
    expect(await verifyPassword("mesma-senha-8", a)).toBe(true);
    expect(await verifyPassword("mesma-senha-8", b)).toBe(true);
  });

  it("usa o formato pbkdf2:iteracoes:salt:hash", async () => {
    const stored = await hashPassword("abcdefgh");
    const parts = stored.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2");
    expect(parseInt(parts[1], 10)).toBeGreaterThanOrEqual(100_000);
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[3]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejeita hash armazenado malformado sem lancar", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plain:abc")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2:0:zz:zz")).toBe(false);
  });
});

describe("bearerToken", () => {
  it("extrai o token do header Authorization", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer abc123")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
  });
});
