import { join } from 'node:path'
import { BrowserWindow, screen, shell, type Rectangle } from 'electron'

const isDev = !!process.env.ELECTRON_RENDERER_URL

/** Origin our own UI is served from; IPC from anywhere else is refused. */
export function isOwnUi(url: string | undefined): boolean {
  if (!url) return false
  if (isDev) return url.startsWith(process.env.ELECTRON_RENDERER_URL as string)
  return url.startsWith('file://') && url.includes('/renderer/index.html')
}

function hardened(win: BrowserWindow): BrowserWindow {
  const wc = win.webContents
  wc.on('will-navigate', (e, url) => {
    if (!isOwnUi(url)) e.preventDefault()
  })
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  return win
}

function load(win: BrowserWindow, view: 'popover' | 'settings'): void {
  if (isDev) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${view}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: view })
}

const webPreferences = () => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false
})

export const POPOVER_SIZE = { width: 380, height: 660 }

/**
 * @param keepOpen while true (an apply run is in progress) the popover stays
 *   visible on blur, so its Done button sits beside the service window.
 */
export function createPopover(keepOpen: () => boolean): BrowserWindow {
  const win = new BrowserWindow({
    ...POPOVER_SIZE,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#1C1C1E',
    roundedCorners: true,
    webPreferences: webPreferences()
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened() && !keepOpen()) win.hide()
  })
  load(hardened(win), 'popover')
  return win
}

/** Centers the popover under the tray icon, kept inside the display's work area. */
export function positionUnder(win: BrowserWindow, tray: Rectangle): void {
  const { width, height } = win.getBounds()
  // Menu bar icon hidden (e.g. behind the notch or turned off in System
  // Settings) reports no size: use the top-right corner of the main screen.
  if (tray.width <= 0 || tray.height <= 0) {
    const area = screen.getPrimaryDisplay().workArea
    win.setPosition(Math.round(area.x + area.width - width - 8), Math.round(area.y + 8), false)
    return
  }
  const area = screen.getDisplayMatching(tray).workArea
  const x = Math.round(Math.min(Math.max(tray.x + tray.width / 2 - width / 2, area.x + 8), area.x + area.width - width - 8))
  const y = Math.round(Math.min(tray.y + tray.height + 4, area.y + area.height - height))
  win.setPosition(x, y, false)
}

let settingsWindow: BrowserWindow | null = null

export function openSettings(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }
  const win = new BrowserWindow({
    width: 560,
    height: 700,
    minWidth: 480,
    minHeight: 560,
    title: 'StreamLock Settings',
    show: false,
    backgroundColor: '#1C1C1E',
    titleBarStyle: 'hiddenInset',
    webPreferences: webPreferences()
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => (settingsWindow = null))
  load(hardened(win), 'settings')
  settingsWindow = win
  return win
}

export function allUiWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && isOwnUi(w.webContents.getURL()))
}
