/** A system the device's adapters are written for, by the name Node gives it. */
export type SystemName = 'win32' | 'darwin' | 'linux'

/** The system of this computer. Any system that is neither Windows nor macOS is driven as Linux. */
export const THIS_SYSTEM: SystemName = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
