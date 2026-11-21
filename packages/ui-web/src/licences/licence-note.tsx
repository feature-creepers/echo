import { useState } from 'react'
import type { ModelNotice } from '../device/host.ts'
import { Button } from '../primitives/button.tsx'
import { TextLink } from '../primitives/text-link.tsx'

/** The uses a licence forbids. */
export type Restricted = NonNullable<ModelNotice['licence']['restrictions']>

/** The uses a licence forbids, in its own words, lettered as it letters them. */
export function Restrictions({ restrictions }: { restrictions: Restricted }) {
  return (
    <div className="grid gap-2 text-xs leading-relaxed">
      <p>{restrictions.lead}</p>
      <ol className="grid list-[lower-alpha] gap-1.5 pl-6 marker:text-text-faint">
        {restrictions.uses.map((use) => (
          <li key={use}>{use}</li>
        ))}
      </ol>
    </div>
  )
}

/**
 * What a model's licence asks, where the model is downloaded and before it is: its makers and licence in a line, and
 * the uses the licence forbids one press away, since downloading the model is agreeing to them (docs/SPEC.md, section 8.2).
 */
export function LicenceNote({ notice }: { notice: ModelNotice }) {
  const [open, setOpen] = useState(false)
  const { model, licence } = notice
  return (
    <div className="grid gap-1.5 text-text-faint text-xs leading-relaxed">
      <p>
        {model.name} by <TextLink href={model.page}>{model.maker}</TextLink>, under <TextLink href={licence.url}>{licence.name}</TextLink>: {licence.asks}
      </p>
      {licence.restrictions && (
        <>
          <div>
            <Button kind="quiet" size="sm" className="-ml-2.5" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide what it forbids' : 'What it forbids'}
            </Button>
          </div>
          {open && <Restrictions restrictions={licence.restrictions} />}
        </>
      )}
    </div>
  )
}
