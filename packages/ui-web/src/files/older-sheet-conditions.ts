/**
 * The conditional formats of a sheet of an Excel workbook of 97 to 2003 (docs/SPEC.md, section 9.7), read into
 * `conditional-formats.ts` from the records `binary-office.ts` keeps: each block's header (`CFHEADER`), the cells it
 * applies to, then its conditions (`CF`), up to three, each a comparison of the cell's value or a formula, in the tokens
 * of Excel 97, with the font, borders and fill it sets. Of a block's conditions, the first that holds applies.
 */

import { reader } from './binary-records.ts'
import type { Block, Condition, ConditionRule } from './conditional-formats.ts'
import type { BorderLook, Sides, TextLook } from './document-look.ts'
import { EXCEL_LINES } from './older-sheet-look.ts'
import { type Formula, readFormulaTokens } from './sheet-formula.ts'
import { type ConditionLook, paletteColor, type WorkbookColors } from './sheet-look.ts'

/** A record of a sheet's conditional formats, by its type. */
export interface ConditionRecord {
  type: number
  bytes: Uint8Array
}

const COMPARISONS: readonly (Extract<ConditionRule, { kind: 'compare' }>['operator'] | undefined)[] = [
  undefined,
  'between',
  'notBetween',
  '=',
  '<>',
  '>',
  '<',
  '>=',
  '<='
]

/** What a condition sets (`DXFN`): only what it does not mark as unchanged, each part present by its flag. */
function lookOf(bytes: Uint8Array, from: number, colors: Pick<WorkbookColors, 'palette'>): { look: ConditionLook; end: number } {
  const record = reader(bytes)
  const flags = record.u32(from)
  const more = record.u16(from + 4)
  const unchanged = (bit: number) => (flags & (1 << bit)) !== 0
  // Colours from 64 on are the system's: the text's automatic one.
  const color = (index: number) => (index >= 0 && index < 64 ? paletteColor(index, colors) : undefined)
  const look: ConditionLook = {}
  let at = from + 6
  // A number format, its own or Excel's by its number, which the look leaves out.
  if (flags & 0x0200_0000) at += more & 0x0001 ? record.u16(at) : 2
  if (flags & 0x0400_0000) {
    const text: TextLook = {}
    const style = record.u32(at + 68)
    const same = record.u32(at + 88)
    if (!(same & 0x02)) text.italic = (style & 0x02) !== 0
    if (!(same & 0x80)) text.struck = (style & 0x80) !== 0
    if (record.u32(at + 100) === 0) text.bold = record.u16(at + 72) >= 600
    if (record.u32(at + 96) === 0) {
      const underline = record.u8(at + 76)
      text.underline = underline === 0 ? undefined : underline === 2 || underline === 0x22 ? 'double' : 'solid'
    }
    const ink = record.i32(at + 80)
    if (ink !== -1 && color(ink)) text.color = color(ink)
    if (Object.keys(text).length > 0) look.text = text
    at += 118
  }
  if (flags & 0x0800_0000) at += 8
  if (flags & 0x1000_0000) {
    const [lines, inks] = [record.u32(at), record.u32(at + 4)]
    const side = (kind: number, ink: number): BorderLook => {
      const line = EXCEL_LINES[kind]
      return line ? { ...line, color: color(ink) ?? '#000000' } : { width: 0, style: 'solid', color: '#000000' }
    }
    const borders: Sides<BorderLook> = {}
    if (!unchanged(10)) borders.left = side(lines & 0x0f, (lines >>> 16) & 0x7f)
    if (!unchanged(11)) borders.right = side((lines >>> 4) & 0x0f, (lines >>> 23) & 0x7f)
    if (!unchanged(12)) borders.top = side((lines >>> 8) & 0x0f, inks & 0x7f)
    if (!unchanged(13)) borders.bottom = side((lines >>> 12) & 0x0f, (inks >>> 7) & 0x7f)
    if (Object.keys(borders).length > 0) look.borders = borders
    at += 8
  }
  if (flags & 0x2000_0000) {
    const pattern = (record.u16(at) >>> 10) & 0x3f
    const inks = record.u16(at + 2)
    // A solid fill is in its background colour, unlike a style's; no pattern at all is no fill.
    const fill = !unchanged(18) ? color((inks >>> 7) & 0x7f) : !unchanged(17) ? color(inks & 0x7f) : undefined
    if (unchanged(16) || pattern !== 0) {
      if (fill) look.fill = fill
    }
    at += 4
  }
  if (flags & 0x4000_0000) at += 2
  return { look, end: at }
}

/** A sheet's conditional formats, from its records in order, with the workbook's palette. */
export function readOlderConditions(records: readonly ConditionRecord[], colors: Pick<WorkbookColors, 'palette'>): Condition[] {
  const conditions: Condition[] = []
  let block: { blocks: Block[]; anchor: { row: number; column: number }; left: number; group: number } | undefined
  let group = 0
  for (const { type, bytes } of records) {
    try {
      const record = reader(bytes)
      if (type === 0x01b0) {
        // The cells it applies to, after the block that bounds them, whose first cell its formulas are written for.
        const count = record.u16(12)
        const blocks: Block[] = []
        for (let index = 0; index < Math.min(count, 512); index++) {
          const at = 14 + index * 8
          const [first, last, from, to] = [record.u16(at), record.u16(at + 2), record.u16(at + 4), record.u16(at + 6)]
          if (last >= first && to >= from) blocks.push({ row: first, column: from, rows: last - first + 1, columns: to - from + 1 })
        }
        block = { blocks, anchor: { row: record.u16(4), column: record.u16(8) }, left: record.u16(0), group: group++ }
        continue
      }
      if (type !== 0x01b1 || !block || block.left <= 0) continue
      block.left--
      const [kind, comparison, firstSize, secondSize] = [record.u8(0), record.u8(1), record.u16(2), record.u16(4)]
      const { look, end } = lookOf(bytes, 6, colors)
      const first = readFormulaTokens(record.bytes(end, firstSize), block.anchor)
      const second = secondSize > 0 ? readFormulaTokens(record.bytes(end + firstSize, secondSize), block.anchor) : undefined
      let rule: ConditionRule | undefined
      const operator = COMPARISONS[comparison]
      if (kind === 1 && operator && first) {
        const operands: Formula[] = operator === 'between' || operator === 'notBetween' ? (second ? [first, second] : []) : [first]
        if (operands.length > 0) rule = { kind: 'compare', operator, operands, look }
      } else if (kind === 2 && first) rule = { kind: 'formula', formula: first, look }
      if (rule) conditions.push({ blocks: block.blocks, anchor: block.anchor, priority: conditions.length, stop: true, group: block.group, rule })
    } catch {
      // A record cut short is passed over.
    }
  }
  return conditions
}
