import { useState, useEffect, useCallback } from 'react'

/** 通用数据拉取状态 */
interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/** 通用 API hook */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): UseApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const doFetch = useCallback(() => {
    setLoading(true)
    setError(null)
    fetcher()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    doFetch()
  }, [doFetch])

  return { data, loading, error, refetch: doFetch }
}
