import { collectionSchema, type SavedWidget, widgetTitleSchema } from '@repo/protocol'
import { z } from 'zod'
import type { ToolResult } from '../ports/tools.ts'
import type { Tool } from '../tools/tools.ts'
import { cardNameSchema } from '../views/screen.ts'

/** What a session can do with the library, by name (docs/SPEC.md, section 9.8). */
const LIBRARY_SEARCH_TOOL = 'library_search'
const LIBRARY_SHOW_TOOL = 'library_show'
const LIBRARY_SAVE_TOOL = 'library_save'
const LIBRARY_UPDATE_TOOL = 'library_update'
const LIBRARY_DELETE_TOOL = 'library_delete'

/** What every session that can show things is told about the library. */
export const LIBRARY_INSTRUCTIONS = [
  'The library. The person bookmarks views of yours they like, to keep them, pin them beside the conversation, and have them again.',
  `- When they ask for something a saved widget covers ("the radio again", "my training plan"), show it with ${LIBRARY_SHOW_TOOL}, as it is: they chose it, and it should come back the same each time. Find one with ${LIBRARY_SEARCH_TOOL} when the list you were given does not settle it. Compose a new view only when none fits, or when they ask for something different.`,
  `- When they ask for a widget or an app to keep (their CI, their playlists, a tracker, a dashboard), build a widget app with widget_build: it runs by itself, with no call to you. A view answers; an app is kept and used. To change one, read it with widget_source, then build it again with its id.`,
  `- When they ask you to keep, save or bookmark what is on screen, use ${LIBRARY_SAVE_TOOL}. When they ask you to change a saved widget, rename it, file it, pin or unpin it, use ${LIBRARY_UPDATE_TOOL}; delete one with ${LIBRARY_DELETE_TOOL} only when they ask.`
].join('\n')

/** What the tools need from the library. */
interface LibraryActions {
  search(query: string): SavedWidget[]
  show(widget: string): ToolResult
  save(title: string | undefined, collection: string | undefined, card: string | undefined): ToolResult
  update(input: LibraryEdit): ToolResult
  remove(widget: string): ToolResult
}

const searchInput = z.object({ query: z.string().max(500).default('') })
const widgetInput = z.object({ widget: z.string().min(1).max(64) })
const saveInput = z.object({ title: widgetTitleSchema.optional(), collection: collectionSchema.optional(), card: cardNameSchema.optional() })
const updateInput = z.object({
  widget: z.string().min(1).max(64),
  title: widgetTitleSchema.optional(),
  collection: collectionSchema.nullable().optional(),
  pinned: z.boolean().optional(),
  view: z.unknown().optional()
})

/** A change to a saved widget a session asked for. */
export type LibraryEdit = z.infer<typeof updateInput>

const listed = (widget: SavedWidget) =>
  `- [${widget.id}] "${widget.title}"${widget.collection ? ` in ${widget.collection}` : ''}${widget.pinned ? ', pinned' : ''}, saved ${widget.since.slice(0, 10)}`

export function libraryTools(library: LibraryActions): Tool[] {
  return [
    {
      definition: {
        name: LIBRARY_SEARCH_TOOL,
        description: 'Search the widgets the person saved in their library, by what they show or are called. An empty query lists the latest ones.',
        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'A few words: "radio", "weather Lyon", "budget".' } } }
      },
      run(input) {
        const asked = searchInput.safeParse(input ?? {})
        if (!asked.success) return { ok: false, text: 'Give the words to look for as "query".' }
        const found = library.search(asked.data.query)
        if (found.length === 0) return { ok: true, text: 'No saved widget matches that.' }
        return { ok: true, text: `Saved widgets, best match first. Show one with ${LIBRARY_SHOW_TOOL}.\n${found.map(listed).join('\n')}` }
      }
    },
    {
      definition: {
        name: LIBRARY_SHOW_TOOL,
        description:
          'Show a widget of the library on the screen, exactly as the person saved it, as a card of your answer, and what it plays starts. Then say in a few words what it is; do not describe it.',
        inputSchema: {
          type: 'object',
          properties: { widget: { type: 'string', description: 'The id of the saved widget, in brackets in the list.' } },
          required: ['widget']
        }
      },
      run(input) {
        const asked = widgetInput.safeParse(input)
        return asked.success ? library.show(asked.data.widget) : { ok: false, text: 'Give the id of the saved widget as "widget".' }
      }
    },
    {
      definition: {
        name: LIBRARY_SAVE_TOOL,
        description: 'Save a card you are showing now to the library, because the person asked to keep it. A title and a collection may be given.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'What to call it. Left out, the title of the view.' },
            collection: { type: 'string', description: 'A collection to file it in, when they named one.' },
            card: { type: 'string', description: 'The name of the card to save. Left out, the latest.' }
          }
        }
      },
      run(input) {
        const asked = saveInput.safeParse(input ?? {})
        return asked.success
          ? library.save(asked.data.title, asked.data.collection, asked.data.card)
          : { ok: false, text: "A title and a collection are a few words each, and a card's name a word or two." }
      }
    },
    {
      definition: {
        name: LIBRARY_UPDATE_TOOL,
        description:
          'Change a saved widget, because the person asked: its title, its collection (null to take it out of one), whether it is pinned beside the conversation, or its content, given as a whole new view in the format of ui_render. New content is saved as a new version and shown at once, without starting what it plays.',
        inputSchema: {
          type: 'object',
          properties: {
            widget: { type: 'string' },
            title: { type: 'string' },
            collection: { type: ['string', 'null'] },
            pinned: { type: 'boolean' },
            view: { type: 'object', description: 'The new content: { "root", "elements" }, as for ui_render.' }
          },
          required: ['widget']
        }
      },
      run(input) {
        const asked = updateInput.safeParse(input)
        return asked.success ? library.update(asked.data) : { ok: false, text: 'Give the id of the saved widget as "widget", and what changes.' }
      }
    },
    {
      definition: {
        name: LIBRARY_DELETE_TOOL,
        description: 'Delete a saved widget from the library, only because the person asked to.',
        inputSchema: { type: 'object', properties: { widget: { type: 'string' } }, required: ['widget'] }
      },
      run(input) {
        const asked = widgetInput.safeParse(input)
        return asked.success ? library.remove(asked.data.widget) : { ok: false, text: 'Give the id of the saved widget as "widget".' }
      }
    }
  ]
}
