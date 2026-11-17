import type { CoreLink } from '@repo/client'
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import { CORE_LINK_CHANNEL, CORE_MESSAGE_CHANNEL, type DesktopBridge, SPEECH_CHANNELS, TALK_CHANNEL } from './bridge.ts'

/** The one listener for messages from the core, replaced each time the window opens a session. */
let onCoreMessage: (message: unknown) => void = () => undefined
ipcRenderer.on(CORE_MESSAGE_CHANNEL, (_event, message: unknown) => onCoreMessage(message))

const bridge: DesktopBridge = {
  coreLink: () => ipcRenderer.invoke(CORE_LINK_CHANNEL),
  onCoreLink: (listener) => {
    const handler = (_event: IpcRendererEvent, link: CoreLink) => listener(link)
    ipcRenderer.on(CORE_LINK_CHANNEL, handler)
    return () => ipcRenderer.removeListener(CORE_LINK_CHANNEL, handler)
  },
  core: {
    send: (message) => ipcRenderer.send(CORE_MESSAGE_CHANNEL, message),
    onMessage: (listener) => {
      onCoreMessage = listener
    }
  },
  onTalk: (listener) => {
    const handler = () => listener()
    ipcRenderer.on(TALK_CHANNEL, handler)
    return () => ipcRenderer.removeListener(TALK_CHANNEL, handler)
  },
  speech: {
    status: () => ipcRenderer.invoke(SPEECH_CHANNELS.status),
    async install(onProgress) {
      const handler = (_event: IpcRendererEvent, progress: Parameters<typeof onProgress>[0]) => onProgress(progress)
      ipcRenderer.on(SPEECH_CHANNELS.progress, handler)
      try {
        await ipcRenderer.invoke(SPEECH_CHANNELS.install)
      } finally {
        ipcRenderer.removeListener(SPEECH_CHANNELS.progress, handler)
      }
    },
    transcribe: (sound) => ipcRenderer.invoke(SPEECH_CHANNELS.transcribe, sound),
    speak: (text, how) => ipcRenderer.invoke(SPEECH_CHANNELS.speak, text, how),
    styles: () => ipcRenderer.invoke(SPEECH_CHANNELS.styles)
  }
}

contextBridge.exposeInMainWorld('desktop', bridge)
