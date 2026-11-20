import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import {
  type DeviceSettingsChange,
  GLOBAL_SHORTCUTS,
  type GlobalShortcutName,
  isGlobalShortcut,
  isShortcut,
  runsWhenOpened,
  type ShortcutName,
  shortcutClash
} from '@repo/client'
import { type AccentName, accents, color, frame } from '@repo/tokens'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  nativeImage,
  nativeTheme,
  type OpenDialogOptions,
  session,
  shell,
  type WebContents
} from 'electron'
import {
  type About,
  APP_CHANNELS,
  type BridgeSound,
  CORE_LINK_CHANNEL,
  CORE_MESSAGE_CHANNEL,
  type ShortcutChange,
  SPEECH_CHANNELS,
  TALK_CHANNEL
} from '../preload/bridge.ts'
import { setLaunchAtLogin, startedAtLogin } from './autostart/index.ts'
import { serveCamera } from './camera.ts'
import { chrome } from './chrome/index.ts'
import { copiedLists, copiedPaths, readCopied } from './copied-files.ts'
import { type CoreProcess, startCore } from './core-process.ts'
import { serveDesktopMarker } from './desktop-marker.ts'
import { deviceId } from './device.ts'
import { openDeviceSettings } from './device-settings.ts'
import { createGlobalShortcuts } from './global-shortcut.ts'
import { followLoad } from './load/index.ts'
import { appIcon } from './mark.ts'
import { createMini } from './mini/index.ts'
import { serveNotifications } from './notifications.ts'
import { checkSettings } from './self-check.ts'
import { type SpeechProcess, startSpeech } from './speech-process.ts'
import { createTray, type TrayActions, type TrayLook } from './tray.ts'
import { createUpdater, releasesPage } from './updater.ts'

/**
 * The desktop app: a client of the core, on this device.
 *
 *   --talk          when the app is already running: bring it forward and start listening.
 *   --stop-everything
 *                   when the app is already running: stop everything the assistant does, as the tray's menu does.
 *                   Started with it and not running, the app has nothing to stop, and quits at once.
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

/**
 * The system's picker for each purpose: several folders or files to give access to (what any other purpose falls
 * back to), the one folder a project works in, the proof of concept's folder to import, or one folder to hand over
 * with what is said.
 */
function pickerFor(kind: 'folder' | 'file', purpose: unknown): OpenDialogOptions {
  switch (purpose) {
    case 'project':
      return { title: 'Open a project', buttonLabel: 'Open', properties: ['openDirectory'] }
    case 'import':
      return { title: "Choose the proof of concept's folder", buttonLabel: 'Import', properties: ['openDirectory'] }
    case 'attach':
      return { title: 'Hand over a folder', buttonLabel: 'Attach', properties: ['openDirectory'] }
    default:
      return {
        title: kind === 'folder' ? 'Give access to folders' : 'Give access to files',
        buttonLabel: 'Give access',
        properties: [kind === 'folder' ? 'openDirectory' : 'openFile', 'multiSelections']
      }
  }
}

/** Started with this while running, the app starts listening: what a desktop shortcut runs where global shortcuts are refused. */
const TALK_FLAG = '--talk'
/** Started with this while running, the app stops everything: the same, for the shortcut that stops. */
const STOP_FLAG = '--stop-everything'

/**
 * The app's identity for Windows, the one its installer gives the shortcuts it makes (the `appId` of
 * build/electron-builder.yml). Said by the app too, its window is the shortcut's on the taskbar, with its icon.
 */
const WINDOWS_APP_ID = 'io.github.feature-creepers.echo'

/** The file of this device's settings, in the app's data folder. */
const DEVICE_SETTINGS_FILE = 'settings.json'

/** Built files sit next to this one: out/main/index.js, out/main/core.js, out/preload, out/renderer. */
const built = (path: string) => join(import.meta.dirname, path)

/** The smallest the full window may be made, in pixels. */
const FULL_LEAST = { width: 720, height: 560 } as const

function openWindow(visible: boolean): BrowserWindow {
  // The system's buttons take the soft text colour of the row's own buttons, on no ground of their own.
  const look = chrome({ symbols: color.textSoft, height: frame.titleBar })
  const window = new BrowserWindow({
    title: app.getName(),
    width: 1320,
    height: 860,
    minWidth: FULL_LEAST.width,
    minHeight: FULL_LEAST.height,
    show: false,
    backgroundColor: color.ground,
    autoHideMenuBar: true,
    // Windows and macOS show the icon the package carries; a Linux desktop shows the one the window gives.
    ...(process.platform === 'linux' ? { icon: nativeImage.createFromBuffer(appIcon(256, 'round')) } : {}),
    // No title bar above the page: the page's own title row is the bar, with the system's buttons drawn over it.
    ...look.options,
    webPreferences: { preload: built('../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  window.once('ready-to-show', () => {
    if (visible) window.show()
  })
  // The title is the app's name, whatever the page says.
  window.on('page-title-updated', (event) => event.preventDefault())

  // The window shows the app's own page and nothing else: it never navigates away and never opens another. A link
  // to a web page opens in the user's own browser instead; anything else a link names, a file or a program, is refused.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebPage(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // In development the page is served by the bundler, so a change shows without a rebuild.
  // The page is told whether the system draws a material behind it, so it can let it through.
  const query = look.vibrant ? { material: 'vibrant' } : {}
  const served = process.env.ELECTRON_RENDERER_URL
  if (served) void window.loadURL(`${served}?${new URLSearchParams(query)}`)
  else void window.loadFile(built('../renderer/index.html'), { query })
  return window
}

/** The window's calls, each answered only when it comes from the window's page: no other page may ask the app anything. */
interface WindowCalls {
  handle(channel: string, answer: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void
  on(channel: string, hear: (event: IpcMainEvent, ...args: unknown[]) => void): void
}

function windowCalls(window: BrowserWindow): WindowCalls {
  const fromWindow = (event: IpcMainEvent | IpcMainInvokeEvent) => !window.isDestroyed() && event.sender === window.webContents
  return {
    handle: (channel, answer) => ipcMain.handle(channel, (event, ...args) => (fromWindow(event) ? answer(event, ...args) : undefined)),
    on: (channel, hear) =>
      ipcMain.on(channel, (event, ...args) => {
        if (fromWindow(event)) hear(event, ...args)
      })
  }
}

/** What the tray shows of the assistant, from what the window says of it. */
function trayLook(presence: unknown): TrayLook {
  const { accent, mood } = typeof presence === 'object' && presence !== null ? (presence as Record<string, unknown>) : {}
  return {
    accent: typeof accent === 'string' && Object.hasOwn(accents, accent) ? (accent as AccentName) : undefined,
    state: mood === 'listening' ? 'listening' : mood === 'asleep' ? 'asleep' : 'awake'
  }
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

/**
 * Answer the window's speech calls with the engines' process. Errors cross as their message, written for the user;
 * what the window sends is checked by the speech service itself.
 */
function serveSpeech(speech: SpeechProcess, calls: WindowCalls): void {
  const { service } = speech
  calls.handle(SPEECH_CHANNELS.status, () => service.status())
  calls.handle(SPEECH_CHANNELS.install, (event) => service.install((progress) => event.sender.send(SPEECH_CHANNELS.progress, progress)))
  calls.handle(SPEECH_CHANNELS.transcribe, (_event, sound, words) => {
    const { sampleRate, samples } = sound as BridgeSound
    return service.transcribe(
      { sampleRate, samples: new Float32Array(samples) },
      // The person's own words, as their settings keep them: anything else the window sends is not taken.
      { words: Array.isArray(words) ? words.filter((word): word is string => typeof word === 'string') : [] }
    )
  })
  calls.handle(SPEECH_CHANNELS.speak, (_event, text, how) => service.speak(text as string, how as { style: string; language: string; speed?: number }))
  calls.handle(SPEECH_CHANNELS.styles, () => service.styles())
  // Load the engines while the user looks at the window, so the first sentence does not wait for them.
  void service
    .status()
    .then((status) => (status.ready ? service.warmUp() : undefined))
    .catch(() => undefined)
}

function start(): void {
  if (process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_ID)
  // The interface is dark. The window's frame follows, whatever the system's own setting.
  nativeTheme.themeSource = 'dark'
  // The window may use the microphone, to hear the user, choose the speakers its voice plays on, and put text on the
  // clipboard when the user copies an answer; it never reads the clipboard, and nothing else of the kind. The camera
  // only while the core waits for a picture the person allowed on a card, and only in the window.
  const allowed = new Set(['media', 'speaker-selection', 'clipboard-sanitized-write'])
  let cameraAllows: (contents: WebContents | null) => boolean = () => false
  session.defaultSession.setPermissionRequestHandler((contents, permission, grant, details) => {
    if (!allowed.has(permission)) return grant(false)
    const video = permission === 'media' && 'mediaTypes' in details && (details.mediaTypes ?? []).includes('video')
    grant(!video || cameraAllows(contents))
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (!allowed.has(permission)) return false
    return permission !== 'media' || details.mediaType !== 'video' || cameraAllows(contents)
  })

  const data = app.getPath('userData')
  const core = startCore({
    script: built('core.js'),
    data: join(data, 'core'),
    client: { kind: 'desktop', version: app.getVersion(), device: deviceId(data) },
    capabilities: ['display', 'notify', 'screen', 'camera']
  })

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

  const speech = startSpeech(built('speech.js'), join(data, 'models'))
  const device = openDeviceSettings(join(data, DEVICE_SETTINGS_FILE))
  const settings = device.read()
  // Started at login, or set to start out of sight: the app waits in the tray for its shortcut.
  const hidden = startedAtLogin() || settings.app.startHidden
  const window = openWindow(!hidden)
  const calls = windowCalls(window)
  const toWindow = (channel: string, payload?: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }

  // The window's session with the core: the app passes the messages on unread, both ways.
  core.onLink((link) => toWindow(CORE_LINK_CHANNEL, link))
  core.onMessage((message) => toWindow(CORE_MESSAGE_CHANNEL, message))
  calls.handle(CORE_LINK_CHANNEL, () => core.link())
  calls.on(CORE_MESSAGE_CHANNEL, (_event, message) => core.send(message))
  serveSpeech(speech, calls)

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
  // Mini: the window made small and kept over the other apps, from its key, the tray and its button. What needs more
  // room than Mini has goes back to the full window first: the settings, a notification pressed.
  const mini = createMini(window, device, FULL_LEAST)
  const toFullWindow = () => {
    mini.set(false)
    bringForward()
  }
  calls.handle(APP_CHANNELS.mini, () => mini.on())
  calls.on(APP_CHANNELS.miniSet, (_event, on) => mini.set(on === true))
  // Reminders, scheduled answers and answers finished out of sight, as the system's notifications.
  serveNotifications(core, window, toFullWindow)
  // A frame around the window of another app the assistant operates, while it does.
  const marker = serveDesktopMarker(core)
  // A picture the person allowed, taken in the window, with a marker on the screen while the camera is on.
  const camera = serveCamera(core, window)
  cameraAllows = (contents) => contents !== null && camera.allows(contents)

  // Straight to the core, as any client asks it: it works with the window closed. Its result goes unread.
  const stopEverything = () => core.send({ type: 'command', id: `stop-${Date.now()}`, name: 'everything.stop', input: {} })

  // From anywhere: talking brings the window forward and starts listening, and pressed again, sends; stopping
  // stops everything. Some Linux desktops (Wayland) do not let an app take a global shortcut: the key inside the
  // window remains for talking, and the app's options for both.
  const shortcuts = createGlobalShortcuts<GlobalShortcutName>({ talk, stopEverything })
  const shortcutProblems: Partial<Record<GlobalShortcutName, string>> = {}
  for (const name of GLOBAL_SHORTCUTS) {
    const taken = shortcuts.take(name, settings.shortcuts[name])
    if (!taken.ok) shortcutProblems[name] = taken.problem
  }
  const trayKeys = () => ({ talk: shortcuts.current('talk'), stopEverything: shortcuts.current('stopEverything') })

  const updater = createUpdater(settings.updates.automatic)
  const trayActions = (): TrayActions => ({
    show: bringForward,
    mini: {
      on: mini.on(),
      toggle: () => {
        mini.set(!mini.on())
        bringForward()
      }
    },
    talk,
    stopEverything,
    settings: () => {
      toFullWindow()
      toWindow(APP_CHANNELS.openSettings)
    },
    quit: () => app.quit(),
    restartToUpdate: updater.state().is === 'ready' ? () => updater.install() : undefined
  })
  const tray = createTray(trayKeys(), trayActions())
  mini.onChange((on) => {
    toWindow(APP_CHANNELS.miniChanged, on)
    tray.refresh(trayKeys(), trayActions())
  })

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
    tray.refresh(trayKeys(), trayActions())
  })
  updater.onState((state) => {
    toWindow(APP_CHANNELS.updateChanged, state)
    tray.refresh(trayKeys(), trayActions())
  })

  calls.handle(APP_CHANNELS.deviceRead, () => device.read())
  // Shortcuts change only through their own call, which checks them first, and Mini's bounds as the window is moved. The
  // rest is read back into usable settings.
  calls.handle(APP_CHANNELS.deviceChange, (_event, change) => device.change({ ...(change as DeviceSettingsChange), shortcuts: {}, window: {} }))
  calls.handle(APP_CHANNELS.shortcutSet, (_event, name, accelerator): ShortcutChange => {
    if (typeof name !== 'string' || !Object.hasOwn(device.read().shortcuts, name)) return { ok: false, problem: 'There is no such shortcut.' }
    if (typeof accelerator !== 'string' || (accelerator !== '' && !isShortcut(accelerator)))
      return { ok: false, problem: 'These keys cannot be used as a shortcut.' }
    const shortcut = name as ShortcutName
    const clash = shortcutClash(device.read().shortcuts, shortcut, accelerator, process.platform === 'darwin')
    if (clash) return { ok: false, problem: clash }
    if (isGlobalShortcut(shortcut)) {
      const tried = shortcuts.take(shortcut, accelerator)
      if (!tried.ok) return tried
      delete shortcutProblems[shortcut]
    }
    return { ok: true, settings: device.change({ shortcuts: { [shortcut]: accelerator } }) }
  })
  calls.on(APP_CHANNELS.shortcutsSuspend, (_event, suspended) => shortcuts.suspend(suspended === true))
  calls.handle(APP_CHANNELS.shortcutProblems, () => ({ ...shortcutProblems }))
  // The tray's mark shows the persona's accent, and whether the assistant listens or sleeps. Whatever else the
  // window says is ignored: the mark changes only between the looks it has.
  calls.on(APP_CHANNELS.presence, (_event, presence) => {
    const look = trayLook(presence)
    tray.look(look)
    marker.accent(look.accent)
    camera.accent(look.accent)
  })
  // How hard the computer works, for the window's core: read only while the window asks for it and is seen.
  const load = followLoad(() => !window.isDestroyed() && window.isVisible() && !window.isMinimized())
  calls.on(APP_CHANNELS.loadFollow, (_event, on) => {
    if (on === true) load.start((value) => toWindow(APP_CHANNELS.load, value))
    else load.stop()
  })
  window.webContents.on('render-process-gone', () => load.stop())
  calls.handle(
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
  calls.handle(APP_CHANNELS.openDataFolder, async () => void (await shell.openPath(data)))
  calls.handle(APP_CHANNELS.openReleases, async () => {
    const page = releasesPage()
    if (page) await shell.openExternal(page)
  })
  // Folders and files for the assistant are picked by the user in the system's own picker, never typed by the window.
  calls.handle(APP_CHANNELS.filesPick, async (_event, kind, purpose) => {
    if (kind !== 'folder' && kind !== 'file') return []
    const picked = await dialog.showOpenDialog(window, pickerFor(kind, purpose))
    return picked.canceled ? [] : picked.filePaths
  })
  // Shown in its folder, never opened: opening a file could run it.
  calls.handle(APP_CHANNELS.filesReveal, (_event, path) => {
    if (typeof path === 'string' && isAbsolute(path)) shell.showItemInFolder(path)
  })
  // Opened with the app the system gives its kind, or a folder in the file manager. What would run a program when
  // opened is shown in its folder instead, so a file the assistant wrote never runs by a click.
  calls.handle(APP_CHANNELS.filesOpen, async (_event, path) => {
    if (typeof path !== 'string' || !isAbsolute(path)) return
    if (runsWhenOpened(basename(path))) return shell.showItemInFolder(path)
    const problem = await shell.openPath(path)
    if (problem !== '') shell.showItemInFolder(path)
  })
  // Files copied in a Linux file manager, which puts their addresses on the clipboard: read as the person pastes, and
  // only those the clipboard names.
  calls.handle(APP_CHANNELS.filesTakeCopied, async () =>
    process.platform === 'linux' ? readCopied(copiedPaths(await copiedLists(await clipboard.read()))) : { files: [], folders: [], tooLarge: [], more: 0 }
  )
  calls.handle(APP_CHANNELS.updateState, () => updater.state())
  calls.handle(APP_CHANNELS.updateCheck, () => updater.check())
  calls.handle(APP_CHANNELS.updateDownload, () => updater.download())
  calls.handle(APP_CHANNELS.updateInstall, () => {
    quitting = true
    updater.install()
  })

  app.on('will-quit', () => {
    load.stop()
    speech.stop()
    shortcuts.release()
    tray.destroy()
  })
  // Launched again while running: the app already running comes forward, and with --talk, listens; with
  // --stop-everything, it stops everything and stays where it is. A desktop shortcut bound to one of these stands
  // in for a global shortcut where the system refuses one (Wayland).
  app.on('second-instance', (_event, argv) => {
    if (argv.includes(STOP_FLAG)) stopEverything()
    else if (argv.includes(TALK_FLAG)) talk()
    else bringForward()
  })
  // macOS: a click on the Dock icon brings the window back.
  app.on('activate', bringForward)
  app.on('window-all-closed', () => app.quit())
}

// One core per data folder: a second launch hands over to the app already running and quits.
// A self-check has a folder of its own, so it runs beside the app without disturbing it.
if (!selfChecking && !app.requestSingleInstanceLock()) {
  app.quit()
} else if (!selfChecking && process.argv.includes(STOP_FLAG)) {
  // Nothing runs to be stopped: the shortcut that stops never starts the app.
  app.quit()
} else {
  // Not awaited at the top level: Electron holds back its ready event until this module has finished
  // loading, so waiting for that event here would wait forever.
  void app.whenReady().then(start)
}

/** A secure web page's address, which the user's browser may open: never a file, a program or another scheme. */
function isWebPage(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
