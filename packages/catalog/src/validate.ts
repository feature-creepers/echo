import type { Block } from './block.ts'
import { BLOCKS, isBlockName } from './catalog.ts'
import { type ViewElement, type ViewSpec, viewSpecSchema } from './view.ts'

/** The most elements a view may have, and the deepest they may nest. A view is an answer, not a document. */
const MAX_ELEMENTS = 300
export const MAX_DEPTH = 12

export type Validation = { ok: true; spec: ViewSpec } | { ok: false; problems: string[] }

/**
 * Check a view a model wrote against the catalogue, and fill in the defaults of every block.
 *
 * Nothing a model writes is trusted or executed: an element must name a block, carry that block's
 * properties and nothing else, and contain only elements that exist. Every problem is said in a sentence
 * the model can act on, all of them at once, so one correction is enough.
 */
export function validateView(written: unknown): Validation {
  const shape = viewSpecSchema.safeParse(written)
  if (!shape.success) {
    return { ok: false, problems: ['A view is { "root": "<id>", "elements": { "<id>": { "type": "<Block>", "props": { … }, "children": ["<id>", …] } } }.'] }
  }
  const { root, elements } = shape.data
  const problems: string[] = []
  const checked: Record<string, ViewElement> = {}

  const ids = Object.keys(elements)
  if (ids.length > MAX_ELEMENTS) problems.push(`A view has at most ${MAX_ELEMENTS} elements; this one has ${ids.length}. Show less.`)
  if (!Object.hasOwn(elements, root)) problems.push(`The root "${root}" is not one of the elements.`)

  for (const [id, element] of Object.entries(elements)) {
    if (!isBlockName(element.type)) {
      problems.push(`"${id}": there is no block named "${element.type}". The blocks are: ${Object.keys(BLOCKS).join(', ')}.`)
      continue
    }
    const block = BLOCKS[element.type]
    const props = block.props.strict().safeParse(element.props)
    if (!props.success) {
      for (const issue of props.error.issues) {
        const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
        problems.push(`"${id}" (${element.type}): ${where}${issue.message}`)
      }
    }
    const together = props.success ? (block as Block).check?.(props.data) : undefined
    if (together) problems.push(`"${id}" (${element.type}): ${together}`)
    if (!block.children && element.children.length > 0) problems.push(`"${id}" (${element.type}) cannot contain other elements.`)
    for (const child of element.children) {
      if (!Object.hasOwn(elements, child)) problems.push(`"${id}" contains "${child}", which is not one of the elements.`)
      else if (element.type === 'Card' && elements[child]?.type === 'Card')
        problems.push(`"${id}" is a Card directly inside a Card ("${child}"). Use a Section, or put the cards side by side.`)
    }
    checked[id] = { type: element.type, props: props.success ? props.data : {}, children: element.children }
  }

  // Walk from the root: nothing may contain itself, nest too deep, sit in two places, or be left out.
  const seen = new Set<string>()
  const walk = (id: string, path: string[]) => {
    if (path.includes(id)) return void problems.push(`"${id}" contains itself: ${[...path, id].join(' → ')}.`)
    if (path.length >= MAX_DEPTH) return void problems.push(`"${id}" is nested more than ${MAX_DEPTH} levels deep. Flatten the view.`)
    if (seen.has(id)) return void problems.push(`"${id}" is inside two elements. An element goes in one place.`)
    seen.add(id)
    for (const child of elements[id]?.children ?? []) if (Object.hasOwn(elements, child)) walk(child, [...path, id])
  }
  if (Object.hasOwn(elements, root)) {
    walk(root, [])
    const unused = ids.filter((id) => !seen.has(id))
    if (unused.length > 0) problems.push(`These elements are in no other element and are not the root, so they would not show: ${unused.join(', ')}.`)
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, spec: { root, elements: checked } }
}
