import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DeviceSettingsChange, isShortcut, shortcutClash } from '@repo/client'
import { color, frame } from '@repo/tokens'
import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from 'electron'
import {
  type About,
  APP_CHANNELS,
  type BridgeSound,
  CORE_LINK_CHANNEL,
  CORE_MESSAGE_CHANNEL,
  type ShortcutChange,
  type ShortcutName,
  SPEECH_CHANNELS,
  TALK_CHANNEL
} from '../preload/bridge.ts'
import { setLaunchAtLogin, startedAtLogin } from './autostart/index.ts'
import { chrome } from './chrome/index.ts'
import { type CoreProcess, startCore } from './core-process.ts'
import { deviceId } from './device.ts'
import { openDeviceSettings } from './device-settings.ts'
import { createGlobalShortcut } from './global-shortcut.ts'
import { checkSettings } from './self-check.ts'
import { type SpeechProcess, startSpeech } from './speech-process.ts'
import { createTray, type TrayActions } from './tray.ts'
import { createUpdater, releasesPage } from './updater.ts'

/**
 * The desktop app: a client of the core, on this device.
 *
 *   --talk          when the app is already running: bring it forward and start listening.
 *   --hidden        start out of sight, in the tray, ready for the shortcut: how the app starts at login.
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

/** Started with this while running, the app starts listening: what a desktop shortcut runs where global shortcuts are refused. */
const TALK_FLAG = '--talk'

/** The file of this device's settings, in the app's data folder. */
const DEVICE_SETTINGS_FILE = 'settings.json'

/** Built files sit next to this one: out/main/index.js, out/main/core.js, out/preload, out/renderer. */
const built = (path: string) => join(import.meta.dirname, path)

function openWindow(core: CoreProcess, visible: boolean): BrowserWindow {
  const look = chrome({ background: color.ground, symbols: color.text, height: frame.titleBar })
  const window = new BrowserWindow({
    title: app.getName(),
    width: 1320,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: color.ground,
    autoHideMenuBar: true,
    // No title bar above the page: the page's own title row is the bar, with the system's buttons drawn over it.
    ...look.options,
    webPreferences: { preload: built('../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  window.once('ready-to-show', () => {
    if (visible) window.show()
  })
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
  // The page is told whether the system draws a material behind it, so it can let it through.
  const query = look.vibrant ? { material: 'vibrant' } : {}
  const served = process.env.ELECTRON_RENDERER_URL
  if (served) void window.loadURL(`${served}?${new URLSearchParams(query)}`)
  else void window.loadFile(built('../renderer/index.html'), { query })
  return window
}

async function selfCheck(core: CoreProcess): Promise<void> {
  const link = await core.settled()
  const settings = link.state === 'connected' ? await checkSettings(core) : 'not checked'
  const passed = link.state === 'connected' && settings === 'ok'
  process.stdout.write(`${JSON.stringify({ selfCheck: passed ? 'ok' : 'failed', link, settings })}\n`)
  await core.stop()
  try {
    if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // A file still held by the system stays behind in the temporary folder. The check itself is not affected.
  }
  app.exit(passed ? 0 : 1)
}

/** Answer the window's speech calls with the engines' process. Errors cross as their message, written for the user. */
function serveSpeech(speech: SpeechProcess): void {
  const { service } = speech
  ipcMain.handle(SPEECH_CHANNELS.status, () => service.status())
  ipcMain.handle(SPEECH_CHANNELS.install, (event) => service.install((progress) => event.sender.send(SPEECH_CHANNELS.progress, progress)))
  ipcMain.handle(SPEECH_CHANNELS.transcribe, (_event, sound: BridgeSound) =>
    service.transcribe({ sampleRate: sound.sampleRate, samples: new Float32Array(sound.samples) })
  )
  ipcMain.handle(SPEECH_CHANNELS.speak, (_event, text: string, how: { style: string; language: string; speed?: number }) => service.speak(text, how))
  ipcMain.handle(SPEECH_CHANNELS.styles, () => service.styles())
  // Load the engines while the user looks at the window, so the first sentence does not wait for them.
  void service
    .status()
    .then((status) => (status.ready ? service.warmUp() : undefined))
    .catch(() => undefined)
  app.on('will-quit', () => speech.stop())
}

function start(): void {
  // The interface is dark. The window's frame follows, whatever the system's own setting.
  nativeTheme.themeSource = 'dark'
  // The window may use the microphone, to hear the user, and choose the speakers its voice plays on, and nothing else of the kind.
  const allowed = new Set(['media', 'speaker-selection'])
  session.defaultSession.setPermissionRequestHandler((_contents, permission, grant) => grant(allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission))

  const data = app.getPath('userData')
  const core = startCore({
    script: built('core.js'),
    data: join(data, 'core'),
    client: { kind: 'desktop', version: app.getVersion(), device: deviceId(data) },
    capabilities: ['display']
  })
  ipcMain.handle(CORE_LINK_CHANNEL, () => core.link())

  if (!selfChecking) serveSpeech(startSpeech(built('speech.js'), join(data, 'models')))

  // Quitting waits for the core to stop first, then goes ahead.
  let coreStopped = false
  let quitting = false
  app.on('before-quit', (event) => {
    quitting = true
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

  const device = openDeviceSettings(join(data, DEVICE_SETTINGS_FILE))
  const settings = device.read()
  // Started at login, or set to start out of sight: the app waits in the tray for its shortcut.
  const hidden = startedAtLogin() || settings.app.startHidden
  const window = openWindow(core, !hidden)
  const toWindow = (channel: string, payload?: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  const bringForward = () => {
    if (window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  const talk = () => {
    bringForward()
    toWindow(TALK_CHANNEL)
  }

  // Talk from anywhere: the shortcut brings the window forward and starts listening, and pressed again, sends.
  // Some Linux desktops (Wayland) do not let an app take a global shortcut: the one inside the window remains.
  const shortcut = createGlobalShortcut(talk)
  const taken = shortcut.take(settings.shortcuts.talk)
  let shortcutProblem = taken.ok ? undefined : taken.problem

  const updater = createUpdater(settings.updates.automatic)
  const trayActions = (): TrayActions => ({
    show: bringForward,
    talk,
    settings: () => {
      bringForward()
      toWindow(APP_CHANNELS.openSettings)
    },
    quit: () => app.quit(),
    restartToUpdate: updater.state().is === 'ready' ? () => updater.install() : undefined
  })
  const tray = createTray(shortcut.current(), trayActions())

  // Closing the window leaves the app in the tray, ready for its shortcut, unless the user wants it to quit.
  window.on('close', (event) => {
    if (quitting || !device.read().app.closeToTray) return
    event.preventDefault()
    window.hide()
  })

  setLaunchAtLogin(settings.app.launchAtLogin)
  device.onChange((next, before) => {
    toWindow(APP_CHANNELS.deviceChanged, next)
    if (next.app.launchAtLogin !== before.app.launchAtLogin) setLaunchAtLogin(next.app.launchAtLogin)
    if (next.updates.automatic !== before.updates.automatic) updater.setAutomatic(next.updates.automatic)
    tray.refresh(shortcut.current(), trayActions())
  })
  updater.onState((state) => {
    toWindow(APP_CHANNELS.updateChanged, state)
    tray.refresh(shortcut.current(), trayActions())
  })

  ipcMain.handle(APP_CHANNELS.deviceRead, () => device.read())
  // Shortcuts change only through their own call, which checks them first.
  ipcMain.handle(APP_CHANNELS.deviceChange, (_event, change: DeviceSettingsChange) => device.change({ ...change, shortcuts: {} }))
  ipcMain.handle(APP_CHANNELS.shortcutSet, (_event, name: ShortcutName, accelerator: string): ShortcutChange => {
    if (!Object.hasOwn(device.read().shortcuts, name)) return { ok: false, problem: 'There is no such shortcut.' }
    if (accelerator !== '' && !isShortcut(accelerator)) return { ok: false, problem: 'These keys cannot be used as a shortcut.' }
    const clash = shortcutClash(device.read().shortcuts, name, accelerator, process.platform === 'darwin')
    if (clash) return { ok: false, problem: clash }
    if (name === 'talk') {
      const tried = shortcut.take(accelerator)
      if (!tried.ok) return tried
      shortcutProblem = undefined
    }
    return { ok: true, settings: device.change({ shortcuts: { [name]: accelerator } }) }
  })
  ipcMain.on(APP_CHANNELS.shortcutsSuspend, (_event, suspended: boolean) => shortcut.suspend(suspended === true))
  ipcMain.handle(APP_CHANNELS.shortcutProblem, () => shortcutProblem)
  ipcMain.handle(
    APP_CHANNELS.about,
    (): About => ({
      name: app.getName(),
      version: app.getVersion(),
      system: process.platform,
      electron: process.versions.electron,
      dataFolder: data,
      ...(releasesPage() ? { releases: true } : {})
    })
  )
  ipcMain.handle(APP_CHANNELS.openDataFolder, async () => void (await shell.openPath(data)))
  ipcMain.handle(APP_CHANNELS.openReleases, async () => {
    const page = releasesPage()
    if (page) await shell.openExternal(page)
  })
  ipcMain.handle(APP_CHANNELS.updateState, () => updater.state())
  ipcMain.handle(APP_CHANNELS.updateCheck, () => updater.check())
  ipcMain.handle(APP_CHANNELS.updateDownload, () => updater.download())
  ipcMain.handle(APP_CHANNELS.updateInstall, () => {
    quitting = true
    updater.install()
  })

  app.on('will-quit', () => {
    shortcut.release()
    tray.destroy()
  })
  // Launched again while running: the app already running comes forward, and with --talk, listens. A desktop
  // shortcut bound to that command stands in for a global shortcut where the system refuses one (Wayland).
  app.on('second-instance', (_event, argv) => (argv.includes(TALK_FLAG) ? talk() : bringForward()))
  // macOS: a click on the Dock icon brings the window back.
  app.on('activate', bringForward)
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
