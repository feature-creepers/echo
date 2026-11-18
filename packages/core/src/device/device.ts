import type { Access, CommandRequest } from '@repo/protocol'
import type { AccessControl } from '../access/access.ts'
import type { Computer } from '../ports/computer.ts'
import type { Drives } from '../ports/drives.ts'
import type { Printers } from '../ports/printers.ts'
import type { Tool } from '../tools/tools.ts'
import type { Showing } from '../views/screen.ts'
import { createDeviceActs } from './acts.ts'
import { type CameraOptions, createCameraControl } from './camera.ts'
import { driveTools } from './drives.ts'
import { printerTools } from './printers.ts'

export interface DeviceOptions {
  access: Pick<AccessControl, 'ask' | 'record' | 'report' | 'reaches'>
  /** The approval level the person chose, read at each act. */
  level: () => Access['approvals']
  computer?: Computer | undefined
  printers?: Printers | undefined
  drives?: Drives | undefined
  /** How the camera of a connected device is reached. Left out, there is none. */
  camera?: Omit<CameraOptions, 'acts'> | undefined
}

export interface DeviceControl {
  /** The tools of what this computer has, for a thread whose screen is `showing`. */
  tools(showing: () => Showing): Tool[]
  /** A device answered a request for a picture. */
  pictureTaken(input: CommandRequest<'camera.picture'>): void
  /** Forget what was allowed for the session, and stop waiting for a picture: everything was stopped. */
  forget(): void
}

/**
 * More of the device (docs/SPEC.md, section 12.4): the printers and the removable drives of the computer the core
 * runs on, and the camera of a connected device, each offered only where there is one, and every act decided by one
 * rule.
 */
export function createDeviceControl({ access, level, computer, printers, drives, camera }: DeviceOptions): DeviceControl {
  const acts = createDeviceActs({ ask: access.ask, level, uses: access })
  const pictures = camera ? createCameraControl({ ...camera, acts }) : undefined
  const reaches = (path: string, write?: boolean) => access.reaches(path, write)
  return {
    tools: (showing) => [
      ...(printers && computer ? printerTools({ printers, computer, reaches, acts }, showing) : []),
      ...(drives ? driveTools({ drives, reaches, acts }, showing) : []),
      ...(pictures?.tools(showing) ?? [])
    ],
    pictureTaken: (input) => pictures?.answer(input),
    forget: () => {
      acts.forget()
      pictures?.stop()
    }
  }
}
