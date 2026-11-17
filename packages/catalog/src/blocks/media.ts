import { z } from 'zod'
import type { Block } from '../block.ts'

/** A web address the app may load: https only, so nothing the assistant shows is read over an open connection. */
const https = z.string().regex(/^https:\/\/\S+$/, 'Give an https:// address. Most stations and sites serve their streams over https too.')

export const mediaBlocks = {
  Media: {
    description:
      'Sound or video played in the app: a radio or TV stream, a podcast, a song, a clip. `url` is the stream or file itself (.mp3, .aac, .ogg, .m4a, .mp4, .webm, .m3u8), never a web page with a player. `live` for a stream with no end. One plays at a time app-wide and goes on when the view changes; shown because the person asked to play it, it starts by itself.',
    props: z.object({
      url: https,
      kind: z.enum(['audio', 'video']).default('audio'),
      title: z.string().min(1),
      /** What is playing, or who makes it: a programme, an artist, a show. */
      subtitle: z.string().optional(),
      artwork: https.optional(),
      live: z.boolean().default(false)
    }),
    children: false
  }
} satisfies Record<string, Block>
