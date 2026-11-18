import { z } from 'zod'

/**
 * The agreement between a core and the program that starts it on the same machine.
 *
 * The starter runs the core with a token in its environment and a folder for the user's data. The core picks where it listens,
 * and says so with one line on its standard output once it accepts connections. Everything else
 * the core prints goes to its standard error.
 */

/** The environment variable that carries the token a local client must present. */
export const CORE_TOKEN_VARIABLE = 'ASSISTANT_CORE_TOKEN'

/**
 * The option that tells the core to stop when its standard input closes. A starter that keeps the core
 * as its child passes it, so the core never outlives the app. A core run as a service does not.
 */
export const EXIT_WITH_PARENT_OPTION = 'exit-with-parent'
export const EXIT_WITH_PARENT_FLAG = `--${EXIT_WITH_PARENT_OPTION}` as const

/**
 * The option that tells the core which folder to keep the user's data in. The core creates it when missing
 * and is the only program that writes there.
 */
export const DATA_OPTION = 'data'

/** The line a core prints on its standard output once it accepts connections. */
export const readySchema = z.object({
  type: z.literal('ready'),
  /** Where it listens: a Unix socket path, or a named pipe on Windows. */
  endpoint: z.string().min(1)
})
export type Ready = z.infer<typeof readySchema>
