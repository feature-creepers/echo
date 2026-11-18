import type { Client } from '@repo/client'
import { useEffect, useState } from 'react'

/** Where the assistant's folder is, asked once for each connection: paths in it are shown from it. */
const asked = new WeakMap<Client, Promise<string | undefined>>()

function folderOf(client: Client): Promise<string | undefined> {
  const known = asked.get(client)
  if (known) return known
  const asking = client.session.run('workspace.list', { path: '' }).then(
    ({ folder }) => folder.location,
    () => {
      // Asked again next time: the folder may be switched back on.
      asked.delete(client)
      return undefined
    }
  )
  asked.set(client, asking)
  return asking
}

/** The assistant's own folder on the core's computer, once known. */
export function useAssistantFolder(client: Client): string | undefined {
  const [folder, setFolder] = useState<string>()
  useEffect(() => {
    let live = true
    void folderOf(client).then((found) => live && setFolder(found))
    return () => {
      live = false
    }
  }, [client])
  return folder
}
