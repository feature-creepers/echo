import type { Log, OneShot } from '@repo/core'
import type { Cli } from '../process/cli.ts'
import { asString, firstObject } from '../process/json.ts'
import { lastLines, saysSignedOut } from '../process/output.ts'
import { run, TimedOut } from '../process/run.ts'
import { createWorkingFiles } from '../process/working-files.ts'
import { ISOLATION_SETTINGS, ISOLATION_VARIABLES, isolationArguments } from './isolation.ts'
import { SIGNED_OUT } from './status.ts'

export interface OneShotContext {
  cli: Cli
  folder: string
  model: string
  /** How hard the model reasons. Left out, the CLI's own choice. */
  effort?: string | undefined
  log: Log
}

/** The whole answer at once, as one JSON object, when the CLI has finished. */
export const ONE_SHOT_ARGUMENTS = ['-p', '--output-format', 'json']

export const DEFAULT_TIMEOUT_MS = 120_000

/** One question to Claude Code, answered in text: a new process each time, which knows nothing of earlier ones. */
export async function complete(request: OneShot, context: OneShotContext): Promise<string> {
  const launch = await context.cli.launch()
  const files = createWorkingFiles(context.folder)
  try {
    const paths = {
      instructions: await files.write('instructions.txt', request.instructions),
      settings: await files.write('settings.json', JSON.stringify(ISOLATION_SETTINGS))
    }
    const result = await run(launch.command, [...ONE_SHOT_ARGUMENTS, ...isolationArguments(context.model, paths, context.effort)], {
      cwd: context.folder,
      env: { ...launch.env, ...ISOLATION_VARIABLES },
      input: request.input,
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    })
    const answer = firstObject(result.stdout)
    const text = asString(answer?.result)
    if (result.code === 0 && answer?.is_error !== true && text !== undefined) return text

    const detail = lastLines(text ?? '', result.stderr, result.stdout) || `exit code ${result.code}`
    context.log.error(`Claude Code failed to answer a single question: ${detail}`)
    throw new Error(saysSignedOut(detail) ? SIGNED_OUT : `Claude Code reported an error: ${detail}`)
  } catch (error) {
    if (error instanceof TimedOut) throw new Error('Claude Code took too long to answer.')
    throw error
  } finally {
    await files.remove()
  }
}
