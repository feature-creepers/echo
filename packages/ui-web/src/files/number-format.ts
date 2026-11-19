/**
 * A number as a spreadsheet's format shows it (docs/SPEC.md, section 9.7): the format codes of Excel, which Word,
 * PowerPoint and the older binary formats share. Dates and times from their serial number, percentages, thousands,
 * decimals, scientific notation, fractions, and the literal text, currency signs and sections around them. Colours,
 * conditions and the padding a column's width gives are left out: a preview shows the text, not the cell.
 */

/** The serial number of the last day Excel counts, 31 December 9999. */
const LAST_DAY = 2_958_465

/** The formats Excel numbers itself and writes by their number only. */
const BUILT_IN: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  5: '"$"#,##0_);("$"#,##0)',
  6: '"$"#,##0_);[Red]("$"#,##0)',
  7: '"$"#,##0.00_);("$"#,##0.00)',
  8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'short date',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'short date h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
  48: '##0.0E+0',
  49: '@'
}

/** The format Excel means by a number it writes alone; a date for those of East Asian calendars it numbers too. */
export function builtInFormat(id: number): string {
  return BUILT_IN[id] ?? ((id >= 27 && id <= 36) || (id >= 50 && id <= 58) ? 'short date' : 'General')
}

export interface NumberFormatOptions {
  /** Whether the workbook counts its dates from 1904, as older Macs did. */
  date1904?: boolean | undefined
  /** The language of the names of months and days, and of a short date: the window's when left out. */
  locale?: string | undefined
}

/** A number as `General` shows it: as stored, ten significant digits at most, very large and very small ones as powers of ten. */
export function generalNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const size = Math.abs(value)
  if (size !== 0 && (size >= 1e11 || size < 1e-9)) {
    const [mantissa = '', exponent = '0'] = value.toExponential(5).split('e')
    const trimmed = mantissa.includes('.') ? mantissa.replace(/\.?0+$/, '') : mantissa
    const power = Number(exponent)
    return `${trimmed}E${power < 0 ? '-' : '+'}${String(Math.abs(power)).padStart(2, '0')}`
  }
  return String(Number(value.toPrecision(10)))
}

/** A piece of a format's section. */
type Token =
  | { kind: 'literal'; text: string }
  | { kind: 'digit'; char: '0' | '#' | '?' }
  | { kind: 'point' }
  | { kind: 'comma' }
  | { kind: 'percent' }
  | { kind: 'exponent'; sign: '+' | '-' }
  | { kind: 'slash' }
  | { kind: 'text' }
  | { kind: 'date'; code: string }
  | { kind: 'elapsed'; unit: 'h' | 'm' | 's'; width: number }

/** A format's sections, at its semicolons outside quotes and brackets. */
function sections(code: string): string[] {
  const found: string[] = []
  let current = ''
  let quoted = false
  let bracket = false
  for (let at = 0; at < code.length; at++) {
    const char = code[at] as string
    if (char === '\\' && !quoted) {
      current += char + (code[at + 1] ?? '')
      at++
      continue
    }
    if (char === '"') quoted = !quoted
    else if (char === '[' && !quoted) bracket = true
    else if (char === ']' && !quoted) bracket = false
    else if (char === ';' && !quoted && !bracket) {
      found.push(current)
      current = ''
      continue
    }
    current += char
  }
  found.push(current)
  return found
}

/** A section's pieces, read in order. */
function tokens(section: string): Token[] {
  const read: Token[] = []
  const literal = (text: string) => {
    const last = read.at(-1)
    if (last?.kind === 'literal') last.text += text
    else read.push({ kind: 'literal', text })
  }
  for (let at = 0; at < section.length; at++) {
    const char = section[at] as string
    const rest = section.slice(at)
    if (char === '"') {
      const end = section.indexOf('"', at + 1)
      literal(section.slice(at + 1, end < 0 ? section.length : end))
      at = end < 0 ? section.length : end
    } else if (char === '\\') literal(section[++at] ?? '')
    else if (char === '_') {
      // Room the width of the next character: a space here.
      at++
      literal(' ')
    } else if (char === '*') at++
    else if (char === '[') {
      const end = section.indexOf(']', at)
      const inside = section.slice(at + 1, end < 0 ? section.length : end)
      at = end < 0 ? section.length : end
      const elapsed = /^(h+|m+|s+)$/i.exec(inside)
      if (elapsed) read.push({ kind: 'elapsed', unit: (elapsed[1] as string)[0]?.toLowerCase() as 'h' | 'm' | 's', width: inside.length })
      // A currency and its language, `[$€-407]`: its sign shows.
      else if (inside.startsWith('$')) literal(inside.slice(1).split('-')[0] ?? '')
    } else if (/^(AM\/PM|A\/P)/i.test(rest)) {
      const code = /^(AM\/PM|A\/P)/i.exec(rest)?.[0] as string
      read.push({ kind: 'date', code })
      at += code.length - 1
    } else if (/[ymdhs]/i.test(char)) {
      let end = at
      while (end < section.length && section[end]?.toLowerCase() === char.toLowerCase()) end++
      read.push({ kind: 'date', code: section.slice(at, end).toLowerCase() })
      at = end - 1
    } else if (char === '0' || char === '#' || char === '?') read.push({ kind: 'digit', char })
    else if (char === '.') {
      // After seconds, a point starts their fraction: `ss.00`.
      const previous = read.at(-1)
      if (previous && (previous.kind === 'date' || previous.kind === 'elapsed') && /^\.0+/.test(rest)) {
        const fraction = /^\.0+/.exec(rest)?.[0] as string
        read.push({ kind: 'date', code: fraction })
        at += fraction.length - 1
      } else read.push({ kind: 'point' })
    } else if (char === ',') read.push({ kind: 'comma' })
    else if (char === '%') read.push({ kind: 'percent' })
    else if ((char === 'E' || char === 'e') && /^[eE][+-]/.test(rest)) {
      read.push({ kind: 'exponent', sign: rest[1] as '+' | '-' })
      at++
    } else if (char === '/') read.push({ kind: 'slash' })
    else if (char === '@') read.push({ kind: 'text' })
    else literal(char)
  }
  return read
}

const isDate = (read: readonly Token[]) => read.some((token) => token.kind === 'elapsed' || token.kind === 'date')

/** The moment a serial number stands for, in UTC, counting days from 1900 (with its leap day that never was) or from 1904. */
function moment(serial: number, date1904: boolean): Date {
  const days = date1904 ? serial + 1462 : serial < 60 ? serial + 1 : serial
  // Kept to the millisecond, so a time stored as a fraction of a day does not fall a second short.
  return new Date(Math.round(Date.UTC(1899, 11, 30) + days * 86_400_000))
}

/** A date or time as its tokens show it. */
function formatDate(serial: number, read: readonly Token[], options: NumberFormatOptions): string {
  if (serial < 0 || serial > LAST_DAY) return generalNumber(serial)
  // Shown to the precision of its fraction of a second, rounded once.
  const fraction = read.find((token) => token.kind === 'date' && token.code.startsWith('.'))
  const places = fraction?.kind === 'date' ? fraction.code.length - 1 : 0
  const scale = 10 ** places
  const date = moment(Math.round(serial * 86_400 * scale) / (86_400 * scale), options.date1904 ?? false)
  const twelve = read.some((token) => token.kind === 'date' && (token.code.toUpperCase() === 'AM/PM' || token.code.toUpperCase() === 'A/P'))
  const names = (style: 'long' | 'short', of: 'month' | 'weekday') => new Intl.DateTimeFormat(options.locale, { [of]: style, timeZone: 'UTC' }).format(date)
  const hours = date.getUTCHours()
  const shownHours = twelve ? hours % 12 || 12 : hours
  const pad = (value: number, width: number) => String(value).padStart(width, '0')
  let written = ''
  read.forEach((token, index) => {
    if (token.kind === 'literal') written += token.text
    // Marks a number's format would read show as themselves among a date's: `dd/mm/yyyy`.
    else if (token.kind === 'slash') written += '/'
    else if (token.kind === 'point') written += '.'
    else if (token.kind === 'comma') written += ','
    else if (token.kind === 'percent') written += '%'
    else if (token.kind === 'digit') written += token.char
    else if (token.kind === 'elapsed') {
      const total = serial * (token.unit === 'h' ? 24 : token.unit === 'm' ? 1440 : 86_400)
      written += pad(Math.floor(total + 1e-9), token.width)
    } else if (token.kind === 'date') {
      const code = token.code
      // An `m` is minutes after hours or before seconds, else a month.
      const before = read.slice(0, index).findLast((one) => one.kind === 'date' || one.kind === 'elapsed')
      const after = read.slice(index + 1).find((one) => one.kind === 'date' || one.kind === 'elapsed')
      const minutes =
        code.startsWith('m') &&
        code.length <= 2 &&
        ((before?.kind === 'date' && before.code.startsWith('h')) ||
          (before?.kind === 'elapsed' && before.unit === 'h') ||
          (after?.kind === 'date' && after.code.startsWith('s')) ||
          (after?.kind === 'elapsed' && after.unit === 's'))
      if (code.startsWith('.')) written += (date.getUTCMilliseconds() / 1000).toFixed(places).slice(1)
      else if (code.toUpperCase() === 'AM/PM') written += hours < 12 ? 'AM' : 'PM'
      else if (code.toUpperCase() === 'A/P') written += hours < 12 ? 'A' : 'P'
      else if (code.startsWith('y')) written += code.length <= 2 ? pad(date.getUTCFullYear() % 100, 2) : String(date.getUTCFullYear())
      else if (minutes) written += pad(date.getUTCMinutes(), code.length)
      else if (code.startsWith('m'))
        written +=
          code.length === 1
            ? String(date.getUTCMonth() + 1)
            : code.length === 2
              ? pad(date.getUTCMonth() + 1, 2)
              : code.length === 3
                ? names('short', 'month').replace(/\.$/, '')
                : code.length === 5
                  ? names('long', 'month').slice(0, 1)
                  : names('long', 'month')
      else if (code.startsWith('d'))
        written +=
          code.length <= 2 ? pad(date.getUTCDate(), code.length) : code.length === 3 ? names('short', 'weekday').replace(/\.$/, '') : names('long', 'weekday')
      else if (code.startsWith('h')) written += pad(shownHours, Math.min(code.length, 2))
      else if (code.startsWith('s')) written += pad(date.getUTCSeconds(), Math.min(code.length, 2))
      else written += code
    }
  })
  return written
}

/** Digits with their thousands grouped. */
const grouped = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** The nearest fraction to a value whose denominator is at most `largest`, the smallest denominator of those as near, as Excel finds it. */
function fraction(value: number, largest: number): [number, number] {
  let best: [number, number] = [Math.round(value), 1]
  let nearest = Math.abs(value - best[0])
  for (let denominator = 2; denominator <= largest && nearest > 1e-12; denominator++) {
    const numerator = Math.round(value * denominator)
    const distance = Math.abs(value - numerator / denominator)
    if (distance < nearest - 1e-15) {
      best = [numerator, denominator]
      nearest = distance
    }
  }
  return best
}

/** A number as the tokens of a section of numbers show it; its sign is the caller's. */
function formatPlain(value: number, read: readonly Token[]): string {
  let shown = value
  for (const token of read) if (token.kind === 'percent') shown *= 100
  const digitsAt = read.flatMap((token, index) => (token.kind === 'digit' ? [index] : []))
  // A section of text alone, `@`, shows the number as `General` would.
  if (digitsAt.length === 0)
    return read
      .map((token) => (token.kind === 'literal' ? token.text : token.kind === 'percent' ? '%' : token.kind === 'text' ? generalNumber(value) : ''))
      .join('')
  // A comma after the last digit before the point divides by a thousand; one between digits groups them.
  const point = read.findIndex((token) => token.kind === 'point')
  const exponentAt = read.findIndex((token) => token.kind === 'exponent')
  const integerEnd = point >= 0 ? point : exponentAt >= 0 ? exponentAt : read.length
  const lastIntegerDigit = digitsAt.filter((at) => at < integerEnd).at(-1) ?? -1
  let group = false
  read.forEach((token, index) => {
    if (token.kind !== 'comma') return
    if (index > lastIntegerDigit) shown /= 1000
    else group = true
  })

  const slash = read.findIndex((token) => token.kind === 'slash')
  if (slash >= 0) return formatFraction(shown, read, slash)

  const decimals = digitsAt.filter((at) => at > point && point >= 0 && (exponentAt < 0 || at < exponentAt)).map((at) => read[at] as { char: string })
  let exponent = 0
  if (exponentAt >= 0 && shown !== 0) {
    const integerDigits = digitsAt.filter((at) => at < integerEnd).length
    exponent = Math.floor(Math.log10(shown))
    // Engineering notation, `##0.0E+0`, keeps the power a multiple of the integer's digits.
    if (integerDigits > 1 && read[digitsAt[0] as number]?.kind === 'digit' && (read[digitsAt[0] as number] as { char: string }).char === '#')
      exponent = Math.floor(exponent / integerDigits) * integerDigits
    shown /= 10 ** exponent
  }
  const fixed = shown.toFixed(decimals.length)
  let [integer = '0', decimal = ''] = fixed.split('.')
  const integerPlaces = digitsAt.filter((at) => at < integerEnd).map((at) => (read[at] as { char: string }).char)
  if (integer === '0' && !integerPlaces.includes('0')) integer = ''
  // Trailing zeros show only where a `0` asks for them; a `?` keeps their room.
  let decimalShown = ''
  for (let place = decimals.length - 1, trailing = true; place >= 0; place--) {
    const digit = decimal[place] ?? '0'
    const char = decimals[place]?.char
    if (trailing && digit === '0' && char !== '0') decimalShown = (char === '?' ? ' ' : '') + decimalShown
    else {
      trailing = false
      decimalShown = digit + decimalShown
    }
  }
  integer = integer.padStart(integerPlaces.filter((char) => char === '0').length, '0')
  if (group) integer = grouped(integer)
  // The integer's digits go into its places from the right, as `000-00-0000` spreads them; what is left, into the first.
  const integerSlots = digitsAt.filter((at) => at < integerEnd)
  const spread = !group && read.slice(integerSlots[0] ?? 0, integerEnd).some((token) => token.kind === 'literal')
  const fills = new Map<number, string>()
  let left = integer
  for (let slot = integerSlots.length - 1; slot >= 0; slot--) {
    const at = integerSlots[slot] as number
    if (slot === 0 || !spread) {
      fills.set(at, slot === 0 ? left : '')
      continue
    }
    fills.set(at, left.slice(-1))
    left = left.slice(0, -1)
  }

  let written = ''
  let decimalAt = 0
  read.forEach((token, index) => {
    if (token.kind === 'literal') written += token.text
    else if (token.kind === 'percent') written += '%'
    else if (token.kind === 'point') written += decimalShown === '' && decimals.every((one) => one.char !== '0') ? '' : '.'
    else if (token.kind === 'exponent') {
      const power = Math.abs(exponent)
      const places = read.slice(index + 1).filter((one) => one.kind === 'digit').length
      written += `E${exponent < 0 ? '-' : token.sign === '+' ? '+' : ''}${String(power).padStart(places, '0')}`
    } else if (token.kind === 'digit') {
      if (index < integerEnd) written += fills.get(index) ?? ''
      else if (exponentAt < 0 || index < exponentAt) written += decimalShown[decimalAt++] ?? ''
    }
  })
  return written
}

/** A number as a fraction's section shows it: `# ?/?`, `?/8`. */
function formatFraction(value: number, read: readonly Token[], slash: number): string {
  const denominatorDigits = read.slice(slash + 1).filter((token) => token.kind === 'digit').length
  const fixed = read
    .slice(slash + 1)
    .filter((token) => token.kind === 'literal')
    .map((token) => (token as { text: string }).text)
    .join('')
    .trim()
  // A whole part shows when digits stand apart from the numerator's, before a space.
  const firstLiteral = read.findIndex((token, index) => token.kind === 'literal' && index < slash && /\s/.test(token.text))
  const whole = firstLiteral >= 0 && read.slice(0, firstLiteral).some((token) => token.kind === 'digit') ? Math.trunc(value) : 0
  const rest = value - whole
  const [numerator, denominator] = /^\d+$/.test(fixed)
    ? [Math.round(rest * Number(fixed)), Number(fixed)]
    : fraction(rest, 10 ** Math.max(1, denominatorDigits) - 1)
  if (numerator === 0) return String(whole)
  if (numerator === denominator) return String(whole + 1)
  return `${whole > 0 ? `${whole} ` : ''}${numerator}/${denominator}`
}

/** A number as a format shows it, by its code: `0.00%`, `dd/mm/yyyy`, `#,##0 "€"`. */
export function formatNumber(value: number, code: string, options: NumberFormatOptions = {}): string {
  if (!Number.isFinite(value)) return String(value)
  if (code === 'short date' || code === 'short date h:mm') {
    // Past the last day Excel counts, 31 December 9999, a number is no date.
    if (value < 0 || value > LAST_DAY) return generalNumber(value)
    const date = moment(value, options.date1904 ?? false)
    const time = code.endsWith('h:mm')
    return new Intl.DateTimeFormat(options.locale, { dateStyle: 'short', ...(time ? { timeStyle: 'short' } : {}), timeZone: 'UTC' }).format(date)
  }
  // Positive, negative, zero: a section of its own each when there is one, else the first with a sign.
  const found = sections(code)
  const [positive = '', negative, zero] = found
  const section = value < 0 && negative !== undefined ? negative : value === 0 && zero !== undefined ? zero : positive
  // A section left empty hides its numbers, as `0;-0;;@` hides zeros.
  if (section.trim() === '' && found.length > 1) return ''
  if (/^\s*(general)?\s*$/i.test(section)) return value < 0 && negative !== undefined ? generalNumber(-value) : generalNumber(value)
  const read = tokens(section)
  if (isDate(read)) return formatDate(value, read, options)
  const signed = value < 0 && negative === undefined
  const written = formatPlain(Math.abs(value), read)
  return signed && /[1-9]/.test(written) ? `-${written}` : written
}
