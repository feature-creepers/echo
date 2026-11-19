import { describe, expect, it } from 'vitest'
import { mathMlText, mathText } from './office-math.ts'
import { xmlEvents } from './xml.ts'

const run = (text: string) => `<m:r><w:rPr><w:rFonts w:ascii="Cambria Math"/></w:rPr><m:t>${text}</m:t></m:r>`
const argument = (inside: string, name = 'm:e') => `<${name}>${inside}</${name}>`
const read = (inside: string) => mathText([...xmlEvents(`<m:oMath>${inside}</m:oMath>`)])

describe('an equation of Word', () => {
  it.each([
    ['text as it is', run('E=m') + run('c'), 'E=mc'],
    ['a fraction of single symbols', `<m:f>${argument(run('a'), 'm:num')}${argument(run('b'), 'm:den')}</m:f>`, 'a/b'],
    [
      'a fraction of longer parts, grouped',
      `<m:f><m:fPr><m:ctrlPr/></m:fPr>${argument(run('x+1'), 'm:num')}${argument(run('2y'), 'm:den')}</m:f>`,
      '(x+1)/(2y)'
    ],
    ['a binomial coefficient', `<m:f><m:fPr><m:type m:val="noBar"/></m:fPr>${argument(run('n'), 'm:num')}${argument(run('k'), 'm:den')}</m:f>`, '(n ¦ k)'],
    ['a power in superscript characters', `<m:sSup>${argument(run('x'))}${argument(run('2'), 'm:sup')}</m:sSup>`, 'x²'],
    ['a power Unicode has no characters for', `<m:sSup>${argument(run('e'))}${argument(run('iπ'), 'm:sup')}</m:sSup>`, 'e^(iπ)'],
    ['an index and a power', `<m:sSubSup>${argument(run('a'))}${argument(run('1'), 'm:sub')}${argument(run('n'), 'm:sup')}</m:sSubSup>`, 'a₁ⁿ'],
    ['a power of a group', `<m:sSup>${argument(run('x+1'))}${argument(run('3'), 'm:sup')}</m:sSup>`, '(x+1)³'],
    ['a square root', `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${argument(run('2'))}</m:rad>`, '√2'],
    ['a cube root', `<m:rad>${argument(run('3'), 'm:deg')}${argument(run('x+1'))}</m:rad>`, '∛(x+1)'],
    ['a root of another degree', `<m:rad>${argument(run('n'), 'm:deg')}${argument(run('x'))}</m:rad>`, 'ⁿ√x'],
    [
      'a sum with its limits',
      `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>${argument(run('i=1'), 'm:sub')}${argument(run('n'), 'm:sup')}${argument(run('i'))}</m:nary>`,
      '∑_(i=1)^n i'
    ],
    [
      'an integral, the sign Word leaves out',
      `<m:nary>${argument(run('0'), 'm:sub')}${argument(run('1'), 'm:sup')}${argument(run('f(x)dx'))}</m:nary>`,
      '∫_0^1 f(x)dx'
    ],
    [
      'brackets of their own and a separator',
      `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/><m:sepChr m:val=","/></m:dPr>${argument(run('a'))}${argument(run('b'))}</m:d>`,
      '[a,b]'
    ],
    ['brackets as Word leaves them', `<m:d>${argument(run('x'))}</m:d>`, '(x)'],
    ['a function', `<m:func>${argument(run('sin'), 'm:fName')}${argument(run('θ'))}</m:func>`, 'sin θ'],
    ['a function of a group', `<m:func>${argument(run('log'), 'm:fName')}${argument(`<m:d>${argument(run('x'))}</m:d>`)}</m:func>`, 'log(x)'],
    ['an accent', `<m:acc><m:accPr><m:chr m:val="̇"/></m:accPr>${argument(run('x'))}</m:acc>`, 'ẋ'],
    [
      'a limit',
      `<m:func>${argument(`<m:limLow>${argument(run('lim'))}${argument(run('n→∞'), 'm:lim')}</m:limLow>`, 'm:fName')}${argument(run('aₙ'))}</m:func>`,
      'lim_(n→∞) aₙ'
    ],
    ['a matrix', `<m:m><m:mr>${argument(run('1'))}${argument(run('0'))}</m:mr><m:mr>${argument(run('0'))}${argument(run('1'))}</m:mr></m:m>`, '[1 0; 0 1]'],
    ['an array of equations', `<m:eqArr>${argument(run('x=1'))}${argument(run('y=2'))}</m:eqArr>`, 'x=1; y=2']
  ])('reads %s', (_, inside, text) => {
    expect(read(inside)).toBe(text)
  })

  it('reads an equation cut short as far as it goes, and one nested past the limit without failing', () => {
    expect(mathText([...xmlEvents(`<m:oMath><m:f>${argument(run('a'), 'm:num')}`)])).toBe('a/')
    const deep = '<m:d><m:e>'.repeat(200) + run('x') + '</m:e></m:d>'.repeat(200)
    expect(read(deep)).toContain('(((')
  })
})

const mathMl = (inside: string, prefix = 'math:') =>
  mathMlText([...xmlEvents(`<${prefix}math>${inside.replaceAll('<', `<${prefix}`).replaceAll(`<${prefix}/`, `</${prefix}`)}</${prefix}math>`)])

describe('an equation of MathML, as OpenDocument keeps one', () => {
  it.each([
    ['its symbols in order', '<mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup>', 'E=mc²'],
    ['a fraction, its longer parts grouped', '<mfrac><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><mi>y</mi></mfrac>', '(x+1)/y'],
    ['an index and a power', '<msubsup><mi>a</mi><mn>1</mn><mi>n</mi></msubsup>', 'a₁ⁿ'],
    ['a power Unicode has no characters for', '<msup><mi>e</mi><mrow><mi>i</mi><mi>π</mi></mrow></msup>', 'e^(iπ)'],
    ['a square root and a cube root', '<msqrt><mn>2</mn></msqrt><mroot><mi>x</mi><mn>3</mn></mroot>', '√2∛x'],
    ['a sum with its limits', '<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>i</mi>', '∑_(i=1)^n i'],
    ['brackets and their separators', '<mfenced open="[" close="]"><mi>a</mi><mi>b</mi></mfenced>', '[a,b]'],
    [
      'a table, row by row',
      '<mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable>',
      '[1 0; 0 1]'
    ],
    [
      'its layout only, the source of the app that wrote it passed over',
      '<semantics><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><annotation encoding="StarMath 5.0">a + b</annotation></semantics>',
      'a+b'
    ]
  ])('reads %s', (_, inside, expected) => {
    expect(mathMl(inside)).toBe(expected)
  })

  it('reads one with no prefix as well', () => {
    expect(mathMl('<mfrac><mi>a</mi><mi>b</mi></mfrac>', '')).toBe('a/b')
  })
})
