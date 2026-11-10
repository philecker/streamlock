// Mock must install window.streamlock before any app module reads it.
import { sim, type SimEvent } from './mock'
import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppState } from '@shared/types'
import { getService, type ServiceId } from '@shared/services'
import { useAppState } from '../src/renderer/src/useAppState'
import { Setup } from '../src/renderer/src/screens/Setup'
import { Unlock } from '../src/renderer/src/screens/Unlock'
import { Popover } from '../src/renderer/src/screens/Popover'
import { SettingsView } from '../src/renderer/src/screens/Settings'
import { RecoveryKey } from '../src/renderer/src/screens/RecoveryKey'
import '../src/renderer/src/styles.css'
import './preview.css'

function TrayIcon({ state }: { state: AppState }) {
  const attention = state.dueNow || state.run?.items.some((i) => i.status === 'needs-you')
  const open = state.vault === 'unlocked'
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={attention ? 'StreamLock needs you' : open ? 'StreamLock unlocked' : 'StreamLock locked'}>
      <path d={open || attention ? 'M8 10V7a4 4 0 0 1 6.2-3.3' : 'M8 10V7a4 4 0 0 1 8 0v3'} />
      <rect x="4" y="10" width="16" height="11" rx="2.5" />
      <path d="M10.5 13.3v4.4l3.8-2.2z" fill="currentColor" stroke="none" />
      {attention && <circle cx="19" cy="5" r="3" fill="currentColor" stroke="none" />}
    </svg>
  )
}

function clockLabel(d: Date) {
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

interface Toast {
  id: number
  title: string
  body: string
}

interface ServiceWindow {
  serviceId: ServiceId
  pin: string
}

function Preview() {
  const state = useAppState()
  const [toasts, setToasts] = useState<Toast[]>([])
  const [win, setWin] = useState<ServiceWindow | null>(null)
  const [settingsFlash, setSettingsFlash] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  useEffect(
    () =>
      sim.onEvent((e: SimEvent) => {
        if (e.kind === 'notify' && e.title) {
          const id = nextId.current++
          setToasts((t) => [...t.slice(-2), { id, title: e.title!, body: e.body ?? '' }])
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000)
        }
        if (e.kind === 'window' && e.serviceId && e.pin) setWin({ serviceId: e.serviceId, pin: e.pin })
        if (e.kind === 'window-closed') setWin(null)
        if (e.kind === 'clipboard' && e.pin) {
          const id = nextId.current++
          const title = `Copied ${e.pin}`
          setToasts((t) => [...t.filter((x) => x.title !== title).slice(-1), { id, title, body: 'Cleared from the clipboard after 90 seconds.' }])
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500)
        }
        if (e.kind === 'open-settings') {
          settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          setSettingsFlash(true)
          setTimeout(() => setSettingsFlash(false), 900)
        }
      }),
    []
  )

  if (!state) return null
  const svc = win ? getService(win.serviceId) : undefined
  const popoverBody =
    state.vault === 'missing' ? (
      <Setup state={state} />
    ) : state.vault === 'locked' ? (
      <Unlock state={state} />
    ) : state.recoveryKey ? (
      <RecoveryKey recoveryKey={state.recoveryKey} />
    ) : (
      <Popover state={state} />
    )

  return (
    <div className="pv-page">
      <header className="pv-head">
        <div>
          <h1 className="pv-title">StreamLock preview</h1>
          <p className="pv-lede">
            The app&apos;s real screens with sample logins. Nothing here signs in anywhere, and passwords you type are thrown away.
          </p>
        </div>
        <div className="pv-controls" role="group" aria-label="Simulation">
          <span className="pv-clock" aria-live="polite">
            Simulated clock: <strong>{clockLabel(sim.now)}</strong>
          </span>
          <div className="pv-btns">
            <button type="button" className="pv-btn pv-btn-main" onClick={() => sim.jumpToNextChange()}>
              Jump to next PIN change
            </button>
            <button type="button" className="pv-btn" onClick={() => void sim.api.lock()} disabled={state.vault !== 'unlocked'}>
              Lock vault
            </button>
            <button type="button" className="pv-btn" onClick={() => sim.reset('fresh')}>
              First-run setup
            </button>
            <button type="button" className="pv-btn" onClick={() => sim.reset('sample')}>
              Reset
            </button>
          </div>
        </div>
      </header>

      <main className="pv-stage">
        <section className="pv-col pv-col-pop" aria-label="Menu bar popover">
          <div className="pv-label">Menu bar</div>
          <div className="pv-menubar">
            <span className="pv-menubar-app">Finder</span>
            <span className="pv-menubar-right">
              <span className="pv-tray">
                <TrayIcon state={state} />
              </span>
              <span className="pv-menubar-clock">{clockLabel(sim.now)}</span>
            </span>
          </div>
          <div className="pv-frame pv-popover">{popoverBody}</div>
        </section>

        <section className="pv-col pv-col-set" aria-label="Settings window">
          <div className="pv-label">Settings window</div>
          <div ref={settingsRef} className={`pv-frame pv-settings ${settingsFlash ? 'pv-flash' : ''}`}>
            {state.vault === 'unlocked' && state.recoveryKey ? (
              <div className="pv-empty">Save your recovery key in the popover first.</div>
            ) : state.vault === 'unlocked' ? (
              <SettingsView state={state} />
            ) : (
              <div className="pv-empty">Settings open after you unlock StreamLock.</div>
            )}
          </div>
        </section>

        <section className="pv-col pv-col-side" aria-label="Service window">
          <div className="pv-label">Service window</div>
          {win && svc ? (
            <div className="pv-svcwin">
              <div className="pv-svcwin-bar">
                <span className="pv-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="pv-svcwin-title">
                  {svc.name} · set PIN {win.pin}
                </span>
              </div>
              <div className="pv-svcwin-url">{sim.logins.find((l) => l.serviceId === win.serviceId)?.settingsUrl ?? svc.settingsUrl}</div>
              <div className="pv-svcwin-body">
                <p>
                  <strong>Simulated.</strong> In the app, {svc.name}&apos;s own settings page loads here in its own window.
                </p>
                <ol>
                  <li>If a sign-in form appears, your saved email and password are already filled in. You press Sign in.</li>
                  <li>
                    Open the PIN or profile lock setting and paste <strong>{win.pin}</strong> (it&apos;s on your clipboard).
                  </li>
                  <li>Save on the site, then click Done in the popover.</li>
                </ol>
                <button type="button" className="pv-btn" onClick={() => void sim.api.skip(win.serviceId)}>
                  Close window (skips this service)
                </button>
              </div>
            </div>
          ) : (
            <div className="pv-svcwin pv-svcwin-idle">
              <p>
                When you choose <strong>Apply</strong>, each service&apos;s settings page opens here, one at a time.
              </p>
            </div>
          )}
        </section>
      </main>

      <div className="pv-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pv-toast" role="status">
            <span className="pv-toast-icon" aria-hidden="true">
              <TrayIcon state={{ ...state, dueNow: false, run: undefined, vault: 'locked' }} />
            </span>
            <span>
              <strong>{t.title}</strong>
              <span className="pv-toast-body">{t.body}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

createRoot(document.getElementById('preview-root') as HTMLElement).render(
  <StrictMode>
    <Preview />
  </StrictMode>
)
