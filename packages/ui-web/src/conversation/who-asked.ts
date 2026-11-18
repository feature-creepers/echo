import type { Exchange } from '@repo/protocol'

/**
 * Who a line of the transcript comes from, as its label says: the person, or the assistant starting by itself,
 * and why (docs/SPEC.md, section 7.8).
 */
export function whoAsked(exchange: Exchange): string {
  switch (exchange.trigger) {
    case 'greeting':
      return 'Briefing'
    case 'reminder':
      return 'Reminder'
    case 'task':
      return 'Scheduled'
    default:
      return 'You'
  }
}
