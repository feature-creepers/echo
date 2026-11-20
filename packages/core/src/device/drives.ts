import { z } from 'zod'
import type { Drive, Drives } from '../ports/drives.ts'
import type { Tool } from '../tools/tools.ts'
import type { Showing } from '../views/screen.ts'
import { type DeviceActs, sizeOf } from './acts.ts'

const ejectInput = z.object({ drive: z.string().trim().min(1).max(4096) })

/** The same place whatever its case and its last separator, as Windows names a drive: "e:" for "E:\". */
const sameDrive = (one: string, other: string) => {
  const plain = (value: string) => value.replace(/[\\/]+$/, '').toLowerCase()
  return plain(one) === plain(other)
}

/** The drive a call names: by where it is, else by its name. Nothing, with the reason, when it is not plugged in. */
export function chooseDrive(drives: readonly Drive[], asked: string): Drive | string {
  if (drives.length === 0) return 'No removable drive is plugged in.'
  const byPath = drives.find((drive) => sameDrive(drive.path, asked))
  if (byPath) return byPath
  const named = drives.filter((drive) => drive.name.toLowerCase() === asked.trim().toLowerCase())
  if (named.length === 1 && named[0]) return named[0]
  const all = drives.map((drive) => `${drive.name} (${drive.path})`).join(', ')
  return named.length > 1
    ? `Several drives are called "${asked}": name it by where it is, one of ${all}.`
    : `No drive "${asked}" is plugged in. The drives are ${all}.`
}

interface DriveToolsOptions {
  drives: Drives
  /** Whether a place may be read now, or changed with `write`, by the person's grants. */
  reaches: (path: string, write?: boolean) => boolean
  acts: DeviceActs
}

/**
 * The removable drives as tools (docs/SPEC.md, section 12.4, more of the device). A drive's files are a place like
 * any other: read once the person gives it, changed as any change is decided. Listing the drives goes ahead, saying
 * for each what the assistant may do there; letting one go follows the approval level as a command does.
 */
export function driveTools({ drives, reaches, acts }: DriveToolsOptions, showing: () => Showing): Tool[] {
  return [
    {
      definition: {
        name: 'drives_list',
        description:
          'The removable drives plugged in now (USB keys, memory cards, external disks): each with where it is, its space, and whether you may read or change it. A drive not given yet is asked for with computer_grant, like any folder.',
        inputSchema: { type: 'object', properties: {} }
      },
      async run() {
        try {
          const found = await drives.list()
          if (found.length === 0) return { ok: true, text: 'No removable drive is plugged in.' }
          const lines = found.map((drive) => {
            const space =
              drive.size === undefined ? '' : drive.free === undefined ? `, ${sizeOf(drive.size)}` : `, ${sizeOf(drive.free)} free of ${sizeOf(drive.size)}`
            const access = reaches(drive.path, true)
              ? 'you may read and change it'
              : reaches(drive.path)
                ? 'you may read it, not change it'
                : 'not given to you: ask for it with computer_grant if the work needs it'
            return `- ${drive.name}, at ${drive.path}${space}${drive.readOnly ? ', read only' : ''}: ${access}.`
          })
          return { ok: true, text: lines.join('\n') }
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) }
        }
      }
    },
    {
      definition: {
        name: 'drive_eject',
        description:
          'Let a removable drive go, so the person can unplug it safely: the system writes what it holds back and closes it. Name it by where it is or by its name, from drives_list.',
        inputSchema: {
          type: 'object',
          properties: { drive: { type: 'string', description: 'Where it is ("E:\\", "/Volumes/KEY") or its name.' } },
          required: ['drive']
        }
      },
      async run(input) {
        const asked = ejectInput.safeParse(input)
        if (!asked.success) return { ok: false, text: 'drive_eject takes the "drive", by where it is or by its name.' }
        let found: Drive[]
        try {
          found = await drives.list()
        } catch (error) {
          return { ok: false, text: error instanceof Error ? error.message : String(error) }
        }
        const drive = chooseDrive(found, asked.data.drive)
        if (typeof drive === 'string') return { ok: false, text: drive }
        const decided = await acts.decide(
          {
            tool: 'drive_eject',
            line: `Eject ${drive.name} (${drive.path})`,
            paths: [drive.path],
            question: {
              heading: `Eject “${drive.name}”?`,
              subject: drive.path,
              facts: [{ label: 'Drive', value: `${drive.name}, ${drive.path}` }],
              note: { text: 'Anything still copying to it stops.', tone: 'soft' },
              allow: 'Eject',
              session: 'Ejecting drives'
            }
          },
          showing()
        )
        if (!decided.go) return decided.result
        return acts.carry(decided.use, async () => {
          await drives.eject(drive.path)
          return { ok: true, text: `${drive.name} was ejected: the person can unplug it.` }
        })
      }
    }
  ]
}
