/**
 * A sheet shown as it looks (docs/SPEC.md, section 9.7): its columns at their widths and its rows at their heights,
 * under the letters and beside the numbers that head them, each cell in its font, fill, borders and alignment, merged
 * cells as one, the grid where the sheet shows it, text that does not wrap running on over the empty cells beside it,
 * and the bars and icons of its conditional formats, as Excel draws them. A worksheet held as an object shows the
 * pictures it holds over its cells, cut at its edge. Made of the window's own elements, its text escaped, its colours
 * checked as they were read.
 */

import type { CSSProperties, ReactNode } from 'react'
import type { BorderLook, TextLook } from './document-look.ts'
import type { OfficeFigure, SheetPicture } from './office-text.ts'
import { SheetIcon } from './sheet-icons.tsx'
import type { CellMark, CellRun, Rotation, SheetLook } from './sheet-look.ts'
import { fontStack } from './slide-svg.ts'

const pt = (value: number) => `${Math.round(value * 100) / 100}pt`

/** The colour of the grid Excel draws between cells that set no border and no fill. */
const GRID = '#d9d9d9'

const borderCss = (border: BorderLook | undefined) => (border && border.width > 0 ? `${pt(border.width)} ${border.style} ${border.color}` : undefined)

/** A column's letters: 0 is A, 26 is AA. */
export function columnLetters(index: number): string {
  let letters = ''
  for (let left = index + 1; left > 0; left = Math.floor((left - 1) / 26)) letters = String.fromCharCode(65 + ((left - 1) % 26)) + letters
  return letters
}

export function SheetView({
  look,
  rows,
  pictures,
  urls
}: {
  look: SheetLook
  rows: readonly (readonly string[])[]
  /** The pictures over its cells, and the addresses they are shown from. */
  pictures?: readonly SheetPicture[] | undefined
  urls?: ReadonlyMap<OfficeFigure, string> | undefined
}): ReactNode {
  const { columns, cells, looks, merges } = look
  // Where merged cells start, and the cells they cover.
  const starts = new Map<string, { rows: number; columns: number }>()
  const covered = new Set<string>()
  for (const merge of merges) {
    starts.set(`${merge.row},${merge.column}`, merge)
    for (let row = merge.row; row < merge.row + merge.rows; row++)
      for (let column = merge.column; column < merge.column + merge.columns; column++)
        if (row !== merge.row || column !== merge.column) covered.add(`${row},${column}`)
  }
  const lookAt = (row: number, column: number) => {
    const index = cells[row]?.[column]
    return index === undefined ? undefined : looks[index]
  }
  const empty = (row: number, column: number) => (rows[row]?.[column] ?? '') === '' && !covered.has(`${row},${column}`) && !starts.has(`${row},${column}`)
  const shownColumns = columns.map((width, index) => ({ width, index })).filter((column) => column.width > 0)
  const width = shownColumns.reduce((sum, column) => sum + column.width, 0)
  const heading: CSSProperties = {
    backgroundColor: '#f3f3f3',
    color: '#5f5f5f',
    fontFamily: 'sans-serif',
    fontSize: '8pt',
    fontWeight: 400,
    textAlign: 'center',
    borderRight: `0.75pt solid ${GRID}`,
    borderBottom: `0.75pt solid ${GRID}`,
    padding: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap'
  }
  // Pictures over the cells are scaled with them, and cut where the sheet ends.
  const placed = pictures !== undefined && pictures.length > 0
  const zoom = look.zoom === 1 ? undefined : look.zoom
  return (
    <div className="scroll-quiet overflow-auto rounded-xs">
      <div style={placed ? ({ zoom, position: 'relative', width: 'fit-content', overflow: 'hidden' } as CSSProperties) : undefined}>
        <table
          style={
            {
              zoom: placed ? undefined : zoom,
              borderCollapse: 'separate',
              borderSpacing: 0,
              tableLayout: 'fixed',
              width: pt(width + (look.headings ? 30 : 0)),
              backgroundColor: '#ffffff',
              color: '#000000',
              fontFamily: look.text.font ? fontStack(look.text.font) : undefined,
              fontSize: pt(look.text.size ?? 11)
            } as CSSProperties
          }
        >
          <colgroup>
            {look.headings && <col style={{ width: '30pt' }} />}
            {shownColumns.map((column) => (
              <col key={column.index} style={{ width: pt(column.width) }} />
            ))}
          </colgroup>
          {look.headings && (
            <thead>
              <tr style={{ height: '15pt' }}>
                <th style={heading} aria-label="Sheet" />
                {shownColumns.map((column) => (
                  <th key={column.index} scope="col" style={heading}>
                    {columnLetters(column.index)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {look.rows.map((height, row) =>
              height <= 0 ? null : (
                <tr key={row} style={{ height: pt(height) }}>
                  {look.headings && (
                    <th scope="row" style={heading}>
                      {row + 1}
                    </th>
                  )}
                  {shownColumns.map(({ index: column }) => {
                    if (covered.has(`${row},${column}`)) return null
                    const merged = starts.get(`${row},${column}`)
                    const cell = lookAt(row, column)
                    const mark = look.marks?.[row]?.[column]
                    // A value its conditional format hides leaves its bar or its icon alone.
                    const text = mark?.hidden ? '' : (rows[row]?.[column] ?? '')
                    // An icon as tall as the cell's text, within its row.
                    const icon = mark?.icon ? Math.max(6, Math.min(cell?.text.size ?? look.text.size ?? 11, height - 2)) : 0
                    // Each edge is drawn once, by the cell before it, from either cell's border, else the grid.
                    const last = { row: row + (merged?.rows ?? 1) - 1, column: column + (merged?.columns ?? 1) - 1 }
                    const right = cell?.borders.right ?? lookAt(row, last.column + 1)?.borders.left
                    const below = cell?.borders.bottom ?? lookAt(last.row + 1, column)?.borders.top
                    const filled = cell?.fill !== undefined
                    const gridRight =
                      look.grid && !filled && lookAt(row, last.column + 1)?.fill === undefined ? `0.75pt solid ${GRID}` : '0.75pt solid transparent'
                    const gridBelow =
                      look.grid && !filled && lookAt(last.row + 1, column)?.fill === undefined ? `0.75pt solid ${GRID}` : '0.75pt solid transparent'
                    // Text that does not wrap runs on over the empty cells on the side it is aligned from, up to the next that holds something.
                    const free = (step: 1 | -1) => {
                      let width = 0
                      for (let at = column + step; at >= 0 && at < columns.length && empty(row, at); at += step) width += columns[at] ?? 0
                      return width
                    }
                    const own = columns[column] ?? 0
                    // Turned text stays in its cell's box, as it is drawn there.
                    const turn = text === '' ? undefined : cell?.rotation
                    const runs = !cell?.wrap && text !== '' && merged === undefined && turn === undefined
                    const before = runs && cell?.align !== 'left' && cell?.align !== 'justify' ? free(-1) : 0
                    const after = runs && cell?.align !== 'right' ? free(1) : 0
                    const reach =
                      cell?.align === 'right'
                        ? { start: before, end: 0 }
                        : cell?.align === 'center'
                          ? { start: Math.min(before, after), end: Math.min(before, after) }
                          : { start: 0, end: after }
                    const spills = reach.start + reach.end > 0
                    const style: CSSProperties = {
                      padding: 0,
                      backgroundColor: cell?.fill,
                      borderRight: borderCss(right) ?? gridRight,
                      borderBottom: borderCss(below) ?? gridBelow,
                      borderTop: row === 0 ? borderCss(cell?.borders.top) : undefined,
                      borderLeft: column === 0 ? borderCss(cell?.borders.left) : undefined,
                      verticalAlign: cell?.vertical ?? 'bottom',
                      overflow: spills || turn !== undefined ? 'visible' : 'hidden',
                      ...(turn === undefined ? {} : { position: 'relative', textAlign: cell?.align ?? 'left' }),
                      ...(mark ? { position: 'relative' } : {})
                    }
                    // A cell whose text is in stretches leaves the lines under and through it to them, which cannot take a line away.
                    const stretched = look.runs?.[row]?.[column]
                    const lines: CSSProperties = stretched && stretched.length > 0 ? { textDecorationLine: undefined, textDecorationStyle: undefined } : {}
                    const content: CSSProperties = {
                      ...textCss(cell),
                      ...lines,
                      padding: `0 ${pt(1.5)} 0 ${pt(1.5 + (cell?.align === 'left' ? (cell.indent ?? 0) : 0) + (icon > 0 ? icon + 1.5 : 0))}`,
                      paddingRight: cell?.align === 'right' && cell.indent ? pt(1.5 + cell.indent) : undefined,
                      textAlign: cell?.align ?? 'left',
                      whiteSpace: cell?.wrap ? 'pre-wrap' : 'pre',
                      overflowWrap: cell?.wrap ? 'break-word' : undefined,
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      // Over the cell's bar, which is drawn under its text.
                      ...(mark ? { position: 'relative' } : {}),
                      ...(spills ? { width: pt(own + reach.start + reach.end), marginLeft: reach.start > 0 ? pt(-reach.start) : undefined } : {})
                    }
                    return (
                      <td
                        key={column}
                        colSpan={
                          merged && merged.columns > 1
                            ? shownColumns.filter((one) => one.index >= column && one.index < column + merged.columns).length
                            : undefined
                        }
                        rowSpan={merged && merged.rows > 1 ? look.rows.slice(row, row + merged.rows).filter((one) => one > 0).length : undefined}
                        style={style}
                      >
                        {mark && <Marks mark={mark} icon={icon} vertical={cell?.vertical ?? 'bottom'} />}
                        {text !== '' && turn === undefined && <div style={content}>{stretches(text, stretched)}</div>}
                        {turn !== undefined && <div style={{ ...turnedCss(cell, turn), ...lines }}>{stretches(text, stretched)}</div>}
                      </td>
                    )
                  })}
                </tr>
              )
            )}
          </tbody>
        </table>
        {placed &&
          pictures.map((picture, index) => {
            const url = urls?.get(picture.figure)
            return url ? (
              <img
                key={index}
                src={url}
                alt={picture.figure.alt}
                style={{
                  position: 'absolute',
                  left: pt(picture.left + (look.headings ? 30 : 0)),
                  top: pt(picture.top + (look.headings ? 15 : 0)),
                  width: pt(picture.width),
                  height: pt(picture.height),
                  maxWidth: 'none'
                }}
              />
            ) : null
          })}
      </div>
    </div>
  )
}

/**
 * What a cell's conditional formats draw under and beside its text: a data bar from its start or either way from its
 * axis, fading to white where it is a gradient and drawn dashed at the axis, and an icon at its left edge.
 */
function Marks({ mark, icon, vertical }: { mark: CellMark; icon: number; vertical: 'top' | 'middle' | 'bottom' }): ReactNode {
  const { bar } = mark
  const backwards = bar?.axis !== undefined && bar.end <= bar.axis + 1e-9
  return (
    <>
      {bar && bar.end > bar.start && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${bar.start * 100}%`,
            width: `${(bar.end - bar.start) * 100}%`,
            top: pt(1.5),
            bottom: pt(1.5),
            background: bar.gradient
              ? `linear-gradient(to ${backwards ? 'left' : 'right'}, ${bar.color}, color-mix(in srgb, ${bar.color} 12%, #ffffff))`
              : bar.color,
            border: bar.border ? `0.75pt solid ${bar.border}` : undefined,
            boxSizing: 'border-box'
          }}
        />
      )}
      {bar?.axis !== undefined && bar.axis > 0 && (
        <div aria-hidden="true" style={{ position: 'absolute', left: `${bar.axis * 100}%`, top: 0, bottom: 0, borderLeft: '0.75pt dashed #000000' }} />
      )}
      {mark.icon && (
        <div
          style={{
            position: 'absolute',
            left: pt(1.5),
            ...(vertical === 'top' ? { top: pt(1) } : vertical === 'middle' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: pt(1) })
          }}
        >
          <SheetIcon set={mark.icon.set} index={mark.icon.index} size={pt(icon)} />
        </div>
      )}
    </>
  )
}

/**
 * Turned text, drawn as Excel draws it: a quarter turn or letters stacked as a line running down, read from the
 * bottom when it turns counterclockwise; any other angle as its line turned at the edge it sits on.
 */
function turnedCss(cell: SheetLook['looks'][number] | undefined, turn: Rotation): CSSProperties {
  const text = { ...textCss(cell), whiteSpace: 'pre', lineHeight: 1.2 } as const
  if (turn === 'stacked' || Math.abs(turn) === 90)
    return {
      ...text,
      display: 'inline-block',
      padding: `${pt(1.5)} 0`,
      writingMode: 'vertical-rl',
      textOrientation: turn === 'stacked' ? 'upright' : undefined,
      transform: turn === 90 ? 'rotate(180deg)' : undefined
    }
  // Turned about its middle when centred either way, else about the corner that stays nearest the edge it sits on:
  // the start of a line that rises from the bottom or falls from the top, the end of one that falls to the bottom or
  // rises to the top.
  if (cell?.align === 'center' || cell?.align === 'right' || cell?.vertical === 'middle')
    return { ...text, position: 'absolute', left: '50%', top: '50%', transformOrigin: 'left top', transform: `rotate(${-turn}deg) translate(-50%, -50%)` }
  const top = cell?.vertical === 'top'
  return {
    ...text,
    position: 'absolute',
    left: pt(1.5),
    top: top ? 0 : undefined,
    bottom: top ? undefined : 0,
    transformOrigin: `${turn > 0 !== top ? 'left' : 'right'} ${top ? 'top' : 'bottom'}`,
    transform: `rotate(${-turn}deg)`
  }
}

/**
 * A cell's text, in the fonts of its stretches when it has them, each its whole font: the cell's own lines under and
 * through its text are drawn by the stretches that have them.
 */
function stretches(text: string, runs: readonly CellRun[] | undefined): ReactNode {
  if (!runs || runs.length === 0) return text
  return runs.map((run, index) => {
    const part = text.slice(run.start, runs[index + 1]?.start ?? text.length)
    return part === '' ? null : (
      <span key={run.start} style={{ ...lookCss(run.text), display: 'inline' }}>
        {part}
      </span>
    )
  })
}

function textCss(cell: SheetLook['looks'][number] | undefined): CSSProperties {
  return lookCss(cell?.text)
}

function lookCss(look: TextLook | undefined): CSSProperties {
  if (!look) return {}
  const lines = [look.underline ? 'underline' : '', look.struck ? 'line-through' : ''].filter(Boolean).join(' ')
  return {
    fontFamily: look.font ? fontStack(look.font) : undefined,
    fontSize: look.size !== undefined ? pt(look.position ? look.size * 0.65 : look.size) : undefined,
    color: look.color,
    fontWeight: look.bold ? 700 : 400,
    fontStyle: look.italic ? 'italic' : 'normal',
    textDecorationLine: lines || undefined,
    textDecorationStyle: look.underline === 'double' ? 'double' : undefined,
    verticalAlign: look.position
  }
}
