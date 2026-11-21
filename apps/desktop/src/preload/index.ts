import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron'
import { APP_CHANNELS, CAMERA_CHANNELS, CORE_LINK_CHANNEL, CORE_MESSAGE_CHANNEL, type DesktopBridge, SPEECH_CHANNELS, TALK_CHANNEL } from './bridge.ts'

/** Be told of what comes on a channel. Returns a function that stops the telling. */
function listen<Payload>(channel: string, listener: (payload: Payload) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: Payload) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/** Who listens to the computer's load: the app reads it only while someone does. */
const loadListeners = new Set<(load: number) => void>()
ipcRenderer.on(APP_CHANNELS.load, (_event, load: unknown) => {
  if (typeof load === 'number') for (const listener of loadListeners) listener(load)
})

/** The one listener for messages from the core, replaced each time the window opens a session. */
let onCoreMessage: (message: unknown) => void = () => undefined
ipcRenderer.on(CORE_MESSAGE_CHANNEL, (_event, message: unknown) => onCoreMessage(message))

const bridge: DesktopBridge = {
  coreLink: () => ipcRenderer.invoke(CORE_LINK_CHANNEL),
  onCoreLink: (listener) => listen(CORE_LINK_CHANNEL, listener),
  core: {
    send: (message) => ipcRenderer.send(CORE_MESSAGE_CHANNEL, message),
    onMessage: (listener) => {
      onCoreMessage = listener
    }
  },
  onTalk: (listener) => listen(TALK_CHANNEL, () => listener()),
  onOpenSettings: (listener) => listen(APP_CHANNELS.openSettings, () => listener()),
  device: {
    read: () => ipcRenderer.invoke(APP_CHANNELS.deviceRead),
    change: (change) => ipcRenderer.invoke(APP_CHANNELS.deviceChange, change),
    onChange: (listener) => listen(APP_CHANNELS.deviceChanged, listener),
    setShortcut: (name, accelerator) => ipcRenderer.invoke(APP_CHANNELS.shortcutSet, name, accelerator),
    suspendShortcuts: (suspended) => ipcRenderer.send(APP_CHANNELS.shortcutsSuspend, suspended),
    shortcutProblems: () => ipcRenderer.invoke(APP_CHANNELS.shortcutProblems)
  },
  app: {
    about: () => ipcRenderer.invoke(APP_CHANNELS.about),
    openDataFolder: () => ipcRenderer.invoke(APP_CHANNELS.openDataFolder),
    openReleases: () => ipcRenderer.invoke(APP_CHANNELS.openReleases),
    showPresence: (presence) => ipcRenderer.send(APP_CHANNELS.presence, presence),
    onLoad: (listener) => {
      loadListeners.add(listener)
      if (loadListeners.size === 1) ipcRenderer.send(APP_CHANNELS.loadFollow, true)
      return () => {
        if (loadListeners.delete(listener) && loadListeners.size === 0) ipcRenderer.send(APP_CHANNELS.loadFollow, false)
      }
    }
  },
  updates: {
    state: () => ipcRenderer.invoke(APP_CHANNELS.updateState),
    onState: (listener) => listen(APP_CHANNELS.updateChanged, listener),
    check: () => ipcRenderer.invoke(APP_CHANNELS.updateCheck),
    download: () => ipcRenderer.invoke(APP_CHANNELS.updateDownload),
    install: () => ipcRenderer.invoke(APP_CHANNELS.updateInstall)
  },
  mini: {
    read: () => ipcRenderer.invoke(APP_CHANNELS.mini),
    set: (on) => ipcRenderer.send(APP_CHANNELS.miniSet, on),
    onChange: (listener) => listen(APP_CHANNELS.miniChanged, listener)
  },
  widgets: {
    frame: (page, policy) => ipcRenderer.invoke(APP_CHANNELS.widgetFrame, page, policy)
  },
  camera: {
    onCapture: (listener) => listen(CAMERA_CHANNELS.capture, listener),
    answer: (answer) => ipcRenderer.send(CAMERA_CHANNELS.picture, answer)
  },
  files: {
    pick: (kind, purpose) => ipcRenderer.invoke(APP_CHANNELS.filesPick, kind, purpose),
    reveal: (path) => ipcRenderer.invoke(APP_CHANNELS.filesReveal, path),
    open: (path) => ipcRenderer.invoke(APP_CHANNELS.filesOpen, path),
    // Only the preload can ask where a dropped file is: the window itself is never told a path it was not given.
    pathOf: (file) => webUtils.getPathForFile(file) || undefined,
    // Only Linux's file managers copy files as their addresses; elsewhere the window is given them on paste.
    ...(process.platform === 'linux' ? { takeCopied: () => ipcRenderer.invoke(APP_CHANNELS.filesTakeCopied) } : {})
  },
  speech: {
    status: () => ipcRenderer.invoke(SPEECH_CHANNELS.status),
    async install(onProgress) {
      const stop = listen(SPEECH_CHANNELS.progress, onProgress)
      try {
        await ipcRenderer.invoke(SPEECH_CHANNELS.install)
      } finally {
        stop()
      }
    },
    transcribe: (sound, words) => ipcRenderer.invoke(SPEECH_CHANNELS.transcribe, sound, words === undefined ? [] : [...words]),
    speak: (text, how) => ipcRenderer.invoke(SPEECH_CHANNELS.speak, text, how),
    styles: () => ipcRenderer.invoke(SPEECH_CHANNELS.styles)
  }
}

contextBridge.exposeInMainWorld('desktop', bridge)
