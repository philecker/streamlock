import { existsSync, readFileSync } from 'node:fs'
import { uptime } from 'node:os'
import { join } from 'node:path'
import { app, Menu, Notification, Tray, nativeImage, powerMonitor, safeStorage, session, systemPreferences } from 'electron'
import { Vault } from './vault'
import { SettingsStore } from './settings'
import { Controller, type Platform } from './controller'
import { Runner } from './automation/runner'
import { registerIpc } from './ipc'
import { allUiWindows, createPopover, openSettings, positionUnder } from './windows'

if (!app.requestSingleInstanceLock()) app.quit()

const TICK_MS = 30_000

/**
 * Best guess at "macOS opened us as a login item". wasOpenedAtLogin is not
 * reported for apps registered through newer macOS APIs, so a launch within a
 * few minutes of boot also counts.
 */
function launchedAtLogin(): boolean {
  if (process.platform !== 'darwin' || !app.isPackaged) return false
  try {
    if (app.getLoginItemSettings().wasOpenedAtLogin) return true
  } catch {
    // Older or newer macOS may not report it.
  }
  return uptime() < 180
}

function resourcesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
}

const trayCache = new Map<string, Electron.NativeImage>()

/**
 * Loads both the 1x and @2x files explicitly, so Retina screens always get the
 * sharp @2x pixels instead of an upscaled 1x image.
 */
function trayImage(name: 'locked' | 'open' | 'attention'): Electron.NativeImage {
  const cached = trayCache.get(name)
  if (cached) return cached
  const base = { locked: 'trayTemplate', open: 'trayOpenTemplate', attention: 'trayAttentionTemplate' }[name]
  const img = nativeImage.createEmpty()
  for (const [scaleFactor, suffix] of [[1, ''], [2, '@2x']] as const) {
    const path = join(resourcesDir(), `${base}${suffix}.png`)
    if (existsSync(path)) img.addRepresentation({ scaleFactor, buffer: readFileSync(path) })
  }
  img.setTemplateImage(true)
  trayCache.set(name, img)
  return img
}

const platform: Platform = {
  touchIdAvailable: () => process.platform === 'darwin' && systemPreferences.canPromptTouchID() && safeStorage.isEncryptionAvailable(),
  promptTouchId: async (reason) => {
    try {
      await systemPreferences.promptTouchID(reason)
      return true
    } catch {
      return false
    }
  },
  notify: (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body, silent: false }).show()
  },
  idleSeconds: () => powerMonitor.getSystemIdleTime(),
  setOpenAtLogin: (enabled) => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled })
  },
  now: () => new Date()
}

app.whenReady().then(async () => {
  app.dock?.hide()

  // Our own windows never need camera, mic, location, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  const data = app.getPath('userData')
  const vault = new Vault(join(data, 'vault.json'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b)
  })
  const controller = new Controller(vault, new SettingsStore(join(data, 'settings.json')), new Runner(), platform)
  await controller.init()
  registerIpc(controller)

  const popover = createPopover(() => controller.state().run !== undefined)
  const tray = new Tray(trayImage('locked'))
  tray.setToolTip('StreamLock')

  const show = () => {
    positionUnder(popover, tray.getBounds())
    // A menu-bar-only app is not frontmost when opened from Finder; without
    // this the popover would lose focus and hide itself immediately.
    app.focus({ steal: true })
    popover.show()
    popover.focus()
  }
  const toggle = () => (popover.isVisible() ? popover.hide() : show())
  tray.on('click', toggle)
  tray.on('right-click', () =>
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open StreamLock', click: toggle },
        { label: 'Settings…', click: () => openSettings() },
        { label: 'Lock now', click: () => controller.lock() },
        { type: 'separator' },
        { label: 'Quit StreamLock', role: 'quit' }
      ])
    )
  )

  let wasRunning = false
  const refresh = () => {
    const s = controller.state()
    // Show the popover when a run starts so Done/Skip are in reach.
    if (s.run && !wasRunning && !popover.isVisible()) {
      positionUnder(popover, tray.getBounds())
      popover.showInactive()
    }
    wasRunning = !!s.run
    const attention = s.dueNow || s.run?.items.some((i) => i.status === 'needs-you')
    tray.setImage(trayImage(attention ? 'attention' : s.vault === 'unlocked' ? 'open' : 'locked'))
    for (const w of allUiWindows()) w.webContents.send('state', s)
  }
  controller.on('changed', refresh)
  refresh()

  // Opening StreamLock yourself (Applications, Spotlight, Finder, npm run dev)
  // shows the popover, so it is never invisible after launch. A launch at login
  // stays quiet unless setup is still needed.
  if (controller.state().vault === 'missing' || !launchedAtLogin()) show()

  const tick = () => void controller.tick().catch((e) => console.error('[streamlock] tick', e))
  setInterval(tick, TICK_MS)
  tick()
  powerMonitor.on('resume', tick)
  powerMonitor.on('suspend', () => controller.lock())
  powerMonitor.on('lock-screen', () => controller.lock())
  // Opening it again while it runs (or clicking it in Finder) shows the popover.
  app.on('second-instance', show)
  app.on('activate', show)
})

// Menu bar app: closing windows must not quit it.
app.on('window-all-closed', () => undefined)
