import type { Exchange } from '@repo/protocol'

/**
 * Who a line of the transcript comes from, as its label says: the person, the assistant starting by itself, and why
 * (docs/SPEC.md, section 7.8), or the topic that handed a sub-thread its work (section 7.3).
 */
export function whoAsked(exchange: Exchange): string {
  switch (exchange.trigger) {
    case 'delegated':
      return 'From its topic'
    case 'greeting':
      return 'Briefing'
    case 'reminder':
      return 'Reminder'
    case 'task':
      return 'Scheduled'
    case 'resume':
      return 'Resumed'
    case 'ready':
      return 'Ready'
    default:
      return 'You'
  }
}
