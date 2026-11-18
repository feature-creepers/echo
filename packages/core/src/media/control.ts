import { MEDIA_ACTIONS, type MediaControl, mediaSourceSchema } from '@repo/protocol'

/** What the media tool was asked, as the player's control, or what is wrong with it, said for the model. */
export function mediaControlOf(input: unknown): MediaControl | string {
  const asked = (input ?? {}) as Record<string, unknown>
  const action = asked.action as MediaControl['action']
  if (!MEDIA_ACTIONS.includes(action)) return `action is one of: ${MEDIA_ACTIONS.join(', ')}.`
  const number = (key: string) => (typeof asked[key] === 'number' && Number.isFinite(asked[key]) ? (asked[key] as number) : undefined)
  switch (action) {
    case 'volume': {
      const level = number('level')
      const step = number('step')
      if (level !== undefined) return { action, level: Math.max(0, Math.min(100, level)) / 100 }
      if (step !== undefined) return { action, step: Math.max(-100, Math.min(100, step)) / 100 }
      return 'volume takes a "level" from 0 to 100, or a "step" from -100 to 100.'
    }
    case 'seek': {
      const to = number('to')
      const by = number('by')
      if (to !== undefined) return { action, to: Math.max(0, to) }
      if (by !== undefined) return { action, by }
      return 'seek takes "to", a position in seconds, or "by", seconds forward or back.'
    }
    case 'queue': {
      const source = mediaSourceSchema.safeParse({
        url: asked.url,
        kind: asked.kind ?? 'audio',
        title: asked.title,
        ...(typeof asked.subtitle === 'string' ? { subtitle: asked.subtitle } : {}),
        live: asked.live ?? false
      })
      if (!source.success) return 'queue takes the "url" of the stream or file itself, its "title", its "kind" (audio or video) and whether it is "live".'
      return { action, source: source.data }
    }
    default:
      return { action }
  }
}
