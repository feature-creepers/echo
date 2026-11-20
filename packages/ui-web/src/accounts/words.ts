import type { AccountPart } from '@repo/protocol'

/** What an account gives, in a few words: "Calendar and mail". */
export function partsWords(parts: readonly AccountPart[]): string {
  const calendar = parts.includes('calendar')
  const mail = parts.includes('mail')
  return calendar && mail ? 'Calendar and mail' : calendar ? 'Calendar' : 'Mail'
}
