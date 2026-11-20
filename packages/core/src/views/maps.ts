import { checkJoin, type Regions, readRegions, type ViewSpec } from '@repo/catalog'
import type { Web } from '../ports/web.ts'
import { keptReadings } from './readings.ts'

/** The largest GeoJSON a map may name. A detailed file of every commune is bigger, and too heavy to draw. */
const MAX_BYTES = 25 * 1024 * 1024
const TIMEOUT_MS = 20_000
/** How many documents are kept read, the latest used first. A map drawn again needs no new reading. */
const KEPT = 8

export type ReadRegions = { ok: true; regions: Regions } | { ok: false; problem: string }

export interface Maps {
  /** The areas at this address: read once, then kept a while. */
  regions(url: string): Promise<ReadRegions>
  /**
   * Check every map of a view against the shapes it names. Problems stop the view, so the model corrects it;
   * notes are told to the model with the view shown.
   */
  check(spec: ViewSpec): Promise<{ problems: string[]; notes: string[] }>
}

/**
 * The maps of the screen. The core reads the shapes a map names before it is shown, so that a property that
 * does not exist or codes that match nothing come back to the model as something to correct, and serves them
 * to the clients, which then need no access of their own to the address.
 */
export function createMaps(web: Web | undefined): Maps {
  const kept = keptReadings<ReadRegions>(KEPT)

  const regions = (url: string): Promise<ReadRegions> =>
    kept(url, async () => {
      if (!web) return { ok: false, problem: 'this core cannot read the web.' }
      const read = await web.read(url, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS })
      if (!read.ok) return { ok: false, problem: read.reason }
      try {
        const found = readRegions(JSON.parse(read.text))
        return found.ok ? found : { ok: false, problem: found.problem }
      } catch {
        return { ok: false, problem: 'it is not JSON. Give the address of the GeoJSON file itself, not of a page about it.' }
      }
    })

  return {
    regions,
    async check(spec) {
      const problems: string[] = []
      const notes: string[] = []
      await Promise.all(
        Object.entries(spec.elements).map(async ([id, element]) => {
          if (element.type === 'RegionMap') {
            const props = element.props as { shapes: string; key: string; name?: string; values: { region: string }[]; onlyValued: boolean }
            const read = await regions(props.shapes)
            if (!read.ok) return void problems.push(`"${id}" (RegionMap): shapes: ${props.shapes} could not be used: ${read.problem}`)
            const join = checkJoin(read.regions, props)
            problems.push(...join.problems.map((problem) => `"${id}" (RegionMap): ${problem}`))
            notes.push(...join.notes.map((note) => `"${id}": ${note}`))
          } else if (element.type === 'PlaceMap') {
            const outline = (element.props as { outline?: string }).outline
            if (outline === undefined) return
            const read = await regions(outline)
            if (!read.ok) problems.push(`"${id}" (PlaceMap): outline: ${outline} could not be used: ${read.problem}`)
          }
        })
      )
      return { problems, notes }
    }
  }
}
