import { useDevice } from '../device/device.tsx'
import type { ModelNotice } from '../device/host.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { TextLink } from '../primitives/text-link.tsx'
import { SettingGroup } from '../settings/rows.tsx'
import { useAbout } from '../settings/use-about.ts'
import { type Restricted, Restrictions } from './licence-note.tsx'

/**
 * The Licences page (docs/SPEC.md, section 8.2): every model the app downloads, credited as its licence asks, then the
 * uses each licence forbids, whole and in its own words. The app says which models it downloads, from its catalogue.
 */
export function LicencesSection() {
  const { host } = useDevice()
  const about = useAbout(host)

  if (!host) return <p className="text-text-faint text-xs">Only the app knows the models it downloads, and this window is not in it.</p>
  if (!about) return <p className="text-text-faint text-xs">Reading the licences…</p>
  if (about.models.length === 0) return <p className="text-text-faint text-xs">This version downloads no model.</p>

  // Each licence that forbids uses, once, with the models under it.
  const restricting = new Map<string, { restrictions: Restricted; models: string[] }>()
  for (const { licence, model } of about.models) {
    if (!licence.restrictions) continue
    const entry = restricting.get(licence.name) ?? { restrictions: licence.restrictions, models: [] }
    entry.models.push(model.name)
    restricting.set(licence.name, entry)
  }

  return (
    <div className="grid gap-10">
      <SettingGroup title="Models it downloads">
        {about.models.map((notice) => (
          <ModelCredit key={notice.id} notice={notice} />
        ))}
      </SettingGroup>

      {[...restricting].map(([name, { restrictions, models }]) => (
        <SettingGroup key={name} title={`What ${name} forbids`} note={models.join(', ')}>
          <div className="px-5 py-4 text-text-soft">
            <Restrictions restrictions={restrictions} />
          </div>
        </SettingGroup>
      ))}

      <p className="text-text-faint text-xs leading-relaxed">
        The speech models run with sherpa-onnx, and search by meaning with Transformers.js, both under the Apache 2.0 licence.
      </p>
    </div>
  )
}

/** One model: what it is for, who made it, what was changed, where its files come from, and its licence. */
function ModelCredit({ notice }: { notice: ModelNotice }) {
  const { model, licence, changes, source } = notice
  return (
    <div className="grid gap-3 px-5 py-4">
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-sm">{model.name}</span>
        <Eyebrow>{notice.name}</Eyebrow>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-1.5 text-xs leading-relaxed">
        <dt className="text-text-faint">Made by</dt>
        <dd className="text-text-soft">
          <TextLink href={model.page}>{model.maker}</TextLink>
          {model.copyright && <span className="text-text-faint"> · {model.copyright}</span>}
        </dd>
        <dt className="text-text-faint">Licence</dt>
        <dd className="text-text-soft">
          <TextLink href={licence.url}>{licence.name}</TextLink>: {licence.asks}
        </dd>
        {changes && (
          <>
            <dt className="text-text-faint">Changed</dt>
            <dd className="text-text-soft">{changes}</dd>
          </>
        )}
        <dt className="text-text-faint">Files from</dt>
        <dd className="break-all font-mono text-text-soft">
          <TextLink href={source}>{source.replace(/^https:\/\//, '')}</TextLink>
        </dd>
      </dl>
    </div>
  )
}
