import { useState } from 'react'
import { api } from '../useAppState'
import { Shield } from '../icons'

/**
 * Shown once, right after the vault is created or the key is replaced.
 * StreamLock does not keep a readable copy, so this is the only chance to save it.
 */
export function RecoveryKey({ recoveryKey }: { recoveryKey: string }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  // Copied by the app itself (pages can't use the clipboard); it is cleared
  // from the clipboard after 90 seconds.
  const copy = async () => {
    const r = await api.copyRecoveryKey()
    if (r.ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="panel center">
      <div className="badge-icon">
        <Shield size={30} />
      </div>
      <h1>Save your recovery key</h1>
      <p className="muted">
        If you forget your master password, this key lets you set a new one without losing your saved logins. This is the
        only time it will be shown.
      </p>
      <div className="recovery-key" aria-label="Recovery key">
        {recoveryKey}
      </div>
      <button type="button" className="secondary" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy recovery key'}
      </button>
      <p className="fine">
        Paste it into a password manager or print it and store it somewhere safe. It is cleared from the clipboard after 90
        seconds. Anyone with this key and your Mac can reset your password.
      </p>
      <label className="check">
        <input id="saved-recovery" type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I saved my recovery key</span>
      </label>
      <button type="button" className="primary wide" disabled={!saved} onClick={() => void api.ackRecoveryKey()}>
        Continue
      </button>
    </div>
  )
}
