import { useState, type FormEvent } from 'react'
import { PasswordInput } from '../PasswordInput'
import type { AppState } from '@shared/types'
import { api, useAction } from '../useAppState'
import { PlayLock } from '../icons'

export function Setup({ state }: { state: AppState }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touchId, setTouchId] = useState(state.touchIdAvailable)
  const { busy, error, setError, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (pw !== confirm) return setError('The two passwords do not match.')
    void run(() => api.setup(pw, touchId))
  }

  return (
    <form className="panel center" onSubmit={submit}>
      <div className="badge-icon">
        <PlayLock size={32} />
      </div>
      <h1>Set up StreamLock</h1>
      <p className="muted">
        Choose a master password. It encrypts your streaming logins on this Mac. Next you&apos;ll get a recovery key in
        case you ever forget it.
      </p>
      <label className="field">
        <span>Master password</span>
        <PasswordInput id="setup-master" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} minLength={10} required />
      </label>
      <label className="field">
        <span>Confirm password</span>
        <PasswordInput id="setup-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      {state.touchIdAvailable && (
        <label className="check">
          <input type="checkbox" checked={touchId} onChange={(e) => setTouchId(e.target.checked)} />
          <span>Unlock with Touch ID</span>
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary wide" disabled={busy}>
        {busy ? 'Creating vault…' : 'Create vault'}
      </button>
    </form>
  )
}
