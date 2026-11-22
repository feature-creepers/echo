import type { BlockProps } from '@repo/catalog'
import { illustration } from '../../illustrations/illustrations.ts'
import { cn } from '../../primitives/cn.ts'

const SIZE = { icon: 'w-12', figure: 'w-24', large: 'w-40' } as const

/** One of the app's own illustrations, by its name (docs/SPEC.md, section 13.1), in the ink of the words around it. */
export function Illustration({ props }: { props: BlockProps<'Illustration'> }) {
  return (
    <span
      role="img"
      aria-label={props.label ?? props.name.replace('-', ' ')}
      className={cn('block shrink-0', SIZE[props.size])}
      // The app's own drawing, written in its sources: never words of a view.
      dangerouslySetInnerHTML={{ __html: illustration(props.name) }}
    />
  )
}
