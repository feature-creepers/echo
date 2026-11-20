import type { Drive } from '@repo/core'
import type { Program } from '../program.ts'

/** Said when udisks is missing: the desktops of Linux open and let go of drives with it. */
export const MISSING = 'This computer has no udisks: install it (udisksctl) to eject drives.'

/** The block devices and where they are opened, as JSON, sizes in bytes. */
export const LIST: Program = {
  command: 'lsblk',
  args: ['--json', '--bytes', '--output', 'NAME,PATH,LABEL,MODEL,MOUNTPOINT,SIZE,FSAVAIL,RM,HOTPLUG,RO,TYPE']
}

/** A block device as lsblk gives it. Older versions give yes and no as "1" and "0", and numbers as text. */
interface BlockDevice {
  name: string
  path?: string | null
  label?: string | null
  model?: string | null
  mountpoint?: string | null
  size?: number | string | null
  fsavail?: number | string | null
  rm?: boolean | string | null
  hotplug?: boolean | string | null
  ro?: boolean | string | null
  type?: string | null
  children?: BlockDevice[]
}

const yes = (value: boolean | string | null | undefined) => value === true || value === '1'
const number = (value: number | string | null | undefined) => {
  const read = typeof value === 'string' ? Number(value) : value
  return typeof read === 'number' && Number.isFinite(read) ? read : undefined
}

/** A drive opened by the system, with the disk it is on, which is what is powered off once it is let go. */
interface Opened {
  drive: Drive
  /** The partition or disk opened: "/dev/sdb1". */
  device: string
  /** The disk it is on: "/dev/sdb". */
  disk: string
}

/** The removable drives opened, from what lsblk printed: the partitions of a disk that can be unplugged, or the disk itself. */
export function readDrives(out: string): Opened[] {
  const { blockdevices = [] } = JSON.parse(out) as { blockdevices?: BlockDevice[] }
  const opened: Opened[] = []
  for (const disk of blockdevices) {
    if (disk.type !== 'disk' || !(yes(disk.rm) || yes(disk.hotplug))) continue
    const diskPath = disk.path ?? `/dev/${disk.name}`
    for (const part of [disk, ...(disk.children ?? [])]) {
      const mount = part.mountpoint
      if (!mount || mount === '[SWAP]' || !mount.startsWith('/')) continue
      const size = number(part.size)
      const free = number(part.fsavail)
      opened.push({
        drive: {
          path: mount,
          name: part.label?.trim() || disk.model?.trim() || part.name,
          ...(size === undefined ? {} : { size }),
          ...(free === undefined ? {} : { free }),
          readOnly: yes(part.ro)
        },
        device: part.path ?? `/dev/${part.name}`,
        disk: diskPath
      })
    }
  }
  return opened
}

/** Let a drive go: close what is opened, then power the disk off, as the desktop's own eject does. */
export function ejectPrograms(opened: Opened): Program[] {
  return [
    { command: 'udisksctl', args: ['unmount', '--block-device', opened.device, '--no-user-interaction'] },
    { command: 'udisksctl', args: ['power-off', '--block-device', opened.disk, '--no-user-interaction'] }
  ]
}
