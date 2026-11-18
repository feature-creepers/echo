import type { Exchange, Step } from '@repo/protocol'

/**
 * How long a step's output, or any one text inside what it was given, stays whole when a thread is read for the
 * side sheet. The sheet shows them folded, to glance at; the records keep more.
 */
export const STEP_TEXT_SHOWN = 4_000

/**
 * The most a thread read may weigh, in characters of JSON, before its oldest requests are left out. Well under
 * the line a client accepts (`MAX_LINE_LENGTH`), so the envelope and the views around it always fit too.
 */
export const THREAD_READ_BUDGET = 600_000

/** Cut a text to `most` characters, saying so. */
export function cutText(text: string, most = STEP_TEXT_SHOWN): string {
  return text.length > most ? `${text.slice(0, most)}\n[…cut]` : text
}

/** Cut every long text inside what a tool was given, keeping its shape, so a command or a path is still read from it. */
export function cutInput(input: unknown, most = STEP_TEXT_SHOWN): unknown {
  if (typeof input === 'string') return cutText(input, most)
  if (Array.isArray(input)) return input.map((item) => cutInput(item, most))
  if (typeof input === 'object' && input !== null) {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, cutInput(value, most)]))
  }
  return input
}

/** A step as the side sheet shows it: its input and output cut to what can be glanced at. */
export function stepShown(step: Step): Step {
  const shown: Step = { ...step }
  if (step.input !== undefined) shown.input = cutInput(step.input)
  if (step.output !== undefined) shown.output = cutText(step.output)
  return shown
}

/**
 * A thread read whole can outgrow what one message carries: a long piece of project work makes hundreds of tool
 * calls. Its steps are cut, then its most recent requests are kept, with their steps, as far as the budget goes,
 * and the number left out is said. The latest request is always kept, whatever it weighs.
 */
export function fitThread(exchanges: Exchange[], steps: Step[], budget = THREAD_READ_BUDGET): { exchanges: Exchange[]; steps: Step[]; earlier: number } {
  const shown = steps.map(stepShown)
  const byTurn = new Map<string, Step[]>()
  for (const step of shown) byTurn.set(step.turn, [...(byTurn.get(step.turn) ?? []), step])
  const turns = new Set(exchanges.map((exchange) => exchange.turn))
  // Steps of no request in the list, such as calls still opening, weigh on the budget but are kept.
  let used = JSON.stringify(shown.filter((step) => !turns.has(step.turn))).length

  const kept: Exchange[] = []
  for (let index = exchanges.length - 1; index >= 0; index--) {
    const exchange = exchanges[index] as Exchange
    const weight = JSON.stringify(exchange).length + JSON.stringify(byTurn.get(exchange.turn) ?? []).length
    if (kept.length > 0 && used + weight > budget) break
    used += weight
    kept.unshift(exchange)
  }
  const keptTurns = new Set(kept.map((exchange) => exchange.turn))
  return {
    exchanges: kept,
    steps: shown.filter((step) => keptTurns.has(step.turn) || !turns.has(step.turn)),
    earlier: exchanges.length - kept.length
  }
}
