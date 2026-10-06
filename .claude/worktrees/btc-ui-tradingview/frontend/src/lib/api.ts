// Cliente HTTP do painel. Toda escrita passa por aqui para o token da sessao
// ir junto, e para 401 e 403 terem tratamento uniforme.
//   401 = sessao morta, limpa e volta ao login
//   403 = sessao viva sem permissao (visitante do demo), recusa sem deslogar

import { getToken, clearToken } from './session'

const API_BASE = import.meta.env.VITE_API_URL || ''

export class ForbiddenError extends Error {}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })

  if (res.status === 401) {
    clearToken()
    window.location.reload()
    throw new Error('Sessao expirada. Faca login novamente.')
  }
  if (res.status === 403) {
    const json = await res.json().catch(() => null)
    throw new ForbiddenError(json?.error || 'Voce nao tem permissao para esta acao.')
  }

  return res
}

// Escrita com corpo JSON, que e o formato de todas as rotas de mutacao da API.
export function apiSend(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<Response> {
  return apiFetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
}
