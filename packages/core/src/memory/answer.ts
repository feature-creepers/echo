import type { z } from 'zod'

/** A model answered something that is not what it was asked for. Asking again may give a better answer. */
export class UnreadableAnswer extends Error {
  constructor(what: string) {
    super(`The model's answer could not be read as ${what}.`)
    this.name = 'UnreadableAnswer'
  }
}

/**
 * Read the JSON object a model was asked to answer with. Models wrap it in a code fence or a sentence now
 * and then, so the object is taken from the first opening brace to the last closing one.
 */
export function readJsonAnswer<Schema extends z.ZodType>(answer: string, schema: Schema, what: string): z.output<Schema> {
  const start = answer.indexOf('{')
  const end = answer.lastIndexOf('}')
  if (start < 0 || end < start) throw new UnreadableAnswer(what)
  let parsed: unknown
  try {
    parsed = JSON.parse(answer.slice(start, end + 1))
  } catch {
    throw new UnreadableAnswer(what)
  }
  const read = schema.safeParse(parsed)
  if (!read.success) throw new UnreadableAnswer(what)
  return read.data
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = (value: number) => String(value).padStart(2, '0')

/**
 * A moment as a model needs it to turn "next Friday" into a date: the day on the core's clock, with its weekday
 * and the time. The user's "tomorrow" is the core's tomorrow, since the core runs on the user's machine.
 */
export function dayOf(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${WEEKDAYS[date.getDay()]} ${day}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
