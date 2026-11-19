import { describe, expect, it } from 'vitest'
import type { Compound } from './compound.ts'
import { equationNativeText, isEquationProgram, mtefText, objectEquation } from './equation-editor.ts'

/** A character's code in two bytes, low first. */
const code = (character: string) => {
  const value = character.charCodeAt(0)
  return [value & 0xff, value >> 8]
}

/**
 * MTEF 5, as MathType 4 and later write it: a header naming the app, then records, each a type and an options byte.
 * The typefaces are MTEF's: 2 a function's name, 3 a variable, 6 a symbol, 8 a number.
 */
const five = {
  equation: (...items: number[][]) =>
    new Uint8Array([5, 1, 0, 6, 9, ...[...'DSMT6'].flatMap(code).filter((_, index) => index % 2 === 0), 0, 0, 10, ...five.line(...items), 0]),
  line: (...items: number[][]) => [1, 0, ...items.flat(), 0],
  empty: [1, 1],
  text: (text: string, typeface = 3) => [...text].flatMap((character) => [2, 0, typeface + 128, ...code(character)]),
  embellished: (character: string, ...marks: number[]) => [2, 1, 131, ...code(character), ...marks.flatMap((mark) => [6, 0, mark]), 0],
  template: (selector: number, variation: number, ...parts: number[][]) => [3, 0, selector, variation, 0, ...parts.flat(), 0],
  pile: (...lines: number[][]) => [4, 0, 1, 1, ...lines.flat(), 0],
  matrix: (rows: number, columns: number, ...cells: number[][]) => [
    5,
    0,
    0,
    0,
    0,
    rows,
    columns,
    ...new Array(Math.ceil((rows + 1) / 4) + Math.ceil((columns + 1) / 4)).fill(0),
    ...cells.flat(),
    0
  ]
}

/** MTEF 3, as Equation Editor 3 writes it: a five-byte header, then records whose options are their tag's high half. */
const three = {
  equation: (...items: number[][]) => new Uint8Array([3, 1, 1, 3, 10, 10, ...three.line(...items), 0]),
  line: (...items: number[][]) => [0x01, ...items.flat(), 0],
  empty: [0x11],
  text: (text: string, typeface = 3) => [...text].flatMap((character) => [0x02, typeface + 128, ...code(character)]),
  embellished: (character: string, mark: number) => [0x22, 131, ...code(character), 0x06, mark, 0, 0],
  template: (selector: number, variation: number, ...parts: number[][]) => [0x03, selector, variation, 0, ...parts.flat(), 0]
}

describe('an equation of MathType (MTEF 5)', () => {
  const { equation, line, empty, text, template } = five
  it.each([
    ['its characters in order', equation(text('E'), text('=', 6), text('mc')), 'E=mc'],
    ['a power in superscript characters', equation(text('x'), template(28, 0, empty, line(text('2', 8)))), 'x²'],
    ['an index and a power', equation(text('a'), template(29, 0, line(text('1', 8)), line(text('n')))), 'a₁ⁿ'],
    ['a power Unicode has no characters for', equation(text('e'), template(28, 0, empty, line(text('iπ')))), 'e^(iπ)'],
    [
      'a fraction, its longer parts grouped',
      equation(template(11, 0, line(text('x'), text('+', 6), text('1', 8)), line(text('2', 8), text('y')))),
      '(x+1)/(2y)'
    ],
    ['a square root', equation(template(10, 0, line(text('2', 8)), empty)), '√2'],
    ['a cube root', equation(template(10, 1, line(text('x'), text('+', 6), text('1', 8)), line(text('3', 8)))), '∛(x+1)'],
    ['a root of another degree', equation(template(10, 1, line(text('x')), line(text('n')))), 'ⁿ√x'],
    [
      'a sum with its limits, its sign a line of its own',
      equation(template(16, 0x70, line(text('i')), line(text('i'), text('=', 6), text('1', 8)), line(text('n')), line(text('∑', 6)))),
      '∑_(i=1)^n i'
    ],
    ['a double integral, as its variation says', equation(template(15, 0x12, line(text('f')), line(text('D')), empty, line(text('∫', 6)))), '∬_D f'],
    ['a contour integral', equation(template(15, 0x15, line(text('f')), empty, empty)), '∮ f'],
    ['brackets of their own', equation(template(3, 3, line(text('a'), text(',', 2), text('b')), text('[', 2), text(']', 2))), '[a,b]'],
    ['bars MathType draws from its own characters', equation(template(4, 3, line(text('x')), text('', 2), text('', 2))), '|x|'],
    ['a bracket on one side', equation(template(2, 1, line(text('x')), text('{', 2))), '{x'],
    ['an interval of unmatched brackets', equation(template(9, 0x12, line(text('0', 8), text(',', 2), text('1', 8)), text('[', 2), text(')', 2))), '[0,1)'],
    ['a function set apart from what it applies to', equation(text('sin', 2), text('θ')), 'sin θ'],
    ['a function of a group', equation(text('log', 2), template(1, 3, line(text('x')), text('(', 2), text(')', 2))), 'log(x)'],
    [
      'a limit',
      equation(template(23, 1, line(text('lim', 2)), line(text('n'), text('→', 6), text('∞', 6)), empty), text('a'), template(27, 0, line(text('n')), empty)),
      'lim_(n→∞) aₙ'
    ],
    ['a matrix, row by row', equation(five.matrix(2, 2, line(text('1', 8)), line(text('0', 8)), line(text('0', 8)), line(text('1', 8)))), '[1 0; 0 1]'],
    ['lines piled within brackets', equation(template(2, 1, line(five.pile(line(text('x')), line(text('y')))), text('{', 2))), '{[x; y]'],
    ['accents over characters', equation(five.embellished('x', 2), text('+', 6), five.embellished('f', 5)), 'ẋ+f′'],
    ['a vector', equation(template(31, 2, line(text('v')))), 'v⃗'],
    ['an arrow with words over it', equation(text('A'), template(14, 0x24, line(text('heat', 1)), empty, text('→', 6)), text('B')), 'A→^(heat)B'],
    ['a bra-ket', equation(template(30, 3, line(text('a')), line(text('b')))), '⟨a|b⟩'],
    ['spaces MathType adds, as one space', equation(text('x'), text('', 24), text('if', 1)), 'x if'],
    ['script letters of its own, as the letters they are', equation(text('', 3)), 'M']
  ])('reads %s', (_, bytes, expected) => {
    expect(mtefText(bytes)).toBe(expected)
  })

  it('passes over what only says how it looks: fonts, sizes, colours, preferences and records of later versions', () => {
    const fonts = [
      19,
      ...[...'WinAllBasicCodePages'].map((character) => character.charCodeAt(0)),
      0,
      17,
      5,
      ...[...'Cambria'].map((c) => c.charCodeAt(0)),
      0,
      8,
      1,
      0
    ]
    // Preferences: two arrays of dimensions in nibbles, each ending at 15 and padded to a byte, then two styles.
    const preferences = [18, 0, 2, 0x21, 0x2f, 0x45, 0x8f, 1, 0x41, 0x50, 0xf0, 2, 1, 0, 0]
    const colour = [16, 0, 0, 0, 0, 0, 0, 0, 15, 1]
    const later = [100, 3, 9, 9, 9]
    const bytes = new Uint8Array([
      5,
      1,
      0,
      6,
      9,
      68,
      0,
      0,
      ...later,
      ...fonts,
      ...preferences,
      ...colour,
      9,
      101,
      0x80,
      0x01,
      9,
      1,
      130,
      11,
      ...line(text('x')),
      0
    ])
    expect(mtefText(bytes)).toBe('x')
  })

  it('is none for another version, an equation cut short, or one nested past the limit, and never fails', () => {
    expect(mtefText(new Uint8Array([4, 1, 0, 3, 5, 1, 0, 0]))).toBeUndefined()
    const whole = equation(template(11, 0, line(text('a')), line(text('b'))))
    expect(mtefText(whole)).toBe('a/b')
    for (let cut = 0; cut < whole.length - 1; cut++) expect(mtefText(whole.subarray(0, cut))).toBeUndefined()
    const deep = equation(...new Array(100).fill(0).map(() => [3, 0, 1, 3, 0, 1, 0]))
    expect(mtefText(deep)).toBeUndefined()
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % 256
    }
    for (let round = 0; round < 2000; round++) {
      const damaged = new Uint8Array(whole)
      damaged[8 + (random() % (whole.length - 8))] = random()
      expect(() => mtefText(damaged)).not.toThrow()
    }
  })
})

describe('an equation of Equation Editor 3 (MTEF 3)', () => {
  const { equation, line, empty, text, template } = three
  it.each([
    ['a fraction', equation(template(14, 0, line(text('1', 8)), line(text('2', 8)))), '1/2'],
    ['an index after its base', equation(text('x'), template(15, 1, line(text('k')), empty)), 'xₖ'],
    ['a power after its base', equation(text('x'), template(15, 0, empty, line(text('2', 8)))), 'x²'],
    [
      'a sum, its sign a character after its limits',
      equation(
        template(29, 1, line(text('a'), template(15, 1, line(text('k')), empty)), line(text('k'), text('=', 6), text('1', 8)), line(text('n')), text('∑', 6))
      ),
      '∑_(k=1)^n aₖ'
    ],
    ['a double integral', equation(template(22, 1, line(text('f')), line(text('D')), empty, text('∫', 6))), '∬_D f'],
    ['brackets on both sides', equation(template(1, 0, line(text('a'), text('+', 6), text('b')), text('(', 2), text(')', 2))), '(a+b)'],
    ['a square root and an nth root', equation(template(13, 0, line(text('2', 8)), empty), template(13, 1, line(text('x')), line(text('n')))), '√2ⁿ√x'],
    ['a limit over lines piled', equation(template(39, 1, line(text('lim', 2)), line(text('n'), text('→', 6), text('∞', 6)), empty)), 'lim_(n→∞)'],
    ['an accent, Equation Editor’s byte after it read', equation(three.embellished('x', 8), text('+', 6), text('y')), 'x̃+y'],
    ['an over-bar', equation(template(17, 0, line(text('z')))), 'z̅']
  ])('reads %s', (_, bytes, expected) => {
    expect(mtefText(bytes)).toBe(expected)
  })
})

describe('an object of Equation Editor or MathType', () => {
  /** An `Equation Native` stream: a header of 28 bytes, its first saying so and its third word how much MTEF follows. */
  const native = (mtef: Uint8Array) => {
    const stream = new Uint8Array(28 + mtef.length)
    const view = new DataView(stream.buffer)
    view.setUint16(0, 28, true)
    view.setUint32(2, 0x20000, true)
    view.setUint32(8, mtef.length, true)
    stream.set(mtef, 28)
    return stream
  }
  const mtef = five.equation(five.text('x'), five.template(28, 0, five.empty, five.line(five.text('2', 8))))

  it('reads the equation its storage keeps after the header, and none from a storage without one', () => {
    expect(equationNativeText(native(mtef))).toBe('x²')
    const storage = (streams: Record<string, Uint8Array>): Compound => ({ stream: (name) => streams[name], storage: () => undefined })
    expect(objectEquation(storage({ 'Equation Native': native(mtef) }))).toBe('x²')
    expect(objectEquation(storage({ Workbook: new Uint8Array(8) }))).toBeUndefined()
    expect(objectEquation(storage({ 'Equation Native': new Uint8Array(4) }))).toBeUndefined()
  })

  it.each([
    ['Equation.3', true],
    ['Equation.DSMT4', true],
    [' Equation.DSMT6 ', true],
    ['Excel.Sheet.12', false],
    [undefined, false]
  ])('knows the program %s as one of equations: %s', (program, expected) => {
    expect(isEquationProgram(program)).toBe(expected)
  })
})
