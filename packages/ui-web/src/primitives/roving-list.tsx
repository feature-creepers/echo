import { createRovingFocus, createTypeahead, definePrimitive, isTypeaheadKey, labelOf, type PropSpec } from '@ui-sdk/core'
import { type PartProps, usePart, usePrimitive } from '@ui-sdk/react/primitive'

/**
 * A list whose entries take the keyboard in turn: one stop for them all, Up and Down from one to the next and
 * round, Home and End to either end, and the first letters of an entry to it.
 */
const defined = definePrimitive({
  name: 'roving-list',
  state: () => ({ focused: null as string | null }),
  api: (context) => {
    const roving = createRovingFocus(context, { slot: 'entry', key: 'focused', loop: () => true })
    const typeahead = createTypeahead()
    return {
      roving,
      keydown(event: KeyboardEvent, el: HTMLElement) {
        if (roving.keydown(event, el) || !isTypeaheadKey(event)) return
        const entries = roving.items()
        const labels = entries.map((entry) => labelOf(entry.el))
        const found =
          entries[
            typeahead(
              event.key,
              labels,
              entries.findIndex((entry) => entry.el === el)
            )
          ]
        if (!found) return
        event.preventDefault()
        found.el.focus()
      }
    }
  },
  slots: (slot) => ({
    root: slot({}),
    entry: slot<{ value: string }>({
      props: { value: 'string' },
      attrs: (state, part) => ({ tabindex: part.api.roving.tabIndex(state, part) }),
      on: {
        keydown: (event, { el, api }) => {
          if (el) api.keydown(event as KeyboardEvent, el)
        }
      },
      bind: (el, part) => part.api.roving.bind(el, part)
    })
  })
})

// UI SDK's types (0.1.0-beta.7) give a defined primitive option kinds that may be undefined, which exact optional
// property types refuse where a primitive is expected; its adapters read a primitive without options all the same.
const rovingList = defined as typeof defined & { options: Record<string, PropSpec> }

/** The list: what holds its entries, however deep. */
export function RovingList(props: PartProps<'div'>) {
  return usePart(usePrimitive(rovingList, {}), 'root', {}, props, 'div')
}

/** One entry of the list, named by `value` among the others. Render it as another button with `render`. */
export function RovingEntry({ value, ...props }: { value: string } & Omit<PartProps<'button'>, 'value'>) {
  return usePart(rovingList, 'entry', { value }, props, 'button')
}
