import { useState, type FormEvent } from 'react'
import { PasswordInput } from '../PasswordInput'
import type { AppState, PinMode } from '@shared/types'
import { SERVICES, getService, type ServiceId } from '@shared/services'
import { api, useAction } from '../useAppState'
import { ServiceTile, Shield } from '../icons'

type Tab = 'pin' | 'logins' | 'security' | 'general'

/** Must match UNLOCK_CHOICES in src/main/settings.ts. 0 = until you lock it. */
export const UNLOCK_OPTIONS: [number, string][] = [
  [15, '15 minutes'],
  [60, '1 hour'],
  [240, '4 hours'],
  [480, '8 hours'],
  [0, 'Until I lock it']
]

export function SettingsView({ state }: { state: AppState }) {
  const [tab, setTab] = useState<Tab>('pin')
  const tabs: [Tab, string][] = [
    ['pin', 'PIN'],
    ['logins', 'Logins'],
    ['security', 'Security'],
    ['general', 'General']
  ]
  return (
    <div className="settings">
      <div className="drag-bar" />
      <nav className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main className="settings-body">
        {tab === 'pin' && <PinTab state={state} />}
        {tab === 'logins' && <LoginsTab state={state} />}
        {tab === 'security' && <SecurityTab state={state} />}
        {tab === 'general' && <GeneralTab state={state} />}
      </main>
    </div>
  )
}

// ---------------- PIN ----------------

function PinTab({ state }: { state: AppState }) {
  const [custom, setCustom] = useState('')
  const { busy, error, run } = useAction()
  const mode = state.settings.pinMode
  const choose = (m: PinMode) => m !== mode && m !== 'custom' && void run(() => api.setPinMode(m))
  const [showCustom, setShowCustom] = useState(mode === 'custom')

  const saveCustom = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await api.setPinMode('custom', custom)
      if (r.ok) setCustom('')
      return r
    })
  }

  const options: { id: PinMode; title: string; body: string }[] = [
    { id: 'mmyy', title: 'Auto (Month + Year)', body: 'October 2026 → 1026. Changes on the 1st. Easy to guess.' },
    { id: 'secret', title: 'Auto (Secret)', body: 'Changes on the 1st, but generated from a secret key, so it cannot be predicted.' },
    { id: 'custom', title: 'Custom PIN', body: 'One PIN you choose. Stays the same until you change it.' }
  ]

  return (
    <section className="stack">
      <h2>PIN Mode</h2>
      <div className="options" role="radiogroup" aria-label="PIN mode">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={(o.id === 'custom' ? showCustom : !showCustom && mode === o.id)}
            className={`option ${(o.id === 'custom' ? showCustom : !showCustom && mode === o.id) ? 'on' : ''}`}
            onClick={() => {
              setShowCustom(o.id === 'custom')
              choose(o.id)
            }}
            disabled={busy}
          >
            <strong>{o.title}</strong>
            <span className="muted small">{o.body}</span>
          </button>
        ))}
      </div>

      {showCustom && (
        <form className="card stack" onSubmit={saveCustom}>
          <label className="field">
            <span>{mode === 'custom' ? 'Change custom PIN' : 'New 4-digit PIN'}</span>
            <input
              className="pin-input"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              required
            />
          </label>
          <button className="primary" disabled={busy || custom.length !== 4}>
            Save custom PIN
          </button>
        </form>
      )}

      {state.pin && (
        <p className="muted small">
          Current PIN: <strong>{state.pin.value}</strong>
          {state.pin.nextValue && <> · next: {state.pin.nextValue}</>}. Changing the mode marks every service as pending.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  )
}

// ---------------- Logins ----------------

function LoginsTab({ state }: { state: AppState }) {
  const [editing, setEditing] = useState<ServiceId | null>(null)
  if (editing) return <LoginForm state={state} serviceId={editing} onClose={() => setEditing(null)} />
  const has = (id: ServiceId) => state.logins.some((l) => l.serviceId === id)
  const added = SERVICES.filter((s) => has(s.id))
  const available = SERVICES.filter((s) => !has(s.id))
  return (
    <section className="stack">
      <h2>Streaming Logins</h2>
      {added.length > 0 && (
        <>
          <div className="eyebrow">Your services</div>
          <ul className="list">
            {added.map((s) => (
              <li key={s.id} className="svc-row">
                <ServiceTile service={s} />
                <span className="grow">
                  <span className="svc-name">{s.name}</span>
                  <span className="muted small block">{state.logins.find((l) => l.serviceId === s.id)?.email}</span>
                </span>
                <button className="secondary small" onClick={() => setEditing(s.id)}>
                  Edit
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {available.length > 0 && (
        <>
          <div className="eyebrow">Add a service</div>
          <ul className="list">
            {available.map((s) => (
              <li key={s.id} className="svc-row">
                <ServiceTile service={s} />
                <span className="grow">
                  <span className="svc-name">{s.name}</span>
                  <span className="muted small block">{s.scope}</span>
                </span>
                <button className="primary small" onClick={() => setEditing(s.id)}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="fine row gap8">
        <Shield size={14} /> Encrypted on this Mac. Passwords are only ever typed into each service&apos;s own sign-in page.
      </p>
    </section>
  )
}

function LoginForm({ state, serviceId, onClose }: { state: AppState; serviceId: ServiceId; onClose: () => void }) {
  const svc = getService(serviceId)!
  const existing = state.logins.find((l) => l.serviceId === serviceId)
  const [email, setEmail] = useState(existing?.email ?? '')
  const [password, setPassword] = useState('')
  const [profiles, setProfiles] = useState(existing?.profiles ?? '')
  const [settingsUrl, setSettingsUrl] = useState(existing?.settingsUrl ?? '')
  const { busy, error, run } = useAction()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const r = await api.saveLogin({ serviceId, email, password, profiles, settingsUrl })
      if (r.ok) onClose()
      return r
    })
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h2>{existing ? `Edit ${svc.name}` : `Add ${svc.name}`}</h2>
      <label className="field">
        <span>Email or username</span>
        <input type="text" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span>Password{existing ? ' (leave blank to keep)' : ''}</span>
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required={!existing} />
      </label>
      <label className="field">
        <span>Profiles to lock (for your reference)</span>
        <input type="text" value={profiles} onChange={(e) => setProfiles(e.target.value)} placeholder="e.g. Dad, Mom, Guest" maxLength={200} />
      </label>
      <label className="field">
        <span>PIN page address (optional)</span>
        <input
          id="settings-url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={settingsUrl}
          onChange={(e) => setSettingsUrl(e.target.value)}
          placeholder={svc.settingsUrl}
          maxLength={2048}
        />
        <span className="fine">
          If StreamLock opens the wrong page, sign in to {svc.name} yourself, go to the page where you set the PIN, and paste
          its address here. Leave blank to use the built-in page. Only {svc.allowedHosts[0]} addresses are accepted.
        </span>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row between">
        {existing ? (
          <button
            type="button"
            className="danger small"
            disabled={busy}
            onClick={() => void run(async () => {
              const r = await api.deleteLogin(serviceId)
              if (r.ok) onClose()
              return r
            })}
          >
            Delete login
          </button>
        ) : (
          <span />
        )}
        <div className="row gap8">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </div>
    </form>
  )
}

// ---------------- Security ----------------

function SecurityTab({ state }: { state: AppState }) {
  const { busy, error, run } = useAction()
  const pw = useAction()
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saved, setSaved] = useState(false)
  const [viaTouchId, setViaTouchId] = useState(false)
  const canTouch = state.touchIdAvailable && state.settings.touchIdEnabled

  const change = (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return pw.setError('The new passwords do not match.')
    void pw.run(async () => {
      const r = viaTouchId && canTouch ? await api.resetWithTouchId(next) : await api.changePassword(cur, next)
      if (r.ok) {
        setCur('')
        setNext('')
        setConfirm('')
        setSaved(true)
      }
      return r
    })
  }

  return (
    <section className="stack">
      <h2>Security</h2>
      <div className="card stack">
        <label className="check">
          <input
            type="checkbox"
            checked={state.settings.touchIdEnabled}
            disabled={!state.touchIdAvailable || busy}
            onChange={(e) => void run(() => api.setTouchId(e.target.checked))}
          />
          <span>Unlock with Touch ID{!state.touchIdAvailable && ' (not available on this Mac)'}</span>
        </label>
        <label className="field inline">
          <span>Stay unlocked for</span>
          <select
            id="unlock-minutes"
            value={state.settings.unlockMinutes}
            onChange={(e) => void run(() => api.updatePrefs({ unlockMinutes: Number(e.target.value) }))}
          >
            {UNLOCK_OPTIONS.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Lock when idle for</span>
          <select
            id="idle-minutes"
            value={state.settings.autoLockMinutes}
            onChange={(e) => void run(() => api.updatePrefs({ autoLockMinutes: Number(e.target.value) }))}
          >
            {[1, 5, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m === 60 ? '1 hour' : `${m} min`}
              </option>
            ))}
          </select>
        </label>
        <p className="fine">StreamLock also locks when your Mac sleeps or the screen locks, and never in the middle of applying a PIN.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <form className="card stack" onSubmit={change}>
        <strong>Change master password</strong>
        {viaTouchId && canTouch ? (
          <p className="muted small">You will confirm with Touch ID instead of typing your current password.</p>
        ) : (
          <label className="field">
            <span>Current password</span>
            <PasswordInput id="current-master" value={cur} onChange={(e) => setCur(e.target.value)} required />
          </label>
        )}
        <label className="field">
          <span>New password</span>
          <PasswordInput id="next-master" value={next} onChange={(e) => { setNext(e.target.value); setSaved(false) }} minLength={10} required />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <PasswordInput id="confirm-next-master" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {pw.error && <p className="error" role="alert">{pw.error}</p>}
        {saved && <p className="ok-text">Password changed.</p>}
        <button className="primary" disabled={pw.busy}>
          {pw.busy ? 'Saving…' : viaTouchId && canTouch ? 'Confirm with Touch ID' : 'Change password'}
        </button>
        {canTouch && (
          <button type="button" className="link" onClick={() => { setViaTouchId(!viaTouchId); pw.setError(null) }}>
            {viaTouchId ? 'Use my current password instead' : 'Forgot your current password? Use Touch ID'}
          </button>
        )}
      </form>

      <RecoveryKeyCard state={state} />
    </section>
  )
}

function RecoveryKeyCard({ state }: { state: AppState }) {
  const [confirming, setConfirming] = useState(false)
  const { busy, error, run } = useAction()
  const make = () => void run(() => api.createRecoveryKey())

  return (
    <div className="card stack">
      <div className="row between">
        <strong>Recovery key</strong>
        <span className={`chip ${state.hasRecoveryKey ? 'ok' : 'warn'}`}>{state.hasRecoveryKey ? 'Set up' : 'Not set up'}</span>
      </div>
      <p className="muted small">
        Lets you set a new master password if you forget it, without losing your saved logins. It is shown only once, when
        it is made.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {!state.hasRecoveryKey ? (
        <button type="button" className="primary" disabled={busy} onClick={make}>
          Create recovery key
        </button>
      ) : !confirming ? (
        <button type="button" className="secondary" onClick={() => setConfirming(true)}>
          Create a new recovery key
        </button>
      ) : (
        <div className="stack">
          <p className="note">Your current recovery key will stop working.</p>
          <div className="row gap8">
            <button type="button" className="primary" disabled={busy} onClick={make}>
              Create new key
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- General ----------------

function GeneralTab({ state }: { state: AppState }) {
  const { error, run } = useAction()
  const s = state.settings
  return (
    <section className="stack">
      <h2>General</h2>
      <div className="card stack">
        <label className="field inline">
          <span>Change PIN on the 1st at</span>
          <select value={s.changeHour} onChange={(e) => void run(() => api.updatePrefs({ changeHour: Number(e.target.value) }))}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.notifyDayBefore} onChange={(e) => void run(() => api.updatePrefs({ notifyDayBefore: e.target.checked }))} />
          <span>Notify me the day before</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.launchAtLogin} onChange={(e) => void run(() => api.updatePrefs({ launchAtLogin: e.target.checked }))} />
          <span>Open at login</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.primePinLength === 5}
            onChange={(e) => void run(() => api.updatePrefs({ primePinLength: e.target.checked ? 5 : 4 }))}
          />
          <span>My Prime Video PIN has 5 digits (adds a leading 0)</span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>
  )
}
