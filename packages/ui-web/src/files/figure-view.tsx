/**
 * A figure of an Office file as a preview shows it (docs/SPEC.md, section 9.7): a picture from its own bytes, a chart
 * as the Chart block draws one, or a frame saying what the window cannot show.
 */

import { useEffect, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { Chart } from '../view/blocks/data.tsx'
import type { OfficeFigure } from './office-text.ts'

/** The tones a chart's series are drawn in, in order, as the Chart block colours them. */
const SERIES_TONES = ['normal', 'soft', 'ok', 'warn', 'danger', 'faint'] as const

/** Figures one beside the other, as many as fit across. */
export function Figures({ figures, urls, className }: { figures: OfficeFigure[]; urls: ReadonlyMap<OfficeFigure, string>; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-start gap-3', className)}>
      {figures.map((figure, index) => (
        <Figure key={index} figure={figure} url={urls.get(figure)} alt={figure.kind === 'chart' ? figure.title : figure.alt} block />
      ))}
    </div>
  )
}

/**
 * A figure of an Office file: a picture at the size its file gives it, never wider than where it is shown; a chart,
 * as the Chart block draws one, under its title; or, for what the window cannot show, a frame saying what it is.
 */
export function Figure({ figure, url, alt, block }: { figure: OfficeFigure; url: string | undefined; alt: string; block: boolean }) {
  if (figure.kind === 'picture')
    return url ? (
      <img
        src={url}
        alt={alt}
        width={figure.width}
        height={figure.height}
        className={cn('h-auto max-w-full rounded-xs', block ? 'block' : 'inline-block align-middle')}
      />
    ) : null
  if (figure.kind === 'chart')
    return (
      <span className="grid w-full min-w-0 gap-1.5 rounded-md border border-line px-3 py-2.5">
        {figure.title !== '' && <span className="font-medium text-[0.8125rem]">{figure.title}</span>}
        <Chart
          props={{
            kind: figure.chart,
            height: 'normal',
            series: figure.series.map((series, index) => ({ ...series, tone: SERIES_TONES[index % SERIES_TONES.length] ?? 'normal' }))
          }}
        />
      </span>
    )
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-line border-dashed px-3 py-2 text-text-faint text-xs">
      {figure.what === 'chart' ? 'A chart its app draws' : 'A picture its app shows'}
      {alt.trim() !== '' && <span className="text-text-soft">· {alt}</span>}
    </span>
  )
}

/** Addresses for the pictures of a file the window can show, made while they are shown and let go of after. */
export function useFigureUrls(figures: readonly OfficeFigure[]): ReadonlyMap<OfficeFigure, string> {
  const [urls, setUrls] = useState<ReadonlyMap<OfficeFigure, string>>(new Map())
  useEffect(() => {
    const made = new Map<OfficeFigure, string>()
    for (const figure of figures)
      if (figure.kind === 'picture' && !made.has(figure))
        made.set(figure, URL.createObjectURL(new Blob([figure.bytes as Uint8Array<ArrayBuffer>], { type: figure.type })))
    setUrls(made)
    return () => {
      for (const url of made.values()) URL.revokeObjectURL(url)
    }
  }, [figures])
  return urls
}
