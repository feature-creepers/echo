import type { Access } from '@repo/protocol'
import type { AccessControl } from '../access/access.ts'
import type { Computer } from '../ports/computer.ts'
import type { Drives } from '../ports/drives.ts'
import type { Printers } from '../ports/printers.ts'
import type { Tool } from '../tools/tools.ts'
import type { Showing } from '../views/screen.ts'
import { createDeviceActs } from './acts.ts'
import { driveTools } from './drives.ts'
import { printerTools } from './printers.ts'

export interface DeviceOptions {
  access: Pick<AccessControl, 'ask' | 'record' | 'report' | 'reaches'>
  /** The approval level the person chose, read at each act. */
  level: () => Access['approvals']
  computer?: Computer | undefined
  printers?: Printers | undefined
  drives?: Drives | undefined
}

export interface DeviceControl {
  /** The tools of what this computer has, for a thread whose screen is `showing`. */
  tools(showing: () => Showing): Tool[]
  /** Forget what was allowed for the session: everything was stopped. */
  forget(): void
}

/**
 * More of the device (docs/SPEC.md, section 12.4): the printers and the removable drives of the computer the core
 * runs on, each offered only where the core was given it, and every act decided by one rule.
 */
export function createDeviceControl({ access, level, computer, printers, drives }: DeviceOptions): DeviceControl {
  const acts = createDeviceActs({ ask: access.ask, level, uses: access })
  const reaches = (path: string, write?: boolean) => access.reaches(path, write)
  return {
    tools: (showing) => [
      ...(printers && computer ? printerTools({ printers, computer, reaches, acts }, showing) : []),
      ...(drives ? driveTools({ drives, reaches, acts }, showing) : [])
    ],
    forget: () => acts.forget()
  }
}
