/**
 * The formulas of a sheet's conditional formats (docs/SPEC.md, section 9.7): read from their text as Excel and
 * OpenDocument write them, or from the tokens of Excel 97, and worked out for a cell from the values its sheet keeps.
 * Only what conditions use is known: a formula that names anything else, another sheet or a function not here, is not
 * read, and its condition never holds.
 */

/** A value as a formula sees it: a number, text, a truth, an error, or nothing, an empty cell's. */
export type FormulaValue = number | string | boolean | FormulaError | null

export interface FormulaError {
  error: string
}

/** A cell of a sheet, from 0. */
export interface Place {
  row: number
  column: number
}

/**
 * A cell a formula names, where it is as written for the cell its formula is written for: one not `fixed` moves with
 * the cell the formula is worked out for.
 */
export interface FormulaCell extends Place {
  rowFixed: boolean
  columnFixed: boolean
}

export type Comparison = '=' | '<>' | '<' | '>' | '<=' | '>='
type Operator = '+' | '-' | '*' | '/' | '^' | '&' | Comparison

export type Formula =
  | { kind: 'value'; value: FormulaValue }
  | { kind: 'cell'; cell: FormulaCell }
  | { kind: 'range'; from: FormulaCell; to: FormulaCell }
  | { kind: 'unary'; operator: '-' | '+' | '%'; operand: Formula }
  | { kind: 'binary'; operator: Operator; left: Formula; right: Formula }
  | { kind: 'call'; name: string; operands: Formula[] }

/** The last row a whole column reaches, as Excel counts them; a formula reads no further than its sheet's cells. */
const WHOLE_COLUMN = 1_048_575

/** How deep a formula is read: deeper, it is not. */
const DEPTH_LIMIT = 64

/** The most cells a formula reads in all: past them, it gives an error. */
const CELL_LIMIT = 100_000

const error = (code: string): FormulaError => ({ error: code })
const isError = (value: unknown): value is FormulaError => typeof value === 'object' && value !== null && 'error' in value

// Reading a formula's text.

type Token =
  | { kind: 'value'; value: FormulaValue }
  | { kind: 'reference'; formula: Formula }
  | { kind: 'name'; name: string }
  | { kind: 'operator'; text: string }
  | { kind: 'open' | 'close' | 'separator' }

/** A column's number from its letters, from 0; none past the last Excel has. */
function columnNumber(letters: string): number | undefined {
  let column = 0
  for (const letter of letters.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64)
  return column >= 1 && column <= 16_384 ? column - 1 : undefined
}

/** Whether a sheet named in a reference is the formula's own: none named is. */
const ownSheet = (named: string | undefined, sheet: string | undefined) =>
  named === undefined ||
  named === '' ||
  (sheet !== undefined &&
    named
      .replace(/^\$/, '')
      .replace(/^'(.*)'$/, '$1')
      .replace(/''/g, "'") === sheet)

const ERRORS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']

/** A cell as an OpenDocument reference writes it, `$Sheet1.$A$1` or `.A1`; none for another sheet's or one not read. */
function openCell(text: string, sheet: string | undefined): FormulaCell | undefined {
  const found = /^((?:\$?'(?:[^']|'')*'|[^.]*))\.(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(text.trim())
  if (!found || !ownSheet(found[1], sheet)) return undefined
  const column = columnNumber(found[3] as string)
  const row = Number(found[5]) - 1
  return column === undefined || row < 0 ? undefined : { row, column, rowFixed: found[4] === '$', columnFixed: found[2] === '$' }
}

/** The tokens of a formula's text, as Excel writes them or OpenDocument (`[.A1]`, `;` between operands). */
function tokens(text: string, sheet: string | undefined): Token[] {
  const found: Token[] = []
  let at = 0
  const rest = () => text.slice(at)
  while (at < text.length) {
    const character = text[at] as string
    if (/\s/.test(character)) {
      at++
      continue
    }
    if (character === '"') {
      let value = ''
      at++
      for (;;) {
        if (at >= text.length) throw new Error('A string is not closed.')
        if (text[at] === '"') {
          if (text[at + 1] === '"') {
            value += '"'
            at += 2
            continue
          }
          at++
          break
        }
        value += text[at]
        at++
      }
      found.push({ kind: 'value', value })
      continue
    }
    if (character === '[') {
      const end = text.indexOf(']', at)
      if (end < 0) throw new Error('A reference is not closed.')
      const [first = '', last, ...more] = text.slice(at + 1, end).split(':')
      const from = openCell(first, sheet)
      const to = last === undefined ? undefined : openCell(last.includes('.') ? last : `.${last}`, sheet)
      if (!from || more.length > 0 || (last !== undefined && !to)) throw new Error('A reference is not read.')
      found.push({ kind: 'reference', formula: to ? { kind: 'range', from, to } : { kind: 'cell', cell: from } })
      at = end + 1
      continue
    }
    const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest())
    // A number, unless it starts a row's reference, which conditions do not use.
    if (number) {
      found.push({ kind: 'value', value: Number(number[0]) })
      at += number[0].length
      continue
    }
    const named = ERRORS.find((one) => rest().toUpperCase().startsWith(one))
    if (named) {
      found.push({ kind: 'value', value: error(named) })
      at += named.length
      continue
    }
    // A cell or a block of cells of Excel, perhaps on its sheet by name, or whole columns.
    const reference =
      /^(?:('(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?(?![\w.(])/.exec(rest()) ??
      /^(?:('(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w.(])/.exec(rest())
    if (reference) {
      if (!ownSheet(reference[1], sheet)) throw new Error('Another sheet is named.')
      const whole = reference.length === 6
      const cell = (fixedColumn: string, letters: string, fixedRow: string, digits: string | undefined): FormulaCell => {
        const column = columnNumber(letters)
        const row = digits === undefined ? 0 : Number(digits) - 1
        if (column === undefined || row < 0) throw new Error('A cell is out of the sheet.')
        return { row, column, rowFixed: digits === undefined || fixedRow === '$', columnFixed: fixedColumn === '$' }
      }
      if (whole) {
        const from = cell(reference[2] ?? '', reference[3] ?? '', '$', undefined)
        const to = { ...cell(reference[4] ?? '', reference[5] ?? '', '$', undefined), row: WHOLE_COLUMN }
        found.push({ kind: 'reference', formula: { kind: 'range', from, to } })
      } else {
        const from = cell(reference[2] ?? '', reference[3] ?? '', reference[4] ?? '', reference[5])
        found.push({
          kind: 'reference',
          formula:
            reference[7] === undefined
              ? { kind: 'cell', cell: from }
              : { kind: 'range', from, to: cell(reference[6] ?? '', reference[7], reference[8] ?? '', reference[9]) }
        })
      }
      at += reference[0].length
      continue
    }
    const name = /^(?:of:)?[A-Za-z_][\w.]*/i.exec(rest())
    if (name) {
      // A function's name keeps its prefix out (`_xlfn.`, `of:`, `com.microsoft.`).
      const bare = name[0].replace(/^(_xlfn\.|_xlws\.|of:|com\.microsoft\.|org\.openoffice\.)/i, '').toUpperCase()
      found.push(bare === 'TRUE' || bare === 'FALSE' ? { kind: 'value', value: bare === 'TRUE' } : { kind: 'name', name: bare })
      at += name[0].length
      continue
    }
    const operator = /^(<=|>=|<>|!=|[-+*/^&=<>%])/.exec(rest())
    if (operator) {
      found.push({ kind: 'operator', text: operator[0] === '!=' ? '<>' : operator[0] })
      at += operator[0].length
      continue
    }
    if (character === '(' || character === ')') found.push({ kind: character === '(' ? 'open' : 'close' })
    else if (character === ',' || character === ';') found.push({ kind: 'separator' })
    else throw new Error(`"${character}" is not read.`)
    at++
  }
  return found
}

const COMPARISONS: readonly string[] = ['=', '<>', '<', '>', '<=', '>=']

/**
 * A formula's text, as Excel writes it (`$A1>5`, `MOD(ROW(),2)=0`) or OpenDocument (`of:=[.A1]>5`, `;` between the
 * operands of a function), on a sheet of this name; none when it names another sheet or anything not read here.
 */
export function readFormula(text: string, sheet?: string): Formula | undefined {
  try {
    const list = tokens(text.replace(/^\s*(of:)?\s*=?/i, ''), sheet)
    let at = 0
    let depth = 0
    const peek = () => list[at]
    const operatorIs = (...texts: string[]) => {
      const token = peek()
      return token?.kind === 'operator' && texts.includes(token.text) ? token.text : undefined
    }
    const binary =
      (next: () => Formula, ...operators: string[]) =>
      (): Formula => {
        let left = next()
        for (let operator = operatorIs(...operators); operator; operator = operatorIs(...operators)) {
          at++
          left = { kind: 'binary', operator: operator as Operator, left, right: next() }
        }
        return left
      }
    const primary = (): Formula => {
      if (++depth > DEPTH_LIMIT) throw new Error('The formula is too deep.')
      try {
        const token = list[at++]
        if (!token) throw new Error('The formula ends too soon.')
        if (token.kind === 'value') return { kind: 'value', value: token.value }
        if (token.kind === 'reference') return token.formula
        if (token.kind === 'operator' && (token.text === '-' || token.text === '+')) return { kind: 'unary', operator: token.text, operand: primary() }
        if (token.kind === 'open') {
          const inner = comparison()
          if (list[at++]?.kind !== 'close') throw new Error('A bracket is not closed.')
          return inner
        }
        if (token.kind === 'name' && peek()?.kind === 'open') {
          at++
          const operands: Formula[] = []
          if (peek()?.kind === 'close') at++
          else
            for (;;) {
              const next = peek()
              operands.push(next?.kind === 'separator' || next?.kind === 'close' ? { kind: 'value', value: null } : comparison())
              const after = list[at++]
              if (after?.kind === 'close') break
              if (after?.kind !== 'separator') throw new Error('A function is not closed.')
            }
          return { kind: 'call', name: token.name, operands }
        }
        throw new Error('The formula is not read.')
      } finally {
        depth--
      }
    }
    const percent = (): Formula => {
      let operand = primary()
      while (operatorIs('%')) {
        at++
        operand = { kind: 'unary', operator: '%', operand }
      }
      return operand
    }
    const power = binary(percent, '^')
    const product = binary(power, '*', '/')
    const sum = binary(product, '+', '-')
    const joined = binary(sum, '&')
    const comparison: () => Formula = binary(joined, ...COMPARISONS)
    const formula = comparison()
    return at === list.length ? formula : undefined
  } catch {
    return undefined
  }
}

// Reading a formula's tokens, as Excel 97 keeps them.

/** The functions of Excel 97 conditions use, by their number, with how many operands each takes when it says none. */
const FUNCTIONS_BY_NUMBER: Record<number, [string, number?]> = {
  0: ['COUNT'],
  1: ['IF'],
  2: ['ISNA', 1],
  3: ['ISERROR', 1],
  4: ['SUM'],
  5: ['AVERAGE'],
  6: ['MIN'],
  7: ['MAX'],
  8: ['ROW'],
  9: ['COLUMN'],
  10: ['NA', 0],
  24: ['ABS', 1],
  25: ['INT', 1],
  26: ['SIGN', 1],
  27: ['ROUND', 2],
  31: ['MID', 3],
  32: ['LEN', 1],
  33: ['VALUE', 1],
  34: ['TRUE', 0],
  35: ['FALSE', 0],
  36: ['AND'],
  37: ['OR'],
  38: ['NOT', 1],
  39: ['MOD', 2],
  65: ['DATE', 3],
  67: ['DAY', 1],
  68: ['MONTH', 1],
  69: ['YEAR', 1],
  70: ['WEEKDAY'],
  74: ['NOW', 0],
  82: ['SEARCH'],
  112: ['LOWER', 1],
  113: ['UPPER', 1],
  115: ['LEFT'],
  116: ['RIGHT'],
  117: ['EXACT', 2],
  118: ['TRIM', 1],
  124: ['FIND'],
  126: ['ISERR', 1],
  127: ['ISTEXT', 1],
  128: ['ISNUMBER', 1],
  129: ['ISBLANK', 1],
  169: ['COUNTA'],
  190: ['ISNONTEXT', 1],
  198: ['ISLOGICAL', 1],
  221: ['TODAY', 0],
  336: ['CONCATENATE'],
  346: ['COUNTIF', 2],
  347: ['COUNTBLANK', 1]
}

const TOKEN_OPERATORS = new Map<number, Operator>([
  [0x03, '+'],
  [0x04, '-'],
  [0x05, '*'],
  [0x06, '/'],
  [0x07, '^'],
  [0x08, '&'],
  [0x09, '<'],
  [0x0a, '<='],
  [0x0b, '='],
  [0x0c, '>='],
  [0x0d, '>'],
  [0x0e, '<>']
])

const ERROR_CODES = new Map<number, string>([
  [0x00, '#NULL!'],
  [0x07, '#DIV/0!'],
  [0x0f, '#VALUE!'],
  [0x17, '#REF!'],
  [0x1d, '#NAME?'],
  [0x24, '#NUM!'],
  [0x2a, '#N/A']
])

/**
 * A formula of Excel 97 from its tokens (`Rgce`), written for the cell `anchor`: those of a cell's place (`PtgRefN`)
 * read from there. None when it holds a token not read here, such as another sheet's cells or a name.
 */
export function readFormulaTokens(bytes: Uint8Array, anchor: Place): Formula | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const stack: Formula[] = []
  const pop = () => {
    const last = stack.pop()
    if (!last) throw new Error('A token has no operand.')
    return last
  }
  // A cell as a reference keeps it: its row, and its column with whether each is relative in its top bits.
  const cell = (row: number, field: number, near: boolean): FormulaCell => {
    const rowRelative = (field & 0x8000) !== 0
    const columnRelative = (field & 0x4000) !== 0
    // A reference of a cell's place keeps how far it is from the cell, its column in a signed byte.
    const rowAt = near && rowRelative ? anchor.row + ((row << 16) >> 16) : row
    const columnAt = near && columnRelative ? anchor.column + ((field << 24) >> 24) : field & 0x3fff
    return { row: rowAt, column: columnAt, rowFixed: !rowRelative, columnFixed: !columnRelative }
  }
  try {
    let at = 0
    while (at < bytes.length) {
      const token = bytes[at++] as number
      const base = token >= 0x20 ? (token & 0x1f) | 0x20 : token
      const operator = TOKEN_OPERATORS.get(token)
      if (operator) {
        const right = pop()
        stack.push({ kind: 'binary', operator, left: pop(), right })
      } else if (token === 0x12 || token === 0x13 || token === 0x14) {
        stack.push({ kind: 'unary', operator: token === 0x12 ? '+' : token === 0x13 ? '-' : '%', operand: pop() })
      } else if (token === 0x15) {
        // Brackets change nothing in a formula already in order.
      } else if (token === 0x16) stack.push({ kind: 'value', value: null })
      else if (token === 0x17) {
        const length = view.getUint8(at)
        const wide = (view.getUint8(at + 1) & 0x01) !== 0
        const start = at + 2
        const text = wide
          ? String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint16(start + index * 2, true)))
          : String.fromCharCode(...bytes.subarray(start, start + length))
        if (start + length * (wide ? 2 : 1) > bytes.length) throw new Error('A string is cut short.')
        stack.push({ kind: 'value', value: text })
        at = start + length * (wide ? 2 : 1)
      } else if (token === 0x19) {
        const flags = view.getUint8(at)
        // A choice keeps its jumps after it; a sum of one operand stands for SUM.
        at += flags & 0x04 ? 3 + (view.getUint16(at + 1, true) + 1) * 2 : 3
        if (flags & 0x10) stack.push({ kind: 'call', name: 'SUM', operands: [pop()] })
      } else if (token === 0x1c) stack.push({ kind: 'value', value: error(ERROR_CODES.get(view.getUint8(at++)) ?? '#N/A') })
      else if (token === 0x1d) stack.push({ kind: 'value', value: view.getUint8(at++) !== 0 })
      else if (token === 0x1e) {
        stack.push({ kind: 'value', value: view.getUint16(at, true) })
        at += 2
      } else if (token === 0x1f) {
        stack.push({ kind: 'value', value: view.getFloat64(at, true) })
        at += 8
      } else if (base === 0x21 || base === 0x22) {
        const count = base === 0x22 ? view.getUint8(at++) & 0x7f : undefined
        const number = view.getUint16(at, true)
        at += 2
        const [name, fixed] = FUNCTIONS_BY_NUMBER[number & 0x7fff] ?? []
        const operands = count ?? fixed
        if (!name || operands === undefined || number & 0x8000) throw new Error('The function is not read.')
        const taken = stack.splice(stack.length - operands, operands)
        if (taken.length !== operands) throw new Error('A function has too few operands.')
        stack.push({ kind: 'call', name, operands: taken })
      } else if (base === 0x24 || base === 0x2c) {
        stack.push({ kind: 'cell', cell: cell(view.getUint16(at, true), view.getUint16(at + 2, true), base === 0x2c) })
        at += 4
      } else if (base === 0x25 || base === 0x2d) {
        const [first, last, from, to] = [0, 2, 4, 6].map((offset) => view.getUint16(at + offset, true)) as [number, number, number, number]
        stack.push({ kind: 'range', from: cell(first, from, base === 0x2d), to: cell(last, to, base === 0x2d) })
        at += 8
      } else if (base === 0x2a || base === 0x2b) {
        stack.push({ kind: 'value', value: error('#REF!') })
        at += base === 0x2a ? 4 : 8
      } else throw new Error('The token is not read.')
    }
    return stack.length === 1 ? stack[0] : undefined
  } catch {
    return undefined
  }
}

// Working a formula out.

/** What a formula is worked out from: its sheet's values, the cell it is worked out for and the one it was written for. */
export interface FormulaContext {
  /** A cell's value, nothing past what was read. */
  value(row: number, column: number): FormulaValue
  /** How many rows and columns were read, which a whole column is held to. */
  rows: number
  columns: number
  at: Place
  anchor: Place
  /** Now, as the workbook counts days and their parts. */
  now: number
  /** Whether the workbook counts its days from 1904. */
  date1904: boolean
}

/** A block of cells' values, row by row, and where it starts, as a formula's operand. */
interface Block {
  values: FormulaValue[]
  from: Place
  rows: number
  columns: number
}

type Worked = FormulaValue | Block
const isBlock = (value: Worked): value is Block => typeof value === 'object' && value !== null && 'values' in value

/** Where a cell named is for the cell worked out for: one not fixed moves with it. */
function placeOf(cell: FormulaCell, context: FormulaContext): Place {
  return {
    row: cell.rowFixed ? cell.row : cell.row + context.at.row - context.anchor.row,
    column: cell.columnFixed ? cell.column : cell.column + context.at.column - context.anchor.column
  }
}

/** A cell's value; one before the sheet's first row or column is empty, as Excel's references wrap round its far end. */
const valueAt = (place: Place, context: FormulaContext): FormulaValue =>
  place.row < 0 || place.column < 0 || place.row >= context.rows || place.column >= context.columns ? null : context.value(place.row, place.column)

/** A formula's value for the cell of its context. */
export function evaluateFormula(formula: Formula, context: FormulaContext): FormulaValue {
  return single(work(formula, context), context)
}

/** Whether a condition's formula holds: true, or a number other than 0. */
export function formulaHolds(formula: Formula, context: FormulaContext): boolean {
  const value = evaluateFormula(formula, context)
  return value === true || (typeof value === 'number' && value !== 0)
}

/** One value for a block: the cell of the block in the row or column worked out for, as Excel takes it. */
function single(value: Worked, context: FormulaContext): FormulaValue {
  if (!isBlock(value)) return value
  if (value.values.length === 1) return value.values[0] ?? null
  if (value.columns === 1 && context.at.row >= value.from.row && context.at.row < value.from.row + value.rows)
    return value.values[context.at.row - value.from.row] ?? null
  if (value.rows === 1 && context.at.column >= value.from.column && context.at.column < value.from.column + value.columns)
    return value.values[context.at.column - value.from.column] ?? null
  return error('#VALUE!')
}

function work(formula: Formula, context: FormulaContext): Worked {
  switch (formula.kind) {
    case 'value':
      return formula.value
    case 'cell':
      return valueAt(placeOf(formula.cell, context), context)
    case 'range': {
      const one = placeOf(formula.from, context)
      const other = placeOf(formula.to, context)
      const from = { row: Math.max(0, Math.min(one.row, other.row)), column: Math.max(0, Math.min(one.column, other.column)) }
      const rows = Math.max(0, Math.min(Math.max(one.row, other.row), context.rows - 1) - from.row + 1)
      const columns = Math.max(0, Math.min(Math.max(one.column, other.column), context.columns - 1) - from.column + 1)
      if (rows * columns > CELL_LIMIT) return error('#VALUE!')
      const values: FormulaValue[] = []
      for (let row = 0; row < rows; row++)
        for (let column = 0; column < columns; column++) values.push(valueAt({ row: from.row + row, column: from.column + column }, context))
      return { values, from, rows, columns }
    }
    case 'unary': {
      const value = number(single(work(formula.operand, context), context))
      if (isError(value)) return value
      return formula.operator === '-' ? -value : formula.operator === '%' ? value / 100 : value
    }
    case 'binary': {
      const left = single(work(formula.left, context), context)
      const right = single(work(formula.right, context), context)
      return operate(formula.operator, left, right)
    }
    case 'call': {
      const known = FUNCTIONS[formula.name]
      return known ? known(formula.operands, context) : error('#NAME?')
    }
  }
}

/** A value as a number: a truth as 1 or 0, nothing as 0, text only when it is a number. */
function number(value: FormulaValue): number | FormulaError {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === null) return 0
  if (isError(value)) return value
  return /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(value) ? Number(value) : error('#VALUE!')
}

/** A value as text: a number with up to 15 significant digits, as Excel writes one. */
function text(value: FormulaValue): string | FormulaError {
  if (isError(value)) return value
  if (typeof value === 'number') return String(Number(value.toPrecision(15)))
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return value ?? ''
}

/** A value as a truth: a number other than 0, or the words TRUE and FALSE. */
function truth(value: FormulaValue): boolean | FormulaError {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (value === null) return false
  if (isError(value)) return value
  const upper = value.toUpperCase()
  return upper === 'TRUE' ? true : upper === 'FALSE' ? false : error('#VALUE!')
}

/** How two values compare, as Excel orders them: numbers before text before truths, text whatever its case; nothing as the other's kind's empty. */
export function compareValues(left: FormulaValue, right: FormulaValue): number | FormulaError {
  if (isError(left)) return left
  if (isError(right)) return right
  const empty = (other: FormulaValue) => (typeof other === 'string' ? '' : typeof other === 'boolean' ? false : 0)
  const one = left ?? empty(right)
  const two = right ?? empty(left)
  const rank = (value: number | string | boolean) => (typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2)
  if (rank(one) !== rank(two)) return rank(one) - rank(two)
  if (typeof one === 'string' && typeof two === 'string') {
    const [a, b] = [one.toUpperCase(), two.toUpperCase()]
    return a < b ? -1 : a > b ? 1 : 0
  }
  return Math.sign(Number(one) - Number(two))
}

function operate(operator: Operator, left: FormulaValue, right: FormulaValue): FormulaValue {
  if (COMPARISONS.includes(operator)) {
    const order = compareValues(left, right)
    if (isError(order)) return order
    return operator === '='
      ? order === 0
      : operator === '<>'
        ? order !== 0
        : operator === '<'
          ? order < 0
          : operator === '>'
            ? order > 0
            : operator === '<='
              ? order <= 0
              : order >= 0
  }
  if (operator === '&') {
    const [one, two] = [text(left), text(right)]
    if (isError(one)) return one
    return isError(two) ? two : one + two
  }
  const [one, two] = [number(left), number(right)]
  if (isError(one)) return one
  if (isError(two)) return two
  if (operator === '/' && two === 0) return error('#DIV/0!')
  const result = operator === '+' ? one + two : operator === '-' ? one - two : operator === '*' ? one * two : operator === '/' ? one / two : one ** two
  return Number.isFinite(result) ? result : error('#NUM!')
}

// The functions conditions use.

type SheetFunction = (operands: Formula[], context: FormulaContext) => FormulaValue

/** Every value of a function's operands, the cells of a block each. */
function every(operands: Formula[], context: FormulaContext): { value: FormulaValue; inBlock: boolean }[] {
  return operands.flatMap((operand): { value: FormulaValue; inBlock: boolean }[] => {
    const value = work(operand, context)
    return isBlock(value) ? value.values.map((one) => ({ value: one, inBlock: true })) : [{ value, inBlock: false }]
  })
}

/** The numbers of a function's operands: in a block, its numbers only; given alone, any value read as one. */
function numbers(operands: Formula[], context: FormulaContext): number[] | FormulaError {
  const found: number[] = []
  for (const { value, inBlock } of every(operands, context)) {
    if (isError(value)) return value
    if (inBlock) {
      if (typeof value === 'number') found.push(value)
      continue
    }
    const read = number(value)
    if (isError(read)) return read
    found.push(read)
  }
  return found
}

/** A function of numbers worked out from its operands' values. */
const numeric =
  (count: number, worked: (...values: number[]) => FormulaValue): SheetFunction =>
  (operands, context) => {
    const values: number[] = []
    for (let index = 0; index < count; index++) {
      const value = number(evaluateOperand(operands, index, context))
      if (isError(value)) return value
      values.push(value)
    }
    return worked(...values)
  }

/** A function of one text worked out from its first operand's. */
const textual =
  (worked: (value: string, operands: Formula[], context: FormulaContext) => FormulaValue): SheetFunction =>
  (operands, context) => {
    const value = text(evaluateOperand(operands, 0, context))
    return isError(value) ? value : worked(value, operands, context)
  }

const evaluateOperand = (operands: Formula[], index: number, context: FormulaContext): FormulaValue => {
  const operand = operands[index]
  return operand ? evaluateFormula(operand, context) : null
}

/** A function that says whether a value is of a kind. */
const kindOf =
  (test: (value: FormulaValue) => boolean): SheetFunction =>
  (operands, context) =>
    test(evaluateOperand(operands, 0, context))

/** Truths combined: in a block, its truths only; text alone that is not a truth is an error. */
const logical =
  (combine: (values: boolean[]) => boolean): SheetFunction =>
  (operands, context) => {
    const found: boolean[] = []
    for (const { value, inBlock } of every(operands, context)) {
      if (isError(value)) return value
      if (inBlock && (typeof value === 'string' || value === null)) continue
      const read = truth(value)
      if (isError(read)) return read
      found.push(read)
    }
    return found.length === 0 ? error('#VALUE!') : combine(found)
  }

/** A day's serial number, as the workbook counts days: from 1904, or from 1900 with its 29 February that never was. */
export function serialOf(year: number, month: number, day: number, date1904: boolean): number {
  const days = Date.UTC(year, month - 1, day) / 86_400_000
  if (date1904) return days - Date.UTC(1904, 0, 1) / 86_400_000
  const serial = days - Date.UTC(1899, 11, 30) / 86_400_000
  return serial < 61 ? serial - 1 : serial
}

/** A serial number's day: its year, month, day of the month and day of the week (0 for Sunday). */
export function dayOf(serial: number, date1904: boolean): { year: number; month: number; day: number; weekday: number } {
  const whole = Math.floor(serial)
  if (!date1904 && whole === 60) return { year: 1900, month: 2, day: 29, weekday: 3 }
  const from = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, whole < 60 ? 31 : 30)
  const date = new Date(from + whole * 86_400_000)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() }
}

/** Whether a value matches a criterion of COUNTIF: equal to a value, or compared by the operator it starts with, `*` and `?` as wildcards. */
function matches(value: FormulaValue, criterion: FormulaValue): boolean {
  if (typeof criterion !== 'string') return compareValues(value, criterion) === 0 && value !== null
  const found = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(criterion)
  const operator = (found?.[1] ?? '=') as Comparison
  const wanted = found?.[2] ?? ''
  const asNumber = number(wanted)
  if (wanted !== '' && !isError(asNumber)) {
    if (typeof value !== 'number') return operator === '<>'
    return operate(operator, value, asNumber) === true
  }
  if (operator === '=' || operator === '<>') {
    if (wanted === '') return (value === null || value === '') === (operator === '=')
    // A wildcard stands for any characters or for one; `~` before one stands for it itself.
    const source = wanted.replace(/~([*?~])|([*?])|([.+^$(){}|[\]\\])/g, (_, escaped: string | undefined, wild: string | undefined, special: string) =>
      escaped ? `\\${escaped}` : wild ? (wild === '*' ? '[\\s\\S]*' : '[\\s\\S]') : `\\${special}`
    )
    const pattern = new RegExp(`^${source}$`, 'i')
    const shown = text(value)
    const equal = typeof value === 'string' && !isError(shown) && pattern.test(shown)
    return operator === '=' ? equal : !equal
  }
  return typeof value === 'string' && operate(operator, value, wanted) === true
}

const FUNCTIONS: Record<string, SheetFunction> = {
  AND: logical((values) => values.every(Boolean)),
  OR: logical((values) => values.some(Boolean)),
  XOR: logical((values) => values.filter(Boolean).length % 2 === 1),
  NOT: (operands, context) => {
    const value = truth(evaluateOperand(operands, 0, context))
    return isError(value) ? value : !value
  },
  TRUE: () => true,
  FALSE: () => false,
  IF: (operands, context) => {
    const test = truth(evaluateOperand(operands, 0, context))
    if (isError(test)) return test
    return test ? evaluateOperand(operands, 1, context) : operands.length > 2 ? evaluateOperand(operands, 2, context) : false
  },
  IFERROR: (operands, context) => {
    const value = evaluateOperand(operands, 0, context)
    return isError(value) ? evaluateOperand(operands, 1, context) : value
  },
  IFNA: (operands, context) => {
    const value = evaluateOperand(operands, 0, context)
    return isError(value) && value.error === '#N/A' ? evaluateOperand(operands, 1, context) : value
  },
  NA: () => error('#N/A'),
  ISBLANK: kindOf((value) => value === null),
  ISNUMBER: kindOf((value) => typeof value === 'number'),
  ISTEXT: kindOf((value) => typeof value === 'string'),
  ISNONTEXT: kindOf((value) => typeof value !== 'string'),
  ISLOGICAL: kindOf((value) => typeof value === 'boolean'),
  ISERROR: kindOf(isError),
  ISERR: kindOf((value) => isError(value) && value.error !== '#N/A'),
  ISNA: kindOf((value) => isError(value) && value.error === '#N/A'),
  ISEVEN: numeric(1, (value) => Math.trunc(value) % 2 === 0),
  ISODD: numeric(1, (value) => Math.abs(Math.trunc(value) % 2) === 1),
  ROW: (operands, context) => {
    const operand = operands[0]
    if (!operand) return context.at.row + 1
    return operand.kind === 'cell'
      ? placeOf(operand.cell, context).row + 1
      : operand.kind === 'range'
        ? placeOf(operand.from, context).row + 1
        : error('#VALUE!')
  },
  COLUMN: (operands, context) => {
    const operand = operands[0]
    if (!operand) return context.at.column + 1
    return operand.kind === 'cell'
      ? placeOf(operand.cell, context).column + 1
      : operand.kind === 'range'
        ? placeOf(operand.from, context).column + 1
        : error('#VALUE!')
  },
  MOD: numeric(2, (value, by) => (by === 0 ? error('#DIV/0!') : value - by * Math.floor(value / by))),
  ABS: numeric(1, Math.abs),
  INT: numeric(1, Math.floor),
  SIGN: numeric(1, Math.sign),
  ROUND: numeric(2, (value, digits) => {
    const scale = 10 ** Math.trunc(digits)
    return (Math.sign(value) * Math.round(Math.abs(value) * scale + 1e-9)) / scale
  }),
  SUM: (operands, context) => {
    const values = numbers(operands, context)
    return isError(values) ? values : values.reduce((sum, value) => sum + value, 0)
  },
  AVERAGE: (operands, context) => {
    const values = numbers(operands, context)
    if (isError(values)) return values
    return values.length === 0 ? error('#DIV/0!') : values.reduce((sum, value) => sum + value, 0) / values.length
  },
  MIN: (operands, context) => {
    const values = numbers(operands, context)
    return isError(values) ? values : values.length === 0 ? 0 : Math.min(...values)
  },
  MAX: (operands, context) => {
    const values = numbers(operands, context)
    return isError(values) ? values : values.length === 0 ? 0 : Math.max(...values)
  },
  COUNT: (operands, context) =>
    every(operands, context).filter(({ value, inBlock }) => typeof value === 'number' || (!inBlock && !isError(number(value)))).length,
  COUNTA: (operands, context) => every(operands, context).filter(({ value }) => value !== null).length,
  COUNTBLANK: (operands, context) => every(operands, context).filter(({ value }) => value === null || value === '').length,
  COUNTIF: (operands, context) => {
    const criterion = evaluateOperand(operands, 1, context)
    if (isError(criterion)) return criterion
    return every(operands.slice(0, 1), context).filter(({ value }) => matches(value, criterion)).length
  },
  LEN: textual((value) => value.length),
  LEFT: textual((value, operands, context) => {
    const count = operands.length > 1 ? number(evaluateOperand(operands, 1, context)) : 1
    return isError(count) ? count : count < 0 ? error('#VALUE!') : value.slice(0, Math.trunc(count))
  }),
  RIGHT: textual((value, operands, context) => {
    const count = operands.length > 1 ? number(evaluateOperand(operands, 1, context)) : 1
    return isError(count) ? count : count < 0 ? error('#VALUE!') : Math.trunc(count) === 0 ? '' : value.slice(-Math.trunc(count))
  }),
  MID: textual((value, operands, context) => {
    const start = number(evaluateOperand(operands, 1, context))
    const count = number(evaluateOperand(operands, 2, context))
    if (isError(start)) return start
    if (isError(count)) return count
    return start < 1 || count < 0 ? error('#VALUE!') : value.slice(Math.trunc(start) - 1, Math.trunc(start) - 1 + Math.trunc(count))
  }),
  UPPER: textual((value) => value.toUpperCase()),
  LOWER: textual((value) => value.toLowerCase()),
  TRIM: textual((value) => value.trim().replace(/ {2,}/g, ' ')),
  VALUE: (operands, context) => number(evaluateOperand(operands, 0, context)),
  EXACT: (operands, context) => {
    const [one, two] = [text(evaluateOperand(operands, 0, context)), text(evaluateOperand(operands, 1, context))]
    if (isError(one)) return one
    return isError(two) ? two : one === two
  },
  CONCATENATE: (operands, context) => {
    let joined = ''
    for (let index = 0; index < operands.length; index++) {
      const part = text(evaluateOperand(operands, index, context))
      if (isError(part)) return part
      joined += part
    }
    return joined
  },
  SEARCH: (operands, context) => found(operands, context, false),
  FIND: (operands, context) => found(operands, context, true),
  TODAY: (_, context) => Math.floor(context.now),
  NOW: (_, context) => context.now,
  DATE: (operands, context) => numeric(3, (year, month, day) => serialOf(year < 1900 ? year + 1900 : year, month, day, context.date1904))(operands, context),
  YEAR: (operands, context) => numeric(1, (value) => dayOf(value, context.date1904).year)(operands, context),
  MONTH: (operands, context) => numeric(1, (value) => dayOf(value, context.date1904).month)(operands, context),
  DAY: (operands, context) => numeric(1, (value) => dayOf(value, context.date1904).day)(operands, context),
  WEEKDAY: (operands, context) => {
    const serial = number(evaluateOperand(operands, 0, context))
    const kind = operands.length > 1 ? number(evaluateOperand(operands, 1, context)) : 1
    if (isError(serial)) return serial
    if (isError(kind)) return kind
    const weekday = dayOf(serial, context.date1904).weekday
    return kind === 2 ? ((weekday + 6) % 7) + 1 : kind === 3 ? (weekday + 6) % 7 : weekday + 1
  }
}
FUNCTIONS.CONCAT = FUNCTIONS.CONCATENATE as SheetFunction

/** Where a text is first found in another, from 1, in its case or whatever its case; an error when it is not. */
function found(operands: Formula[], context: FormulaContext, inCase: boolean): FormulaValue {
  const wanted = text(evaluateOperand(operands, 0, context))
  const within = text(evaluateOperand(operands, 1, context))
  const start = operands.length > 2 ? number(evaluateOperand(operands, 2, context)) : 1
  if (isError(wanted)) return wanted
  if (isError(within)) return within
  if (isError(start)) return start
  const place = inCase ? within.indexOf(wanted, Math.trunc(start) - 1) : within.toUpperCase().indexOf(wanted.toUpperCase(), Math.trunc(start) - 1)
  return start < 1 || place < 0 ? error('#VALUE!') : place + 1
}
