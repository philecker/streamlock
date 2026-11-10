import { useState, type FormEvent } from 'react'
import { PasswordInput } from '../PasswordInput'
import type { AppState } from '@shared/types'
import { api, useAction } from '../useAppState'
import { Fingerprint, Shield } from '../icons'

type Step = 'choose' | 'recovery' | 'touch' | 'erase'

/** "Forgot password?" from the unlock screen: recovery key, Touch ID, or start over. */
export function Forgot({ state, onBack }: { state: AppState; onBack: () => void }) {
  const touch = state.touchIdAvailable && state.settings.touchIdEnabled
  const [step, setStep] = useState<Step>('choose')

  if (step === 'recovery') return <ResetWithRecovery onBack={() => setStep('choose')} />
  if (step === 'touch') return <ResetWithTouchId onBack={() => setStep('choose')} />
  if (step === 'erase') return <StartOver state={state} onBack={() => setStep('choose')} />

  return (
    <div className="panel center">
      <h1>Forgot your password?</h1>
      <p className="muted">Choose how to get back in.</p>
      <div className="options wide-options">
        {state.hasRecoveryKey && (
          <button type="button" className="option" onClick={() => setStep('recovery')}>
            <strong className="row gap8">
              <Shield size={14} /> Use my recovery key
            </strong>
            <span className="muted small">Set a new password. Your saved logins stay.</span>
          </button>
        )}
        {touch && (
          <button type="button" className="option" onClick={() => setStep('touch')}>
            <strong className="row gap8">
              <Fingerprint size={14} /> Use Touch ID
            </strong>
            <span className="muted small">Confirm with your fingerprint, then set a new password. Your saved logins stay.</span>
          </button>
        )}
        <button type="button" className="option" onClick={() => setStep('erase')}>
          <strong>Start over</strong>
          <span className="muted small">Erase your saved logins and set up StreamLock again.</span>
        </button>
      </div>
      <button type="button" className="link" onClick={onBack}>
        Back to unlock
      </button>
    </div>
  )
}

function NewPasswordFields({ pw, setPw, confirm, setConfirm }: { pw: string; setPw: (v: string) => void; confirm: string; setConfirm: (v: string) => void }) {
  return (
    <>
      <label className="field">
        <span>New master password</span>
        <PasswordInput id="new-master" value={pw} onChange={(e) => setPw(e.target.value)} minLength={10} required />
      </label>
      <label className="field">
        <span>Confirm new password</span>
        <PasswordInput id="confirm-master" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
    </>
  )
}

function ResetWithRecovery({ onBack }: { onBack: () => void }) {
  const [key, setKey] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const { busy, error, setError, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (pw !== confirm) return setError('The two passwords do not match.')
    void run(() => api.resetWithRecoveryKey(key, pw))
  }

  return (
    <form className="panel center" onSubmit={submit}>
      <h1>Use your recovery key</h1>
      <p className="muted">Enter the key you saved when you set up StreamLock, then choose a new master password.</p>
      <label className="field">
        <span>Recovery key</span>
        <input
          id="recovery-input"
          className="mono-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required
        />
      </label>
      <NewPasswordFields pw={pw} setPw={setPw} confirm={confirm} setConfirm={setConfirm} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary wide" disabled={busy}>
        {busy ? 'Checking…' : 'Set new password'}
      </button>
      <button type="button" className="link" onClick={onBack}>
        Back
      </button>
    </form>
  )
}

function ResetWithTouchId({ onBack }: { onBack: () => void }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const { busy, error, setError, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (pw !== confirm) return setError('The two passwords do not match.')
    void run(() => api.resetWithTouchId(pw))
  }

  return (
    <form className="panel center" onSubmit={submit}>
      <h1>Use Touch ID</h1>
      <p className="muted">Choose a new master password. You will confirm it with your fingerprint.</p>
      <NewPasswordFields pw={pw} setPw={setPw} confirm={confirm} setConfirm={setConfirm} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary wide" disabled={busy}>
        <Fingerprint /> {busy ? 'Waiting for Touch ID…' : 'Confirm with Touch ID'}
      </button>
      <button type="button" className="link" onClick={onBack}>
        Back
      </button>
    </form>
  )
}

function StartOver({ state, onBack }: { state: AppState; onBack: () => void }) {
  const [sure, setSure] = useState(false)
  const { busy, error, run } = useAction()
  const secret = state.settings.pinMode === 'secret'

  return (
    <div className="panel center">
      <h1>Start over?</h1>
      <p className="muted">
        This erases your saved streaming logins from this Mac. Your streaming accounts are not touched, and each keeps its
        current PIN. You will set up StreamLock again and re-enter your logins.
      </p>
      {secret && (
        <p className="note">
          You use Auto (Secret), so this month&apos;s PIN can&apos;t be worked out after erasing. If a service asks for the
          old PIN to change it, use that service&apos;s own &quot;forgot PIN&quot; option.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {!sure ? (
        <button type="button" className="danger wide" onClick={() => setSure(true)}>
          Erase saved logins
        </button>
      ) : (
        <button type="button" className="danger-solid wide" disabled={busy} onClick={() => void run(() => api.eraseVault())}>
          {busy ? 'Erasing…' : 'Yes, erase and start over'}
        </button>
      )}
      <button type="button" className="link" onClick={onBack}>
        Back
      </button>
    </div>
  )
}
