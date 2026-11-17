import { mkdir } from 'node:fs/promises'
import type { Computer } from '@repo/core'
import { absolute, kindAt, real } from './paths.ts'

/**
 * This computer, as the core keeps what the user grants on it: the assistant's own folder, made when missing,
 * and what is at a path.
 */
export async function createComputer({ workspace }: { workspace: string }): Promise<Computer> {
  await mkdir(workspace, { recursive: true })
  return {
    workspace,
    async locate(path) {
      const found = await real(absolute(path, workspace))
      const kind = await kindAt(found)
      return kind === undefined ? undefined : { path: found, kind }
    }
  }
}
