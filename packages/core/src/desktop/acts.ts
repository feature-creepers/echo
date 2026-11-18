import { type ActStep, actSchema } from '@repo/catalog'
import type { Desktop, WindowFacts } from '../ports/desktop.ts'
import type { UserSettings } from '../settings/settings.ts'
import { decideDesktopAct } from './policy.ts'

/** How often a click waits for its element to appear, in milliseconds: an app takes a moment to open a page. */
const SEEK_EVERY_MS = 250

export interface ActsOptions {
  /** The apps of the computer the core runs on. Left out, nothing can be done on it. */
  desktop: Desktop | undefined
  settings: UserSettings
  /** Whether other apps may be used now: the person's switch, and a system that lets it. */
  usable: () => boolean
  /** Wait, between steps and while an element is awaited. */
  pause: (ms: number) => Promise<void>
}

/** What a press came to: done, or why not, in words for the person, who pressed it. */
export type ActDone = { ok: true } | { ok: false; problem: string }

/**
 * Carry out what a Button of a view does on the computer (docs/SPEC.md, section 9.5): the person pressed it, so it is
 * theirs and runs at once, with no model and no card. What the person keeps from the assistant still holds: a link
 * reaches no file, script or system page (the catalogue's rule, checked again here, since the steps travelled), an
 * app is clicked only when the person lets the assistant use it, and a button that pays, sends or deletes is never
 * pressed from a widget, since its steps were written by a model and the person sees only the label.
 */
export async function carryOut(written: unknown, { desktop, settings, usable, pause }: ActsOptions): Promise<ActDone> {
  const steps = actSchema.safeParse(written)
  if (!steps.success) return { ok: false, problem: `This button cannot act: ${steps.error.issues.map((issue) => issue.message).join(' ')}` }
  if (!desktop) return { ok: false, problem: 'This assistant runs where it cannot act on the computer.' }
  for (const step of steps.data) {
    try {
      const problem = await carryOutStep(step, { desktop, settings, usable, pause })
      if (problem) return { ok: false, problem }
    } catch (error) {
      return { ok: false, problem: error instanceof Error ? error.message : String(error) }
    }
  }
  return { ok: true }
}

async function carryOutStep(step: ActStep, { desktop, settings, usable, pause }: ActsOptions & { desktop: Desktop }): Promise<string | undefined> {
  if ('key' in step) return void (await desktop.systemKey(step.key, step.times))
  if ('open' in step) return void (await desktop.open(step.open))
  if ('wait' in step) return void (await pause(step.wait * 1000))

  if (!usable()) return 'Let the assistant use other apps in the settings first: this button clicks in one.'
  const named = step.app.toLowerCase()
  const matches = (window: WindowFacts) => window.app.toLowerCase() === named || window.program === named
  const tries = Math.max(1, Math.ceil((step.within * 1000) / SEEK_EVERY_MS)) + 1
  let window: WindowFacts | undefined
  let ref: string | undefined
  for (let tried = 0; tried < tries && ref === undefined; tried++) {
    if (tried > 0) await pause(SEEK_EVERY_MS)
    window = (await desktop.windows()).find(matches)
    if (!window) continue
    if (!settings.read().access.apps.some((app) => app.program === window?.program))
      return `${window.app} is not among the apps the assistant may use. Allow it in the settings, then press again.`
    ref = await desktop.seek(window.id, step.click, step.role)
  }
  if (!window) return `${step.app} has no window open.`
  if (ref === undefined) return `${window.app} shows no "${step.click}" now.`

  const element = await desktop.inspect(ref)
  if (!element) return `${window.app} shows no "${step.click}" now.`
  // The press is the person's consent to an ordinary click; only what pays, sends or deletes stays theirs alone.
  if (decideDesktopAct({ kind: 'click', element }, 'auto').verdict !== 'go')
    return `"${step.click}" in ${window.app} looks like it pays, sends or deletes something: a widget never presses that. Do it in the app.`
  if (window.minimized) await desktop.focus(window.id)
  await desktop.click(ref)
  return undefined
}
