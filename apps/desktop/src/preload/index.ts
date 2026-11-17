import type { CoreLink } from '@repo/client'
import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import { CORE_LINK_CHANNEL, CORE_MESSAGE_CHANNEL, type DesktopBridge } from './bridge.ts'

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
  }
}

contextBridge.exposeInMainWorld('desktop', bridge)
