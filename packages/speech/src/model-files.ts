import { join } from 'node:path'
import { isInstalled, type ModelSet, modelSetFolder } from '@repo/models'
import { SpeechError } from './speech-error.ts'

/**
 * Where the files of an installed set are. Throws when the set is not installed, with a message that says
 * what is missing: an engine given a path to nothing would fail without saying why.
 */
export function installedFiles(folder: string, set: ModelSet): (path: string) => string {
  if (!isInstalled(folder, set)) throw new SpeechError('not-installed', `${set.name} is not downloaded yet.`)
  const directory = modelSetFolder(folder, set)
  return (path) => join(directory, path)
}

export interface EngineOptions {
  /** Where model sets are installed. */
  folder: string
  /** How many processor threads the engine may use. Left out: what suits this machine. */
  threads?: number
}
