import type { Client } from '@repo/client'
import { useMemo } from 'react'
import { useFileActions } from '../files/file-actions.ts'
import type { ViewActions } from '../view/context.ts'

/**
 * What the blocks of a view can do through the core: say something on the person's behalf, read the files, maps and
 * feeds they name, carry out a button, and open files on the computer. Nothing here starts playing by itself.
 */
export function useCoreViewActions(client: Client, say: (text: string) => void): ViewActions {
  const files = useFileActions()
  return useMemo(
    () => ({
      say,
      readFile: (file: string) => client.session.run('file.read', { file }),
      readShapes: (url: string) => client.session.run('shapes.read', { url }).then((read) => read.shapes),
      readFeed: (url: string) => client.session.run('feed.read', { url }).then((read) => read.document),
      act: (act: readonly Record<string, unknown>[]) => client.session.run('view.act', { act: [...act] }).then(() => undefined),
      files
    }),
    [say, client, files]
  )
}
