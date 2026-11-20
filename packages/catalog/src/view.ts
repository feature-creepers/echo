import { z } from 'zod'
import type { BLOCKS, BlockName } from './catalog.ts'

/**
 * A view: what the assistant shows for one answer. It is a description, never code: a flat map of elements,
 * each naming a block, its properties and the elements inside it. A renderer draws it; the core checks it
 * against the catalogue first.
 *
 * The shape is the one json-render uses for its specs, so its renderers, on the web and on a phone, can
 * draw a view as it is.
 */
export const viewSpecSchema = z.object({
  /** The identifier of the element everything else is inside. */
  root: z.string().min(1),
  elements: z.record(
    z.string().min(1),
    z.object({
      /** The name of a block of the catalogue. */
      type: z.string().min(1),
      props: z.record(z.string(), z.unknown()).default({}),
      /** The identifiers of the elements inside this one, in order. */
      children: z.array(z.string().min(1)).default([])
    })
  )
})

/** The properties of a block, with every default filled in: what a renderer receives. */
export type BlockProps<Name extends BlockName> = z.output<(typeof BLOCKS)[Name]['props']>

/** One element of a checked view. */
export interface ViewElement {
  type: BlockName
  props: Record<string, unknown>
  children: string[]
}

/** A view that was checked against the catalogue: every element names a block and has that block's properties. */
export interface ViewSpec {
  root: string
  elements: Record<string, ViewElement>
}
