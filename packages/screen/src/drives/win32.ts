import type { Drive } from '@repo/core'
import { POWERSHELL_UTF8, powershell } from '../program.ts'

/**
 * The removable drives Windows has opened, from WMI: the volumes it calls removable (USB keys, memory cards), and
 * those of a disk on USB, which it calls fixed (an external disk). A card reader with no card has no size, and is
 * left out by the reading below.
 */
export const LIST = powershell(`$found = @{}
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object { $found[$_.DeviceID] = $_ }
Get-CimInstance Win32_DiskDrive -Filter "InterfaceType='USB'" | ForEach-Object {
  Get-CimAssociatedInstance -InputObject $_ -ResultClassName Win32_DiskPartition | ForEach-Object {
    Get-CimAssociatedInstance -InputObject $_ -ResultClassName Win32_LogicalDisk | ForEach-Object { $found[$_.DeviceID] = $_ }
  }
}
$drives = @($found.Values | ForEach-Object { [pscustomobject]@{ letter = [string]$_.DeviceID; label = [string]$_.VolumeName; size = $_.Size; free = $_.FreeSpace; access = [int]$_.Access } })
${POWERSHELL_UTF8.output('$drives')}`)

/** A drive as the script above gives it. */
export interface WindowsDrive {
  /** "E:" */
  letter: string
  label: string
  size: number | null
  free: number | null
  /** Win32_LogicalDisk's Access: 1 when it can only be read. */
  access: number
}

/** The drives, as the core sees them, from what the script printed, in the order of their letters. */
export function readDrives(found: readonly WindowsDrive[]): Drive[] {
  return found
    .filter((drive) => /^[a-z]:$/i.test(drive.letter) && typeof drive.size === 'number')
    .sort((one, other) => one.letter.localeCompare(other.letter))
    .map((drive) => ({
      path: `${drive.letter.toUpperCase()}\\`,
      name: drive.label.trim() || 'USB drive',
      ...(typeof drive.size === 'number' ? { size: drive.size } : {}),
      ...(typeof drive.free === 'number' ? { free: drive.free } : {}),
      readOnly: drive.access === 1
    }))
}

/**
 * Let a drive go as Explorer's "Eject" does, given { letter } on standard input. Windows answers nothing either way:
 * whether the drive went is seen by listing the drives again.
 */
export const EJECT = powershell(`$job = ${POWERSHELL_UTF8.input} | ConvertFrom-Json
$item = (New-Object -ComObject Shell.Application).Namespace(17).ParseName($job.letter)
if ($null -eq $item) { throw ('Windows does not see the drive ' + $job.letter + '.') }
$item.InvokeVerb('Eject')
${POWERSHELL_UTF8.output('@{ asked = $true }')}`)
