import { join } from 'node:path'
import { BrowserWindow, app, ipcMain } from 'electron'
import { CORE_LINK_CHANNEL } from '../preload/bridge.ts'
import { startCore, type CoreProcess } from './core-process.ts'
import { deviceId } from './device.ts'

/**
 * The desktop app: a client of the core, on this device.
 *
 *   --self-check    start the core, connect to it, print the outcome as one line and quit.
 *                   Exit code 1 when the two could not connect. No window is opened.
 */
const selfChecking = process.argv.includes('--self-check')

/** Built files sit next to this one: out/main/index.js, out/main/core.js, out/preload, out/renderer. */
const built = (path: string) => join(import.meta.dirname, path)

function openWindow(core: CoreProcess): void {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    show: false,
    webPreferences: { preload: built('../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  window.once('ready-to-show', () => window.show())

  core.onLink((link) => {
    if (!window.isDestroyed()) window.webContents.send(CORE_LINK_CHANNEL, link)
  })

  // In development the page is served by the bundler, so a change shows without a rebuild.
  const served = process.env['ELECTRON_RENDERER_URL']
  if (served) void window.loadURL(served)
  else void window.loadFile(built('../renderer/index.html'))
}

async function selfCheck(core: CoreProcess): Promise<void> {
  const link = await core.settled()
  process.stdout.write(JSON.stringify({ selfCheck: link.state === 'connected' ? 'ok' : 'failed', link }) + '\n')
  await core.stop()
  app.exit(link.state === 'connected' ? 0 : 1)
}

function start(): void {
  const core = startCore({
    script: built('core.js'),
    client: { kind: 'desktop', version: app.getVersion(), device: deviceId(app.getPath('userData')) },
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
  } else {
    openWindow(core)
    app.on('window-all-closed', () => app.quit())
  }
}

// Not awaited at the top level: Electron holds back its ready event until this module has finished
// loading, so waiting for that event here would wait forever.
void app.whenReady().then(start)
