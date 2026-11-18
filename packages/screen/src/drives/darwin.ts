import type { Drive } from '@repo/core'
import type { Program } from '../program.ts'

/** Where macOS opens the drives plugged in. */
export const VOLUMES = '/Volumes'

/** What macOS knows of a volume, as a property list. */
export function infoProgram(mount: string): Program {
  return { command: 'diskutil', args: ['info', '-plist', mount] }
}

/** Let a volume go, and the disk it is on, so it can be unplugged. */
export function ejectProgram(mount: string): Program {
  return { command: 'diskutil', args: ['eject', mount] }
}

/** The values of the top level of a property list that are plain: text, numbers and yes or no. */
export function readPlist(xml: string): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {}
  const body = /<plist[^>]*>\s*<dict>([\s\S]*)<\/dict>\s*<\/plist>/.exec(xml)?.[1] ?? ''
  // Nested dictionaries and arrays hold nothing read here; they are taken out first, so their keys are not mistaken.
  let flat = body
  for (let previous = ''; previous !== flat; ) {
    previous = flat
    flat = flat.replace(/<(dict|array)>(?:(?!<\/?(?:dict|array)>)[\s\S])*<\/\1>/g, '<nested/>').replace(/<(dict|array)\/>/g, '<nested/>')
  }
  const entry =
    /<key>([^<]*)<\/key>\s*(?:<(string|integer|real)>([^<]*)<\/\2>|<(true|false)\/>|<(string|integer|real)\/>|<nested\/>|<data>[^<]*<\/data>|<date>[^<]*<\/date>)/g
  for (const found of flat.matchAll(entry)) {
    const key = found[1]
    if (key === undefined) continue
    if (found[4]) values[key] = found[4] === 'true'
    else if (found[2] === 'string') values[key] = withoutEntities(found[3] ?? '')
    else if (found[2]) values[key] = Number(found[3])
  }
  return values
}

const withoutEntities = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/**
 * A volume as the core sees it, from what diskutil said of it: only a drive one can unplug (ejectable, or not inside
 * the computer), never the system's own disk nor a disk image opened from a file.
 */
export function readDrive(info: Record<string, string | number | boolean>): Drive | undefined {
  const mount = info.MountPoint
  if (typeof mount !== 'string' || mount === '/' || !mount.startsWith(`${VOLUMES}/`)) return undefined
  if (info.VirtualOrPhysical === 'Virtual') return undefined
  if (info.Ejectable !== true && info.Internal !== false) return undefined
  const size = typeof info.TotalSize === 'number' ? info.TotalSize : typeof info.Size === 'number' ? info.Size : undefined
  const free = typeof info.FreeSpace === 'number' ? info.FreeSpace : typeof info.APFSContainerFree === 'number' ? info.APFSContainerFree : undefined
  const name = typeof info.VolumeName === 'string' && info.VolumeName.trim() ? info.VolumeName.trim() : mount.slice(VOLUMES.length + 1)
  return {
    path: mount,
    name,
    ...(size === undefined ? {} : { size }),
    ...(free === undefined ? {} : { free }),
    readOnly: info.WritableVolume === false
  }
}
