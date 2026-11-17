import { statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { Environment } from './environment.ts'
import { platform } from './platform/index.ts'

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false

/**
 * Where a program is on this machine: in a folder of the search path, else in one of the places it is
 * usually installed. An installer does not always add its folder to the search path.
 */
export function locate(program: string, env: Environment, usualLocations: string[]): string | undefined {
  const names = platform.fileNames(program, env)
  for (const folder of platform.searchPath(env).split(delimiter)) {
    if (folder === '') continue
    for (const name of names) {
      const candidate = join(folder, name)
      if (isFile(candidate)) return candidate
    }
  }
  return usualLocations.find(isFile)
}
