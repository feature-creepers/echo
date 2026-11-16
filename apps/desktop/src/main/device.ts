import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The identifier of this device, the same across launches. It is created the first time and kept
 * in the app's data folder: it belongs to the device, not to the user's content.
 */
export function deviceId(dataFolder: string): string {
  const file = join(dataFolder, 'device-id')
  try {
    const known = readFileSync(file, 'utf8').trim()
    if (known) return known
  } catch {
    // First launch: there is no file yet.
  }
  const created = randomUUID()
  mkdirSync(dataFolder, { recursive: true })
  writeFileSync(file, created + '\n')
  return created
}
