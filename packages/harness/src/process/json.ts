/**
 * Reading what a CLI wrote. Its messages are JSON whose shape no compiler checked, and that a new version
 * may change: every field is taken as possibly missing or of another kind.
 */

export type JsonObject = Record<string, unknown>

export function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** The first JSON object in a text, for a program that may print a notice before its answer. */
export function firstObject(text: string): JsonObject | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  try {
    return asObject(JSON.parse(text.slice(start)))
  } catch {
    return undefined
  }
}
