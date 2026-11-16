import type { CoreLink } from '@repo/client'
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CORE_LINK_CHANNEL, type DesktopBridge } from './bridge.ts'

const bridge: DesktopBridge = {
  coreLink: () => ipcRenderer.invoke(CORE_LINK_CHANNEL),
  onCoreLink: (listener) => {
    const handler = (_event: IpcRendererEvent, link: CoreLink) => listener(link)
    ipcRenderer.on(CORE_LINK_CHANNEL, handler)
    return () => ipcRenderer.removeListener(CORE_LINK_CHANNEL, handler)
  }
}

contextBridge.exposeInMainWorld('desktop', bridge)
