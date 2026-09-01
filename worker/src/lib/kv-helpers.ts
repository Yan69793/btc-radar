// BTC Radar — KV helpers tipados + dedup de chamadas externas

import type { KVNamespace } from "@cloudflare/workers-types";

export async function kvGetJSON<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key, "json");
  return raw as T | null;
}

// ─── Dedup de chamadas externas (evita rate limit em rajadas) ───

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Executa `fetcher()` e garante que apenas uma chamada com a mesma `key`
 * esteja em voo por vez. Requests concorrentes aguardam a mesma promise.
 * Apos resolver (sucesso ou erro), a key e liberada para novas chamadas.
 */
export async function deduped<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fetcher().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}
