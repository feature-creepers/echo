import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, app, ipcMain, nativeTheme } from 'electron'
import { CORE_LINK_CHANNEL, CORE_MESSAGE_CHANNEL } from '../preload/bridge.ts'
import { startCore, type CoreProcess } from './core-process.ts'
import { deviceId } from './device.ts'
import { checkSettings } from './self-check.ts'

/**
 * The desktop app: a client of the core, on this device.
 *
 *   --self-check    start the core, connect to it, do what a first launch does, print the outcome as one line
 *                   and quit. Exit code 1 when something failed. No window is opened, and nothing of the
 *                   user's is read or written: the check runs in a folder of its own, removed afterwards.
 */
const selfChecking = process.argv.includes('--self-check')

/**
 * Where the app keeps what belongs to this device and to its user. Set before anything reads it.
 * A build run from the sources keeps its own, so trying a change never touches the installed app's data.
 */
const scratch = selfChecking ? mkdtempSync(join(tmpdir(), 'self-check-')) : undefined
if (scratch) app.setPath('userData', scratch)
else if (!app.isPackaged) app.setPath('userData', `${app.getPath('userData')} (development)`)

/** Built files sit next to this one: out/main/index.js, out/main/core.js, out/preload, out/renderer. */
const built = (path: string) => join(import.meta.dirname, path)

function openWindow(core: CoreProcess): BrowserWindow {
  const window = new BrowserWindow({
    title: app.getName(),
    width: 1320,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: '#07090c',
    autoHideMenuBar: true,
    webPreferences: { preload: built('../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  window.once('ready-to-show', () => window.show())
  // The title is the app's name, whatever the page says.
  window.on('page-title-updated', (event) => event.preventDefault())

  // The window shows the app's own page and nothing else: it never navigates away and never opens another.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const toWindow = (channel: string, payload: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  core.onLink((link) => toWindow(CORE_LINK_CHANNEL, link))
  core.onMessage((message) => toWindow(CORE_MESSAGE_CHANNEL, message))
  ipcMain.on(CORE_MESSAGE_CHANNEL, (event, message: unknown) => {
    if (event.sender === window.webContents) core.send(message)
  })

  // In development the page is served by the bundler, so a change shows without a rebuild.
  const served = process.env['ELECTRON_RENDERER_URL']
  if (served) void window.loadURL(served)
  else void window.loadFile(built('../renderer/index.html'))
  return window
}

async function selfCheck(core: CoreProcess): Promise<void> {
  const link = await core.settled()
  const settings = link.state === 'connected' ? await checkSettings(core) : 'not checked'
  const passed = link.state === 'connected' && settings === 'ok'
  process.stdout.write(JSON.stringify({ selfCheck: passed ? 'ok' : 'failed', link, settings }) + '\n')
  await core.stop()
  try {
    if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // A file still held by the system stays behind in the temporary folder. The check itself is not affected.
  }
  app.exit(passed ? 0 : 1)
}

function start(): void {
  // The interface is dark. The window's frame follows, whatever the system's own setting.
  nativeTheme.themeSource = 'dark'

  const data = app.getPath('userData')
  const core = startCore({
    script: built('core.js'),
    data: join(data, 'core'),
    client: { kind: 'desktop', version: app.getVersion(), device: deviceId(data) },
    capabilities: ['display']
  })
  ipcMain.handle(CORE_LINK_CHANNEL, () => core.link())

  // Quitting waits for the core to stop first, then goes ahead.
  let coreStopped = false
  app.on('before-quit', (event) => {
    if (coreStopped) return
    event.preventDefault()
    void core.stop().then(() => {
      coreStopped = true
      app.quit()
    })
  })

  if (selfChecking) {
    void selfCheck(core)
    return
  }

  const window = openWindow(core)
  app.on('second-instance', () => {
    if (window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.on('window-all-closed', () => app.quit())
}

// One core per data folder: a second launch hands over to the app already running and quits.
// A self-check has a folder of its own, so it runs beside the app without disturbing it.
if (!selfChecking && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Not awaited at the top level: Electron holds back its ready event until this module has finished
  // loading, so waiting for that event here would wait forever.
  void app.whenReady().then(start)
}
