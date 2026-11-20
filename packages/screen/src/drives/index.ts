import { readdir } from 'node:fs/promises'
import { posix } from 'node:path'
import type { Drive, Drives } from '@repo/core'
import { firstError, readPowershellJson, runProgram } from '../program.ts'
import { type SystemName, THIS_SYSTEM } from '../system-name.ts'
import * as darwin from './darwin.ts'
import * as linux from './linux.ts'
import * as win32 from './win32.ts'

/** How long a system may take to list its drives, or to let one go, in milliseconds. */
const TIMEOUT_MS = 20_000
/** How long Windows is given to let a drive go before the drive is said to be kept, and how often it is looked at. */
const GONE_WAIT_MS = 8_000
const GONE_POLL_MS = 500

const KEPT = 'The system kept the drive: a file on it may still be open. Close what uses it, then try again.'

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The removable drives of this computer (docs/SPEC.md, section 12.4, more of the device), through each system's own
 * means: WMI and Explorer's eject on Windows, diskutil on macOS, lsblk and udisks on Linux.
 */
export function createDrives(system: SystemName = THIS_SYSTEM): Drives {
  if (system === 'win32') {
    const list = async (): Promise<Drive[]> => {
      const ran = await runProgram(win32.LIST, { timeout: TIMEOUT_MS, slow: 'Windows did not list its drives in time.' })
      if (ran.code !== 0) throw new Error(`Windows could not list its drives: ${firstError(ran)}`)
      return win32.readDrives(readPowershellJson(ran.out) as win32.WindowsDrive[])
    }
    return {
      list,
      async eject(path) {
        const letter = path.slice(0, 2).toUpperCase()
        const input = Buffer.from(JSON.stringify({ letter }), 'utf8').toString('base64')
        const ran = await runProgram(win32.EJECT, { input, timeout: TIMEOUT_MS })
        if (ran.code !== 0) throw new Error(`The drive was not ejected: ${firstError(ran)}`)
        for (let waited = 0; waited < GONE_WAIT_MS; waited += GONE_POLL_MS) {
          await pause(GONE_POLL_MS)
          if (!(await list()).some((drive) => drive.path.startsWith(letter))) return
        }
        throw new Error(KEPT)
      }
    }
  }
  if (system === 'darwin') {
    return {
      async list() {
        let names: string[]
        try {
          names = await readdir(darwin.VOLUMES)
        } catch {
          return []
        }
        const drives: Drive[] = []
        for (const name of names) {
          const ran = await runProgram(darwin.infoProgram(posix.join(darwin.VOLUMES, name)), { timeout: TIMEOUT_MS })
          if (ran.code !== 0) continue
          const drive = darwin.readDrive(darwin.readPlist(ran.out))
          if (drive && !drives.some((known) => known.path === drive.path)) drives.push(drive)
        }
        return drives
      },
      async eject(path) {
        const ran = await runProgram(darwin.ejectProgram(path), { timeout: TIMEOUT_MS })
        if (ran.code !== 0) throw new Error(`${KEPT} (${firstError(ran)})`)
      }
    }
  }
  const opened = async () => {
    const ran = await runProgram(linux.LIST, { timeout: TIMEOUT_MS, missing: 'This computer has no lsblk, which lists its drives.' })
    if (ran.code !== 0) throw new Error(`The drives could not be listed: ${firstError(ran)}`)
    return linux.readDrives(ran.out)
  }
  return {
    list: async () => (await opened()).map((one) => one.drive),
    async eject(path) {
      const found = (await opened()).find((one) => one.drive.path === path)
      if (!found) throw new Error(`No drive is opened at ${path}.`)
      for (const program of linux.ejectPrograms(found)) {
        const ran = await runProgram(program, { timeout: TIMEOUT_MS, missing: linux.MISSING })
        if (ran.code !== 0) throw new Error(`${KEPT} (${firstError(ran)})`)
      }
    }
  }
}
