// Sessao do painel. O token vem de /api/auth e fica no localStorage, que e
// compartilhado entre a landing (raiz) e o painel (/painel) por serem a mesma origem.

const TOKEN_KEY = 'btc-radar-token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch { /* storage bloqueado, sessao vale so ate recarregar */ }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch { /* storage bloqueado */ }
}
