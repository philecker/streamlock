import { useState } from 'react'
import type { AppState, RunItemStatus } from '@shared/types'
import { SERVICES, type ServiceId } from '@shared/services'
import { api, useAction } from '../useAppState'
import { Gear, OpenIcon, PlayLock, ServiceTile } from '../icons'
import { lastUpdated } from '../format'

const MODE_LABEL = { mmyy: 'Auto (MMYY)', secret: 'Auto (Secret)', custom: 'Custom' } as const

const fmtMonth = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number]
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

type Chip = { label: string; tone: 'ok' | 'warn' | 'busy' | 'quiet' }

function chipFor(state: AppState, id: ServiceId): Chip {
  const runItem = state.run?.items.find((i) => i.serviceId === id)
  if (runItem) {
    const map: Record<RunItemStatus, Chip> = {
      queued: { label: 'Queued', tone: 'quiet' },
      'needs-you': { label: 'Needs you', tone: 'warn' },
      done: { label: 'Done', tone: 'ok' },
      skipped: { label: 'Skipped', tone: 'quiet' }
    }
    return map[runItem.status]
  }
  const rec = state.settings.services[id]
  if (!rec?.lastAppliedPeriod) return { label: 'Not set yet', tone: 'quiet' }
  if (rec.lastAppliedPeriod === state.pin?.period) return { label: 'Synced', tone: 'ok' }
  return { label: 'Pending', tone: 'warn' }
}

export function Popover({ state }: { state: AppState }) {
  const { busy, error, run } = useAction()
  const [copied, setCopied] = useState(false)
  const pin = state.pin
  const saved = SERVICES.filter((s) => state.logins.some((l) => l.serviceId === s.id))
  const r = state.run
  const doneCount = r?.items.filter((i) => i.status === 'done' || i.status === 'skipped').length ?? 0

  const copy = () =>
    void run(async () => {
      const res = await api.copyPin()
      if (res.ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
      return res
    })

  return (
    <div className="popover">
      <header className="pop-head">
        <div className="row gap8">
          <strong>StreamLock</strong>
          <span className="chip ok">Unlocked</span>
        </div>
        <button className="icon-btn" aria-label="Settings" onClick={() => void api.openSettings()}>
          <Gear />
        </button>
      </header>

      {r ? (
        <section className="card">
          <div className="row between">
            <strong>Applying PIN {r.pin}</strong>
            <span className="muted small">
              {doneCount} of {r.items.length}
            </span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={r.items.length} aria-valuenow={doneCount}>
            <div style={{ width: `${(doneCount / r.items.length) * 100}%` }} />
          </div>
          <p className="muted small">
            PIN is on your clipboard. Finish signing in if asked, set the PIN on the page, then click Done.
          </p>
        </section>
      ) : pin ? (
        <section className="card">
          <div className="row between">
            <span className="eyebrow">Current PIN</span>
            <span className="chip accent">{MODE_LABEL[pin.mode]}</span>
          </div>
          <div className="digits" aria-label={`PIN ${pin.value.split('').join(' ')}`}>
            {pin.value.split('').map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <p className="muted small pin-caption">
            {fmtMonth(pin.period)} · next change {fmtDay(pin.nextChangeAt)}
            {pin.nextValue ? ` → ${pin.nextValue}` : ''}
          </p>
          <div className="row gap8">
            <button className="primary grow" disabled={busy || saved.length === 0} onClick={() => void run(() => api.apply(false))}>
              {state.dueNow ? 'Apply new PIN' : 'Apply to all services'}
            </button>
            <button className="secondary" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </section>
      ) : (
        <section className="card">
          <p className="muted">No PIN set. Choose a PIN mode in Settings.</p>
        </section>
      )}

      {error && <p className="error pad" role="alert">{error}</p>}

      <div className="eyebrow pad">Services</div>
      <ul className="svc-list">
        {saved.length === 0 && (
          <li className="empty">
            <span className="muted">No logins yet.</span>
            <button className="link" onClick={() => void api.openSettings()}>
              Add one
            </button>
          </li>
        )}
        {saved.map((s) => {
          const chip = chipFor(state, s.id)
          const item = r?.items.find((i) => i.serviceId === s.id)
          return (
            <li key={s.id}>
              <div className="svc-row">
                <ServiceTile service={s} />
                <span className="grow">
                  <span className="svc-name">{s.name}</span>
                  <span className="muted small block">Last Updated: {lastUpdated(state.settings.services[s.id]?.lastAppliedAt)}</span>
                </span>
                <span className={`chip ${chip.tone}`}>{chip.label}</span>
                {!r && (
                  <button
                    type="button"
                    className="open-btn"
                    aria-label={`Open ${s.name} to set the PIN`}
                    title={`Open ${s.name} to set the PIN`}
                    disabled={busy || !pin}
                    onClick={() => void run(() => api.applyOne(s.id))}
                  >
                    <OpenIcon />
                  </button>
                )}
              </div>
              {item?.status === 'needs-you' && (
                <div className="row gap8 indent">
                  <button className="primary small" onClick={() => void api.markDone(s.id)}>
                    Done
                  </button>
                  <button className="secondary small" onClick={() => void api.goToSettings(s.id)} title="Open the PIN settings page again">
                    PIN page
                  </button>
                  <button className="secondary small" onClick={() => void api.focus(s.id)}>
                    Show window
                  </button>
                  <button className="ghost small" onClick={() => void api.skip(s.id)}>
                    Skip
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <footer className="pop-foot">
        {r ? (
          <button className="link" onClick={() => void api.cancelRun()}>
            Stop applying
          </button>
        ) : (
          <span className="muted small">{lastApplied(state)}</span>
        )}
        <button type="button" className="lock-pill" aria-label="Lock StreamLock" title="Lock StreamLock" onClick={() => void api.lock()}>
          <PlayLock size={14} />
        </button>
      </footer>
    </div>
  )
}

function lastApplied(state: AppState): string {
  const times = Object.values(state.settings.services)
    .map((r) => r?.lastAppliedAt)
    .filter((t): t is string => !!t)
    .sort()
  const last = times.at(-1)
  return last ? `Last applied ${new Date(last).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not applied yet'
}
