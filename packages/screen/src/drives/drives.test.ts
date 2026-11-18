import { describe, expect, it } from 'vitest'
import { ejectProgram, readDrive, readPlist } from './darwin.ts'
import { ejectPrograms, readDrives as readLinux } from './linux.ts'
import { readDrives as readWindows } from './win32.ts'

/** Each system's file is checked on every system: only one of them is used for real where the tests run. */
describe('the removable drives of Windows', () => {
  it('reads each one opened, by its letter, and leaves out a reader with no card', () => {
    expect(
      readWindows([
        { letter: 'F:', label: '', size: 64_000_000_000, free: null, access: 0 },
        { letter: 'E:', label: 'KINGSTON ', size: 32_000_000_000, free: 12_000_000_000, access: 3 },
        { letter: 'G:', label: 'EMPTY', size: null, free: null, access: 0 },
        { letter: 'H:', label: 'LOCKED', size: 2_000_000_000, free: 1_000, access: 1 }
      ])
    ).toEqual([
      { path: 'E:\\', name: 'KINGSTON', size: 32_000_000_000, free: 12_000_000_000, readOnly: false },
      { path: 'F:\\', name: 'USB drive', size: 64_000_000_000, readOnly: false },
      { path: 'H:\\', name: 'LOCKED', size: 2_000_000_000, free: 1_000, readOnly: true }
    ])
  })
})

const plist = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries}
</dict>
</plist>`

describe('the removable drives of macOS', () => {
  it('reads the plain values of diskutil’s property list, and none from inside what is nested', () => {
    const read = readPlist(
      plist(`<key>MountPoint</key><string>/Volumes/Photos &amp; more</string>
<key>Ejectable</key><true/>
<key>Internal</key><false/>
<key>Stores</key><array><dict><key>MountPoint</key><string>/</string></dict></array>
<key>TotalSize</key><integer>64023257088</integer>
<key>FreeSpace</key><integer>1000</integer>
<key>Empty</key><string/>`)
    )
    expect(read).toEqual({ MountPoint: '/Volumes/Photos & more', Ejectable: true, Internal: false, TotalSize: 64023257088, FreeSpace: 1000 })
  })

  it.each([
    [
      { MountPoint: '/Volumes/KEY', VolumeName: 'KEY', Ejectable: true, Internal: false, TotalSize: 8, FreeSpace: 4, WritableVolume: true },
      { path: '/Volumes/KEY', name: 'KEY', size: 8, free: 4, readOnly: false }
    ],
    [
      { MountPoint: '/Volumes/Backup', VolumeName: '', Ejectable: false, Internal: false, Size: 9, APFSContainerFree: 3 },
      { path: '/Volumes/Backup', name: 'Backup', size: 9, free: 3, readOnly: false }
    ],
    [
      { MountPoint: '/Volumes/Card', VolumeName: 'Card', Ejectable: true, WritableVolume: false },
      { path: '/Volumes/Card', name: 'Card', readOnly: true }
    ],
    [{ MountPoint: '/', VolumeName: 'Macintosh HD', Ejectable: false, Internal: true }, undefined],
    [{ MountPoint: '/Volumes/Data', Internal: true, Ejectable: false }, undefined],
    [{ MountPoint: '/Volumes/Installer', Ejectable: true, VirtualOrPhysical: 'Virtual' }, undefined]
  ])('reads %j as %j', (info, drive) => {
    expect(readDrive(info)).toEqual(drive)
  })

  it('ejects with diskutil', () => {
    expect(ejectProgram('/Volumes/KEY')).toEqual({ command: 'diskutil', args: ['eject', '/Volumes/KEY'] })
  })
})

describe('the removable drives of Linux', () => {
  const out = JSON.stringify({
    blockdevices: [
      { name: 'nvme0n1', path: '/dev/nvme0n1', type: 'disk', rm: false, hotplug: false, children: [{ name: 'nvme0n1p2', type: 'part', mountpoint: '/' }] },
      {
        name: 'sdb',
        path: '/dev/sdb',
        model: 'Ultra USB 3.0 ',
        type: 'disk',
        rm: true,
        hotplug: true,
        children: [
          { name: 'sdb1', path: '/dev/sdb1', label: 'KEY', type: 'part', mountpoint: '/media/ada/KEY', size: 32000, fsavail: 1200, ro: false },
          { name: 'sdb2', path: '/dev/sdb2', type: 'part', mountpoint: null, size: 100 }
        ]
      },
      // An older lsblk gives yes and no, and numbers, as text; a disk with no partition table is opened whole.
      { name: 'sdc', type: 'disk', rm: '0', hotplug: '1', ro: '1', mountpoint: '/media/ada/disk', size: '500', fsavail: null }
    ]
  })

  it('reads the drives opened on a disk that can be unplugged, with the disk to power off', () => {
    expect(readLinux(out)).toEqual([
      { drive: { path: '/media/ada/KEY', name: 'KEY', size: 32000, free: 1200, readOnly: false }, device: '/dev/sdb1', disk: '/dev/sdb' },
      { drive: { path: '/media/ada/disk', name: 'sdc', size: 500, readOnly: true }, device: '/dev/sdc', disk: '/dev/sdc' }
    ])
    expect(readLinux('{}')).toEqual([])
  })

  it('lets a drive go as the desktop does: closed, then the disk powered off', () => {
    const [first] = readLinux(out)
    if (!first) throw new Error('no drive')
    expect(ejectPrograms(first)).toEqual([
      { command: 'udisksctl', args: ['unmount', '--block-device', '/dev/sdb1', '--no-user-interaction'] },
      { command: 'udisksctl', args: ['power-off', '--block-device', '/dev/sdb', '--no-user-interaction'] }
    ])
  })
})
