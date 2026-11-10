// Walks the user through applying one PIN to each service, one at a time.
//
// "Assisted" mode: for each service it opens that service's own PIN settings
// page in an isolated window, keeps filling saved credentials into sign-in
// forms as they appear (including two-step and embedded sign-ins), returns to
// the PIN page once you are signed in, and puts the PIN on the clipboard. You
// make the final change and click "Done". Fully automated recipes can later
// replace openAssisted() per service without changing the run state machine.

import { EventEmitter } from 'node:events'
import { BrowserWindow, clipboard, session, shell, type WebFrameMain } from 'electron'
import type { RunItem, RunState } from '@shared/types'
import { getService, type ServiceDef, type ServiceId } from '@shared/services'
import { buildFillScript, isFillAllowed, isSettingsPage, type FillResult } from './autofill'

export interface RunCredentials {
  email: string
  password: string
  /** The page where the PIN is changed for this account (user override or catalog default). */
  settingsUrl: string
}

const CLIPBOARD_CLEAR_MS = 90_000
const FILL_EVERY_MS = 1_000
const FILL_FOR_MS = 5 * 60_000
/** Wait for the site's own post-sign-in redirects to settle before steering. */
const RETURN_DELAY_MS = 2_000
const MAX_RETURNS = 3

export interface RunnerEvents {
  changed: []
  applied: [serviceId: ServiceId, period: string]
}

/** Per-window state for the assisted flow. */
interface Assist {
  svc: ServiceDef
  cred?: RunCredentials
  settingsUrl: string
  /** "<page url>|email" / "|password" already filled, so a box you clear is not refilled. */
  filled: Set<string>
  /** A password was filled at some point, i.e. you are going through sign-in. */
  signingIn: boolean
  returns: number
  fillTimer?: NodeJS.Timeout
  returnTimer?: NodeJS.Timeout
  startedAt: number
}

export class Runner extends EventEmitter<RunnerEvents> {
  private run: RunState | null = null
  private creds = new Map<ServiceId, RunCredentials>()
  private pins = new Map<ServiceId, string>()
  private window: BrowserWindow | null = null
  private windowFor: ServiceId | null = null
  private assist: Assist | null = null
  private clipboardTimer: NodeJS.Timeout | null = null

  get state(): RunState | undefined {
    return this.run ?? undefined
  }

  get isRunning(): boolean {
    return this.run !== null
  }

  /**
   * Starts a run. `pinFor` lets one service (Prime) get an adapted PIN while
   * the run still reports a single period.
   */
  start(
    period: string,
    pin: string,
    services: ServiceId[],
    creds: Map<ServiceId, RunCredentials>,
    pinFor: (id: ServiceId) => string
  ): void {
    if (this.run || services.length === 0) return
    this.creds = new Map(creds)
    this.pins = new Map(services.map((id) => [id, pinFor(id)]))
    this.run = {
      period,
      pin,
      startedAt: new Date().toISOString(),
      items: services.map((serviceId): RunItem => ({ serviceId, status: 'queued' }))
    }
    this.advance()
  }

  markDone(id: ServiceId): void {
    const item = this.item(id)
    if (!item || item.status !== 'needs-you' || !this.run) return
    item.status = 'done'
    this.emit('applied', id, this.run.period)
    this.closeWindow()
    this.advance()
  }

  skip(id: ServiceId): void {
    const item = this.item(id)
    if (!item || item.status !== 'needs-you') return
    item.status = 'skipped'
    this.closeWindow()
    this.advance()
  }

  /** Brings the current service's window back if the user lost it. */
  focus(id: ServiceId): void {
    if (this.windowFor === id && this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
    }
  }

  /** Sends the current service's window back to its PIN settings page. */
  goToSettings(id: ServiceId): void {
    if (this.windowFor !== id || !this.window || this.window.isDestroyed() || !this.assist) return
    void this.window.loadURL(this.assist.settingsUrl)
    this.focus(id)
  }

  cancel(): void {
    this.closeWindow()
    this.finish()
  }

  /** Clears credentials from memory, e.g. when the vault locks. */
  dispose(): void {
    this.cancel()
  }

  private item(id: ServiceId): RunItem | undefined {
    return this.run?.items.find((i) => i.serviceId === id)
  }

  private advance(): void {
    const next = this.run?.items.find((i) => i.status === 'queued')
    if (!next) {
      this.finish()
      return
    }
    next.status = 'needs-you'
    this.emit('changed')
    this.openAssisted(next.serviceId)
  }

  private finish(): void {
    const hadRun = this.run !== null
    this.run = null
    this.creds.clear()
    this.pins.clear()
    if (hadRun) this.emit('changed')
  }

  private openAssisted(id: ServiceId): void {
    const svc = getService(id)
    const pin = this.pins.get(id)
    if (!svc || !pin) return
    const cred = this.creds.get(id)
    const settingsUrl = cred?.settingsUrl ?? svc.settingsUrl

    const ses = session.fromPartition(`persist:svc-${id}`)
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

    const win = new BrowserWindow({
      width: 1100,
      height: 820,
      title: `${svc.name} · set PIN ${pin}`,
      show: true,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false
      }
    })
    const a: Assist = { svc, cred, settingsUrl, filled: new Set(), signingIn: false, returns: 0, startedAt: Date.now() }
    this.window = win
    this.windowFor = id
    this.assist = a

    // Keep the title showing the PIN even when the site sets its own.
    win.on('page-title-updated', (e) => e.preventDefault())

    // Sign-in popups stay in-app only on the service's own hosts.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isFillAllowed(url, svc.allowedHosts)) return { action: 'allow' }
      if (url.startsWith('https:')) void shell.openExternal(url)
      return { action: 'deny' }
    })

    if (cred) {
      const tick = () => {
        if (win.isDestroyed() || Date.now() - a.startedAt > FILL_FOR_MS) {
          if (a.fillTimer) clearInterval(a.fillTimer)
          return
        }
        void this.fillFrames(win, a)
      }
      a.fillTimer = setInterval(tick, FILL_EVERY_MS)
      win.webContents.on('did-finish-load', tick)
    }

    // After you sign in, most sites land on a home page or profile picker.
    // Once that settles, steer back to the PIN page (a few times at most).
    // Only the top-level page counts: an embedded sign-in frame changing pages
    // must not trigger a jump while you are still signing in.
    win.webContents.on('did-navigate', (_e, url) => this.scheduleReturn(win, a, url))
    win.webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.scheduleReturn(win, a, url)
    })

    // Closing the window counts as "skip for now"; the service stays pending.
    win.on('closed', () => {
      if (a.fillTimer) clearInterval(a.fillTimer)
      if (a.returnTimer) clearTimeout(a.returnTimer)
      if (this.window === win) {
        this.window = null
        this.windowFor = null
        this.assist = null
        const item = this.item(id)
        if (item?.status === 'needs-you') {
          item.status = 'skipped'
          this.advance()
        }
      }
    })

    void win.loadURL(settingsUrl)
    this.copyPin(pin)
  }

  /** Fills every frame on the service's own hosts, including embedded sign-in frames. */
  private async fillFrames(win: BrowserWindow, a: Assist): Promise<void> {
    if (!a.cred) return
    let frames: WebFrameMain[]
    try {
      frames = win.webContents.mainFrame.framesInSubtree
    } catch {
      return
    }
    for (const frame of frames) {
      const url = frame.url
      if (!isFillAllowed(url, a.svc.allowedHosts)) continue
      const pageKey = url.split('#')[0] ?? url
      const want = { email: !a.filled.has(`${pageKey}|email`), password: !a.filled.has(`${pageKey}|password`) }
      if (!want.email && !want.password) continue
      try {
        const res = (await frame.executeJavaScript(buildFillScript(a.cred.email, a.cred.password, want))) as FillResult
        if (res?.email) a.filled.add(`${pageKey}|email`)
        if (res?.password) {
          a.filled.add(`${pageKey}|password`)
          a.signingIn = true
          if (!win.isDestroyed()) win.focus()
        }
      } catch {
        // Frames navigating mid-fill throw; the next tick retries.
      }
    }
  }

  private scheduleReturn(win: BrowserWindow, a: Assist, url: string): void {
    if (a.returnTimer) clearTimeout(a.returnTimer)
    if (!a.signingIn || a.returns >= MAX_RETURNS) return
    if (isSettingsPage(url, a.settingsUrl)) {
      a.signingIn = false // made it
      return
    }
    a.returnTimer = setTimeout(async () => {
      if (win.isDestroyed()) return
      const now = win.webContents.getURL()
      if (isSettingsPage(now, a.settingsUrl) || !isFillAllowed(now, a.svc.allowedHosts)) return
      // Still on a sign-in step (password or code box showing)? Leave it alone.
      try {
        const busy = (await win.webContents.executeJavaScript(
          `!!document.querySelector('input[type="password"], input[autocomplete="one-time-code"], input[name*="code" i], input[name*="otp" i]')`
        )) as boolean
        if (busy) return
      } catch {
        return
      }
      a.returns += 1
      void win.loadURL(a.settingsUrl)
    }, RETURN_DELAY_MS)
  }

  copyPin(pin: string): void {
    clipboard.writeText(pin)
    if (this.clipboardTimer) clearTimeout(this.clipboardTimer)
    this.clipboardTimer = setTimeout(() => {
      // Only clear if the user has not copied something else since.
      if (clipboard.readText() === pin) clipboard.clear()
      this.clipboardTimer = null
    }, CLIPBOARD_CLEAR_MS)
  }

  private closeWindow(): void {
    const win = this.window
    this.window = null
    this.windowFor = null
    if (this.assist?.fillTimer) clearInterval(this.assist.fillTimer)
    if (this.assist?.returnTimer) clearTimeout(this.assist.returnTimer)
    this.assist = null
    if (win && !win.isDestroyed()) win.close()
  }
}
