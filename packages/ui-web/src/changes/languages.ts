/**
 * The languages a diff is coloured in, each as the few rules `syntax.ts` reads it by, and which a file is in, by
 * its name. A file in none is drawn plain.
 */

import type { Enclosure, Language, Rule } from './syntax.ts'

const words = (text: string): ReadonlySet<string> => new Set(text.split(/\s+/).filter(Boolean))

const BLOCK_COMMENT: Enclosure = { open: '/*', close: '*/', role: 'comment', multiline: true, continues: /^\s*\*(?:\s|$)/ }
const DOUBLE: Enclosure = { open: '"', close: '"', role: 'string', escape: '\\' }
const SINGLE: Enclosure = { open: "'", close: "'", role: 'string', escape: '\\' }
const HTML_COMMENT: Enclosure = { open: '<!--', close: '-->', role: 'comment', multiline: true }
const rule = (pattern: RegExp, role: Rule['role']): Rule => ({ pattern, role })
/** `@Name` before a declaration: a decorator, an annotation. */
const ANNOTATION = rule(/(?<![\w@])@[A-Za-z_][\w.]*/y, 'function')

/** What the languages of the C family share: `//` and block comments, strings in quotes, calls, capitals for types. */
const cFamily = (language: Language): Language => ({
  lineComments: ['//'],
  calls: true,
  capitalTypes: true,
  capitalConstants: true,
  ...language,
  enclosures: language.enclosures ?? [BLOCK_COMMENT, DOUBLE, SINGLE]
})

const script = cFamily({
  enclosures: [BLOCK_COMMENT, DOUBLE, SINGLE, { open: '`', close: '`', role: 'string', escape: '\\', multiline: true }],
  // A tag's or a type argument's name, right after its bracket: `<div`, `</div`, `Array<Row>`.
  rules: [rule(/(?<=<\/?)[A-Za-z_$][\w$.]*/y, 'type'), ANNOTATION],
  regexes: true,
  keywords: words(`break case catch class const continue debugger default delete do else export extends finally for function if
    import in instanceof let new return super switch this throw try typeof var void while with yield async await of static as from
    implements interface private protected public readonly declare abstract enum type namespace keyof infer is satisfies override`),
  constants: words('true false null undefined NaN Infinity'),
  types: words('string number boolean any unknown never object symbol bigint'),
  declares: { function: 'function', class: 'type', interface: 'type', type: 'type', enum: 'type', namespace: 'type' }
})

const python: Language = {
  lineComments: ['#'],
  enclosures: [
    { open: '"""', close: '"""', role: 'string', escape: '\\', multiline: true },
    { open: "'''", close: "'''", role: 'string', escape: '\\', multiline: true },
    DOUBLE,
    SINGLE
  ],
  rules: [rule(/(?<=^\s*)@[\w.]+/y, 'function')],
  keywords: words(`and as assert async await break class continue def del elif else except finally for from global if import in is
    lambda nonlocal not or pass raise return try while with yield case`),
  constants: words('True False None'),
  types: words('int float str bool bytes list dict set tuple object type complex frozenset bytearray'),
  calls: true,
  capitalTypes: true,
  capitalConstants: true,
  declares: { def: 'function', class: 'type' }
}

const go = cFamily({
  enclosures: [BLOCK_COMMENT, DOUBLE, SINGLE, { open: '`', close: '`', role: 'string', multiline: true }],
  keywords: words(`break case chan const continue default defer else fallthrough for func go goto if import interface map package
    range return select struct switch type var`),
  constants: words('true false nil iota'),
  types: words(`bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16
    uint32 uint64 uintptr any comparable`),
  // In Go a capital says a name is exported, not that it is a type.
  capitalTypes: false,
  capitalConstants: false,
  declares: { func: 'function', type: 'type' }
})

const rust = cFamily({
  // A quote alone is a lifetime (`'a`), so characters are a pattern of their own rather than a string to close.
  enclosures: [BLOCK_COMMENT, DOUBLE],
  rules: [
    rule(/'(?:\\.|[^\\'])'/y, 'string'),
    rule(/'[A-Za-z_]\w*/y, 'type'),
    rule(/[A-Za-z_]\w*!(?=\s*[([{])/y, 'function'),
    rule(/#!?\[[^\]]*\]/y, 'function')
  ],
  keywords: words(`as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub
    ref return self Self static struct super trait type unsafe use where while yield`),
  constants: words('true false'),
  types: words('i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str'),
  declares: { fn: 'function', struct: 'type', enum: 'type', trait: 'type', type: 'type' }
})

const java = cFamily({
  rules: [ANNOTATION],
  keywords: words(`abstract assert break case catch class continue default do else enum extends final finally for if implements
    import instanceof interface native new package private protected public return static strictfp super switch synchronized this
    throw throws transient try volatile while var record yield sealed permits`),
  constants: words('true false null'),
  types: words('boolean byte char double float int long short void'),
  declares: { class: 'type', interface: 'type', enum: 'type', record: 'type' }
})

const kotlin = cFamily({
  enclosures: [BLOCK_COMMENT, { open: '"""', close: '"""', role: 'string', multiline: true }, DOUBLE, SINGLE],
  rules: [ANNOTATION],
  keywords: words(`as break class continue do else for fun if in interface is object package return super this throw try typealias
    val var when while by catch constructor init companion data enum sealed open override private protected public internal
    abstract final inner lateinit suspend inline import`),
  constants: words('true false null'),
  declares: { fun: 'function', class: 'type', interface: 'type', object: 'type', typealias: 'type' }
})

const swift = cFamily({
  enclosures: [BLOCK_COMMENT, { open: '"""', close: '"""', role: 'string', escape: '\\', multiline: true }, DOUBLE],
  rules: [ANNOTATION],
  keywords: words(`associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private
    protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard
    if in repeat return switch where while as catch is super self Self throw throws try async await some any`),
  constants: words('true false nil'),
  declares: { func: 'function', class: 'type', struct: 'type', enum: 'type', protocol: 'type', extension: 'type' }
})

const csharp = cFamily({
  enclosures: [BLOCK_COMMENT, { open: '@"', close: '"', role: 'string', multiline: true }, DOUBLE, SINGLE],
  rules: [rule(/(?<=^\s*)#\s*\w+/y, 'keyword')],
  keywords: words(`abstract as base break case catch checked class const continue default delegate do else enum event explicit
    extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params
    private protected public readonly ref return sealed sizeof stackalloc static struct switch this throw try typeof unchecked
    unsafe using virtual volatile while async await var record init get set yield when where nameof`),
  constants: words('true false null'),
  types: words('bool byte char decimal double float int long object sbyte short string uint ulong ushort void dynamic'),
  declares: { class: 'type', interface: 'type', struct: 'type', enum: 'type', record: 'type' }
})

const c = cFamily({
  rules: [rule(/(?<=^\s*#\s*include\s*)<[^>]*>/y, 'string'), rule(/(?<=^\s*)#\s*\w+/y, 'keyword')],
  keywords: words(`auto break case const continue default do else enum extern for goto if inline register restrict return signed
    sizeof static struct switch typedef union unsigned volatile while alignas alignof catch class constexpr consteval constinit
    decltype delete explicit export friend mutable namespace new noexcept operator private protected public reinterpret_cast
    static_assert static_cast dynamic_cast const_cast template this thread_local throw try typeid typename using virtual co_await
    co_return co_yield concept requires override final`),
  constants: words('true false NULL nullptr'),
  types: words('bool char double float int long short void size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t'),
  declares: { class: 'type', struct: 'type', enum: 'type', union: 'type', namespace: 'type' }
})

const php = cFamily({
  lineComments: ['//', '#'],
  rules: [rule(/<\?(?:php)?|\?>/y, 'keyword'), rule(/\$[A-Za-z_]\w*/y, 'type')],
  keywords: words(`abstract and array as break callable case catch class clone const continue declare default do echo else elseif
    empty extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof
    interface isset list match namespace new or print private protected public readonly require require_once return static switch
    throw trait try unset use var while xor yield`),
  constants: words('true false null'),
  anyCase: true,
  declares: { function: 'function', class: 'type', interface: 'type', trait: 'type', enum: 'type' }
})

const ruby: Language = {
  lineComments: ['#'],
  enclosures: [DOUBLE, SINGLE],
  rules: [rule(/(?<![:\w]):[A-Za-z_]\w*[?!]?/y, 'number'), rule(/@@?[A-Za-z_]\w*/y, 'type')],
  keywords: words(`alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue
    retry return self super then undef unless until when while yield require require_relative attr_accessor attr_reader`),
  constants: words('true false nil'),
  calls: true,
  capitalTypes: true,
  capitalConstants: true,
  declares: { def: 'function', class: 'type', module: 'type' }
}

const lua: Language = {
  lineComments: ['--'],
  enclosures: [{ open: '--[[', close: ']]', role: 'comment', multiline: true }, { open: '[[', close: ']]', role: 'string', multiline: true }, DOUBLE, SINGLE],
  keywords: words('and break do else elseif end for function goto if in local not or repeat return then until while'),
  constants: words('true false nil'),
  calls: true,
  declares: { function: 'function' }
}

const sql: Language = {
  lineComments: ['--'],
  enclosures: [BLOCK_COMMENT, { open: "'", close: "'", role: 'string' }, { open: '"', close: '"', role: 'type' }],
  keywords: words(`select from where insert into values update set delete create table alter drop index view join inner left right
    outer full cross on and or not is in exists between like ilike as order by group having limit offset union all distinct case when
    then else end primary key foreign references default unique check constraint begin commit rollback transaction with returning
    if replace column add rename to asc desc cascade trigger function procedure return returns language database schema grant`),
  constants: words('true false null'),
  types: words(`int integer bigint smallint tinyint text varchar char boolean bool date time timestamp timestamptz interval real
    double precision float numeric decimal blob serial bigserial uuid json jsonb bytea`),
  anyCase: true,
  calls: true
}

const VARIABLE = rule(/\$(?:\{[^}]*\}|[A-Za-z_]\w*|[\d@#?$!*-])/y, 'type')

const shell: Language = {
  lineComments: ['#'],
  commentAfterSpace: true,
  enclosures: [DOUBLE, { open: "'", close: "'", role: 'string' }],
  rules: [VARIABLE],
  keywords: words('if then else elif fi case esac for select while until do done in function time coproc'),
  builtins: words(`echo printf read cd pwd export local readonly declare typeset unset shift source alias set trap eval exec exit
    return break continue wait kill test`),
  constants: words('true false'),
  declares: { function: 'function' }
}

const powershell: Language = {
  lineComments: ['#'],
  enclosures: [
    { open: '<#', close: '#>', role: 'comment', multiline: true },
    { open: '@"', close: '"@', role: 'string', multiline: true },
    { open: "@'", close: "'@", role: 'string', multiline: true },
    { open: '"', close: '"', role: 'string', escape: '`' },
    { open: "'", close: "'", role: 'string' }
  ],
  rules: [
    rule(/\$(?:true|false|null)\b/iy, 'number'),
    rule(/\$(?:\{[^}]*\}|[\w:]+)/y, 'type'),
    rule(
      /(?<![\w-])-(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|replace|and|or|not|xor|is|isnot|as|split|join|f)\b/iy,
      'keyword'
    ),
    rule(/(?<![\w-])-[A-Za-z]\w*/y, 'type'),
    rule(/[A-Za-z]+-[A-Za-z]\w*/y, 'function'),
    rule(/(?<=\[)[A-Za-z][\w.]*(?=\])/y, 'type')
  ],
  keywords: words(`begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from
    function if in param process return switch throw trap try until using while`),
  anyCase: true,
  declares: { function: 'function', filter: 'function', class: 'type' }
}

const batch: Language = {
  enclosures: [{ open: '"', close: '"', role: 'string' }],
  rules: [
    rule(/(?<=^\s*@?)rem(?:\s.*)?$/iy, 'comment'),
    rule(/(?<=^\s*)::.*$/y, 'comment'),
    rule(/(?<=^\s*):\w+/y, 'function'),
    rule(/%[^%\s]+%|%%?~?\w|![^!\s]+!/y, 'type')
  ],
  keywords: words(`if else for in do goto call exit set setlocal endlocal echo off on not exist defined errorlevel equ neq lss leq gtr
    geq shift pushd popd cd start`),
  anyCase: true
}

const json: Language = {
  lineComments: ['//'],
  enclosures: [BLOCK_COMMENT, DOUBLE],
  constants: words('true false null'),
  keys: true
}

const css: Language = {
  enclosures: [BLOCK_COMMENT, DOUBLE, SINGLE],
  rules: [
    rule(/(?<=(?:^|[{;])\s*)(?:--|\$)?[A-Za-z][\w-]*(?=\s*:(?:\s|$))/y, 'type'),
    rule(/#[\da-fA-F]{3,8}\b/y, 'number'),
    rule(/@[\w-]+/y, 'keyword'),
    rule(/\$[\w-]+/y, 'type'),
    rule(/!important\b/y, 'keyword')
  ],
  word: /-?[\p{L}_][\p{L}\p{N}_-]*/uy,
  calls: true
}

const scss: Language = { ...css, lineComments: ['//'] }

const markup: Language = {
  enclosures: [HTML_COMMENT, { open: '<![CDATA[', close: ']]>', role: 'string', multiline: true }],
  rules: [
    rule(/(?<=<)[!?][A-Za-z][\w-]*/y, 'keyword'),
    rule(/(?<=<\/?)[A-Za-z][\w:.-]*/y, 'keyword'),
    rule(/[A-Za-z_:@#][\w:.-]*(?=\s*=\s*["'{])/y, 'type'),
    rule(/(?<==\s*)"[^"]*"|(?<==\s*)'[^']*'/y, 'string'),
    rule(/&#?\w+;/y, 'number')
  ],
  numbers: false
}

const markdown: Language = {
  enclosures: [
    HTML_COMMENT,
    { open: '```', close: '```', role: 'string', multiline: true },
    { open: '~~~', close: '~~~', role: 'string', multiline: true },
    { open: '`', close: '`', role: 'string' }
  ],
  rules: [
    rule(/(?<=^\s{0,3})#{1,6}(?:\s.*)?$/y, 'keyword'),
    rule(/(?<=^\s*)>.*$/y, 'comment'),
    rule(/(?<=^\s*)(?:[-*+]|\d+[.)])(?=\s)/y, 'keyword'),
    rule(/(?<=\])\([^)\s]*(?:\s+"[^"]*")?\)/y, 'string')
  ],
  numbers: false
}

const yaml: Language = {
  lineComments: ['#'],
  commentAfterSpace: true,
  rules: [
    rule(/(?<=^\s*)-(?=\s|$)/y, 'keyword'),
    rule(/(?<=^[\s-]*)[^\s#'"\-[{][^:#]*?(?=\s*:(?:\s|$))/y, 'type'),
    rule(/(?<=(?:^|[:\-[,{])\s*)"(?:\\.|[^"\\])*"/y, 'string'),
    rule(/(?<=(?:^|[:\-[,{])\s*)'(?:[^']|'')*'/y, 'string'),
    rule(/(?<=\s)[&*][\w-]+/y, 'function'),
    rule(/(?<=\s)!!?[\w-]+/y, 'keyword')
  ],
  constants: words('true false null yes no on off ~'),
  anyCase: true
}

const toml: Language = {
  lineComments: ['#'],
  enclosures: [
    { open: '"""', close: '"""', role: 'string', escape: '\\', multiline: true },
    { open: "'''", close: "'''", role: 'string', multiline: true },
    DOUBLE,
    { open: "'", close: "'", role: 'string' }
  ],
  rules: [rule(/(?<=^\s*)\[\[?[^\]]*\]\]?/y, 'keyword'), rule(/(?<=^\s*)[\w.-]+(?=\s*=)/y, 'type')],
  constants: words('true false')
}

const ini: Language = {
  lineComments: [';', '#'],
  enclosures: [{ open: '"', close: '"', role: 'string' }],
  rules: [rule(/(?<=^\s*)\[[^\]]*\]/y, 'keyword'), rule(/(?<=^\s*)[^=;#\s[][^=;#]*?(?=\s*=)/y, 'type')],
  constants: words('true false yes no on off'),
  anyCase: true
}

const environment: Language = {
  lineComments: ['#'],
  commentAfterSpace: true,
  enclosures: [DOUBLE, { open: "'", close: "'", role: 'string' }],
  rules: [rule(/(?<=^\s*)export(?=\s)/y, 'keyword'), rule(/(?<=^\s*(?:export\s+)?)[A-Za-z_]\w*(?=\s*=)/y, 'type'), VARIABLE]
}

const docker: Language = {
  lineComments: ['#'],
  commentAfterSpace: true,
  enclosures: [DOUBLE, { open: "'", close: "'", role: 'string' }],
  rules: [
    rule(
      /(?<=^\s*)(?:from|run|cmd|label|expose|env|add|copy|entrypoint|volume|user|workdir|arg|onbuild|stopsignal|healthcheck|shell|maintainer)\b/iy,
      'keyword'
    ),
    rule(/(?<=\s)as(?=\s)/iy, 'keyword'),
    rule(/(?<=\s)--[\w-]+/y, 'type'),
    VARIABLE
  ]
}

const make: Language = {
  lineComments: ['#'],
  enclosures: [DOUBLE, { open: "'", close: "'", role: 'string' }],
  rules: [
    rule(/\$[({][^)}]*[)}]|\$[@<^?*%]/y, 'type'),
    rule(/^(?:ifeq|ifneq|ifdef|ifndef|else|endif|include|-include|define|endef|export|override)\b/y, 'keyword'),
    rule(/^[\w.-]+(?=\s*[:+?]?=)/y, 'type'),
    rule(/^[^\s:=#][^:=#]*(?=:(?!=))/y, 'function')
  ]
}

const ignore: Language = { lineComments: ['#'], rules: [rule(/^!/y, 'keyword')], numbers: false }

/** Languages by a file's extension, without its dot, in lower case. */
const BY_EXTENSION: Readonly<Record<string, Language>> = {
  ...Object.fromEntries(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'].map((one) => [one, script])),
  ...Object.fromEntries(['py', 'pyi', 'pyw'].map((one) => [one, python])),
  ...Object.fromEntries(['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'ino', 'm', 'mm'].map((one) => [one, c])),
  ...Object.fromEntries(['sh', 'bash', 'zsh', 'ksh', 'command'].map((one) => [one, shell])),
  ...Object.fromEntries(['ps1', 'psm1', 'psd1'].map((one) => [one, powershell])),
  ...Object.fromEntries(['bat', 'cmd'].map((one) => [one, batch])),
  ...Object.fromEntries(['json', 'jsonc', 'json5', 'webmanifest'].map((one) => [one, json])),
  ...Object.fromEntries(['scss', 'less'].map((one) => [one, scss])),
  ...Object.fromEntries(
    [
      'html',
      'htm',
      'xhtml',
      'xml',
      'svg',
      'xsd',
      'xsl',
      'xslt',
      'plist',
      'csproj',
      'fsproj',
      'vbproj',
      'vcxproj',
      'props',
      'targets',
      'resx',
      'xaml',
      'vue',
      'svelte',
      'astro'
    ].map((one) => [one, markup])
  ),
  ...Object.fromEntries(['md', 'markdown', 'mdx'].map((one) => [one, markdown])),
  ...Object.fromEntries(['yml', 'yaml'].map((one) => [one, yaml])),
  ...Object.fromEntries(['ini', 'cfg', 'conf', 'properties', 'desktop', 'service'].map((one) => [one, ini])),
  go,
  rs: rust,
  java,
  kt: kotlin,
  kts: kotlin,
  swift,
  cs: csharp,
  php,
  rb: ruby,
  lua,
  sql,
  css,
  toml,
  mk: make,
  dockerfile: docker
}

/** Languages by a file's whole name, in lower case, for files whose name says it rather than an extension. */
const BY_NAME: Readonly<Record<string, Language>> = {
  makefile: make,
  gnumakefile: make,
  dockerfile: docker,
  containerfile: docker,
  gemfile: ruby,
  rakefile: ruby,
  '.bashrc': shell,
  '.bash_profile': shell,
  '.zshrc': shell,
  '.zprofile': shell,
  '.profile': shell,
  '.gitignore': ignore,
  '.dockerignore': ignore,
  '.npmignore': ignore,
  '.prettierignore': ignore,
  '.gitattributes': ignore,
  '.editorconfig': ini,
  '.gitconfig': ini,
  '.npmrc': ini,
  '.gitmodules': ini
}

/** The language a file is written in, by its name; none for a file this does not know, which is drawn plain. */
export function languageOf(path: string): Language | undefined {
  const name = (path.split(/[\\/]/).at(-1) ?? path).toLowerCase()
  const named = BY_NAME[name]
  if (named) return named
  if (name === '.env' || name.startsWith('.env.')) return environment
  if (name.startsWith('dockerfile.')) return docker
  const dot = name.lastIndexOf('.')
  return dot > 0 ? BY_EXTENSION[name.slice(dot + 1)] : undefined
}
