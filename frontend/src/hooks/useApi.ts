import { useState, useEffect, useCallback } from 'react'

interface UseApiResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useApi<T>(url: string, intervalMs?: number): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trigger, setTrigger] = useState(0)

  const reload = useCallback(() => setTrigger((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function fetchData() {
      setLoading(true)
      try {
        const baseUrl = import.meta.env.VITE_API_URL || ''
        const res = await fetch(`${baseUrl}${url}`, { signal: controller.signal })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        const json = await res.json()
        if (!cancelled) {
          setData(json.success === false ? null : (json.data ?? json))
          setError(null)
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Erro ao buscar dados')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()

    let timer: ReturnType<typeof setInterval> | undefined
    if (intervalMs && intervalMs > 0) {
      timer = setInterval(fetchData, intervalMs)
    }

    return () => {
      cancelled = true
      controller.abort()
      if (timer) clearInterval(timer)
    }
  }, [url, intervalMs, trigger])

  return { data, loading, error, reload }
}
