import { z } from 'zod'

/**
 * The other apps of the computer, as the assistant sees and operates them (docs/SPEC.md, section 12.1,
 * `device.screen`): whether this computer lets it, and the windows open now. Whether it may is a setting
 * (`access.desktop`), and which apps (`access.apps`).
 */
export const desktopStateSchema = z.object({
  /** Whether the system lets the assistant read and operate other apps here. */
  available: z.boolean(),
  /** Why not, in words for the person: a permission to give, a package to install. Left out when it does. */
  problem: z.string().max(1000).optional(),
  /** The apps that have a window open now, each once, for the person to pick from. */
  open: z.array(z.object({ program: z.string(), name: z.string() })).max(200)
})
export type DesktopState = z.infer<typeof desktopStateSchema>

/** A rectangle of the screen, in the system's pixels. */
export const boundsSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
export type Bounds = z.infer<typeof boundsSchema>

/** The window the assistant is operating, for the device to mark it while it does: nothing when it has let go. */
export const desktopControlSchema = z
  .object({
    /** The app, by its name. */
    app: z.string().max(200),
    /** The window's title. */
    title: z.string().max(500),
    bounds: boundsSchema
  })
  .nullable()
export type DesktopControl = z.infer<typeof desktopControlSchema>
