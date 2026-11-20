import { z } from 'zod'

/**
 * What a Button does on the computer when the person presses it, at once and with no turn of the conversation
 * (docs/SPEC.md, section 9.5): a few steps, carried out in order by the core on the computer it runs on. Nothing here
 * names an app: a music app, the sound, a meeting app or a game are all driven by the same steps, which the
 * assistant puts together for the widget at hand.
 */

/**
 * Keys of the whole system, pressed without bringing any window to the front: the media keys, which the app that
 * plays answers whichever it is, and the sound's.
 */
const SYSTEM_KEYS = ['MediaPlayPause', 'MediaNext', 'MediaPrevious', 'MediaStop', 'VolumeUp', 'VolumeDown', 'VolumeMute'] as const
export type SystemKey = (typeof SYSTEM_KEYS)[number]

/** The most steps one press carries out, and the longest it may wait in all, in seconds: a press is a gesture, not a script. */
const MAX_ACT_STEPS = 6
const MAX_ACT_SECONDS = 20

/**
 * Schemes a link opened from a widget may never have: they name a file, run a script, reach the system's own
 * pages, or open a document from elsewhere in an app that runs its macros. Every scheme of Windows' own (`ms-…`) is
 * left out for that reason.
 */
const REFUSED_SCHEMES = new Set([
  'file',
  'javascript',
  'vbscript',
  'data',
  'blob',
  'about',
  'shell',
  'search',
  'search-ms',
  'hcp',
  'its',
  'mk',
  'res',
  'jar',
  'view-source'
])

/** Why a link may not be opened from a widget, in words a model acts on; nothing when it may. */
function linkProblem(link: string): string | undefined {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(link)?.[1]?.toLowerCase()
  if (scheme === undefined || /\s/.test(link))
    return "Give a link with its scheme and no spaces: an app's own link, such as spotify:playlist:<id>, or an https:// page."
  if (scheme === 'http') return 'Give the https:// address of the page.'
  if (REFUSED_SCHEMES.has(scheme) || scheme.startsWith('ms-'))
    return `A widget never opens ${scheme}: links, which reach files, scripts or the system itself. Give an app's own link or an https:// page.`
  return undefined
}

/** A link opened with the app that takes it: `spotify:playlist:<id>`, `zoommtg:…`, `https://…`. */
const appLinkSchema = z
  .string()
  .max(2048)
  .superRefine((link, context) => {
    const problem = linkProblem(link)
    if (problem) context.addIssue({ code: 'custom', message: problem })
  })

const actStepSchema = z.union([
  z.strictObject({
    /** A key of the whole system. */
    key: z.enum(SYSTEM_KEYS),
    /** How many times, for the sound: each VolumeUp or VolumeDown moves it by a small step. */
    times: z.number().int().min(1).max(25).default(1)
  }),
  z.strictObject({ open: appLinkSchema }),
  z.strictObject({
    /** The element's name, as the app's window names it: what `desktop_look` shows between quotes. */
    click: z.string().trim().min(1).max(200),
    /** The app whose window holds it, by its name or its program: "Spotify". One the person lets the assistant use. */
    app: z.string().trim().min(1).max(100),
    /** Its role, when the name alone could be two elements: "button", "link", "list item". */
    role: z.string().trim().min(1).max(40).optional(),
    /** How long to wait for it to appear, in seconds, as after opening a link. */
    within: z.number().min(0).max(15).default(5)
  }),
  z.strictObject({ wait: z.number().min(0.1).max(10) })
])
export type ActStep = z.infer<typeof actStepSchema>

export const actSchema = z
  .array(actStepSchema)
  .min(1)
  .max(MAX_ACT_STEPS)
  .superRefine((steps, context) => {
    const seconds = steps.reduce((total, step) => total + ('wait' in step ? step.wait : 'click' in step ? step.within : 0), 0)
    if (seconds > MAX_ACT_SECONDS)
      context.addIssue({ code: 'custom', message: `A press waits ${MAX_ACT_SECONDS} seconds at most in all; these steps wait ${seconds}.` })
  })
