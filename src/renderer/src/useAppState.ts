import { useCallback, useEffect, useState } from 'react'
import type { AppState, Result } from '@shared/types'

export const api = window.streamlock

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null)
  useEffect(() => {
    let live = true
    void api.getState().then((s) => live && setState(s))
    const off = api.onState(setState)
    return () => {
      live = false
      off()
    }
  }, [])
  return state
}

/** Runs an action that returns a Result, tracking busy + error for a form. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async (fn: () => Promise<Result | void>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      if (r && !r.ok) {
        setError(r.error)
        return false
      }
      return true
    } catch {
      setError('Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, setError, run }
}
