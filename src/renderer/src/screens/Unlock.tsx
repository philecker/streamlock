import { useState, type FormEvent } from 'react'
import { PasswordInput } from '../PasswordInput'
import type { AppState } from '@shared/types'
import { api, useAction } from '../useAppState'
import { Fingerprint, PlayLock } from '../icons'
import { Forgot } from './Forgot'

function lockNote(unlockMinutes: number, idleMinutes: number): string {
  const span = (m: number) =>
    m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minute${m === 1 ? '' : 's'}`
  const limit = unlockMinutes > 0 ? `Stays unlocked for ${span(unlockMinutes)}. ` : ''
  return `${limit}Locks after ${span(idleMinutes)} idle or when your Mac sleeps.`
}

export function Unlock({ state }: { state: AppState }) {
  const [pw, setPw] = useState('')
  const [forgot, setForgot] = useState(false)
  const { busy, error, run } = useAction()
  const touch = state.touchIdAvailable && state.settings.touchIdEnabled
  if (forgot) return <Forgot state={state} onBack={() => setForgot(false)} />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await api.unlock(pw)
      if (r.ok) setPw('')
      return r
    })
  }

  return (
    <form className="panel center" onSubmit={submit}>
      <div className="badge-icon">
        <PlayLock size={32} />
      </div>
      <h1>Vault is locked</h1>
      <p className="muted">
        {state.dueNow
          ? 'A new PIN is ready. Unlock to apply it.'
          : 'Your streaming logins are encrypted on this Mac. Unlock to view or apply PINs.'}
      </p>
      {touch && (
        <>
          <button type="button" className="primary wide" disabled={busy} onClick={() => void run(() => api.unlockTouchId())}>
            <Fingerprint /> Unlock with Touch ID
          </button>
          <div className="divider">or</div>
        </>
      )}
      <label className="field">
        <span>Master password</span>
        <PasswordInput id="unlock-master" autoFocus={!touch} value={pw} onChange={(e) => setPw(e.target.value)} required />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className={touch ? 'secondary wide' : 'primary wide'} disabled={busy || !pw}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      <button type="button" className="link" onClick={() => setForgot(true)}>
        Forgot password?
      </button>
      <p className="fine">{lockNote(state.settings.unlockMinutes, state.settings.autoLockMinutes)}</p>
    </form>
  )
}
