import {
  COMMANDS,
  commandSchema,
  isCommandName,
  type CommandError,
  type CommandErrorCode,
  type CommandInput,
  type CommandName,
  type CommandOutput,
  type Result
} from '@repo/protocol'
import type { Log } from '../ports/log.ts'

export type Outcome<Output> = { ok: true; output: Output } | { ok: false; error: CommandError }

/** What carries out each command. Leaving one out is a compile error. */
export type Handlers = { [Name in CommandName]: (input: CommandInput<Name>) => Outcome<CommandOutput<Name>> }

/**
 * Carry out the commands of admitted clients.
 *
 * Every command that can be read gets a result, including one that is unknown, badly formed, or that
 * fails for a reason of the core's own. A message that is not a command gets nothing: there is no identifier to answer to.
 */
export function createExecutor(handlers: Handlers, log: Log): (message: unknown) => Result | undefined {
  return (message) => {
    const command = commandSchema.safeParse(message)
    if (!command.success) return undefined
    const { id, name } = command.data
    const fail = (code: CommandErrorCode, why: string): Result => ({ type: 'result', id, ok: false, error: { code, message: why } })

    if (!isCommandName(name)) return fail('unknown-command', `This core has no command named "${name}".`)
    const input = COMMANDS[name].input.safeParse(command.data.input)
    if (!input.success) return fail('invalid-input', `The input of "${name}" is not what the command takes.`)

    try {
      // The handler of a command takes that command's input: checked above, but beyond what the compiler can follow.
      const handler = handlers[name] as (input: unknown) => Outcome<unknown>
      const outcome = handler(input.data)
      return outcome.ok ? { type: 'result', id, ok: true, output: outcome.output } : { type: 'result', id, ok: false, error: outcome.error }
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      log.error(`The command "${name}" failed: ${why}`)
      return fail('failed', why)
    }
  }
}
