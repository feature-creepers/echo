import { builtinModules } from 'node:module'

/**
 * Which workspace package may import which.
 *
 * This table enforces section 14.3 of docs/SPEC.md. Change both together.
 *
 * - `dir`      where the package lives.
 * - `runtime`  'any' runs in Node, a browser and a phone, so it may not use a Node API. 'node' and 'browser' say where else it runs.
 * - `side`     'core' is the assistant and what it is built from, 'client' is what runs on a device, 'either' is used by both.
 * - `imports`  the workspace packages it may import. Everything else is refused.
 * - `nodeOnly` files of a runtime 'any' package that may use Node, because they are an entry point of their own.
 */
export const workspace = {
  // Contracts: shared by both sides, import nothing.
  protocol: { dir: 'packages/protocol', runtime: 'any', side: 'either', imports: [] },
  catalog: { dir: 'packages/catalog', runtime: 'any', side: 'either', imports: [] },
  tokens: { dir: 'packages/tokens', runtime: 'any', side: 'either', imports: [] },

  // The assistant: pure logic over the contracts.
  core: { dir: 'packages/core', runtime: 'any', side: 'core', imports: ['protocol', 'catalog'] },

  // Adapters: implement the ports the core defines.
  harness: { dir: 'packages/harness', runtime: 'node', side: 'core', imports: ['core'] },
  store: { dir: 'packages/store', runtime: 'node', side: 'core', imports: ['core'] },
  embedder: { dir: 'packages/embedder', runtime: 'node', side: 'core', imports: ['core', 'models'] },
  tools: { dir: 'packages/tools', runtime: 'node', side: 'core', imports: ['core', 'catalog'] },

  // Used on a device or on a server: import neither side.
  speech: { dir: 'packages/speech', runtime: 'node', side: 'either', imports: ['models'] },
  models: { dir: 'packages/models', runtime: 'node', side: 'either', imports: [] },

  // Client side: never imports the core or an adapter.
  client: {
    dir: 'packages/client',
    runtime: 'any',
    side: 'client',
    imports: ['protocol', 'catalog'],
    nodeOnly: ['src/transports/local.ts', 'src/transports/local.test.ts']
  },
  'ui-web': { dir: 'packages/ui-web', runtime: 'browser', side: 'client', imports: ['client', 'catalog', 'tokens'] },

  // Test doubles for the core's ports.
  testing: { dir: 'packages/testing', runtime: 'node', side: 'core', imports: ['core', 'protocol', 'catalog'] },

  // Applications.
  server: {
    dir: 'apps/server',
    runtime: 'node',
    side: 'core',
    imports: ['core', 'protocol', 'catalog', 'harness', 'store', 'embedder', 'tools', 'speech', 'models']
  },
  desktop: { dir: 'apps/desktop', runtime: 'node', side: 'client', imports: ['client', 'protocol', 'catalog', 'tokens', 'ui-web', 'speech', 'models'] }
}

/** Entry points a package declares besides its root, as `<package>/<path>`. Any other deep import is refused. */
export const entryPoints = ['client/react', 'client/transports/local']

const SCOPE = '@repo/'
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const anyOf = (names) => names.map(escape).join('|')

/** The `no-restricted-imports` patterns for one package. */
function patterns(name, { runtime, imports }, { tests = false, node = false } = {}) {
  const allowed = [name, ...imports, ...(tests ? ['testing'] : [])]
  const out = [
    {
      regex: `^${escape(SCOPE)}(?!(${anyOf(allowed)})(\\/|$))`,
      message: `${SCOPE}${name} may only import: ${imports.length ? imports.map((i) => SCOPE + i).join(', ') : 'nothing from this repository'}. See docs/SPEC.md, section 14.3.`
    },
    {
      regex: `^${escape(SCOPE)}(?!(${anyOf(entryPoints)})$)[^/]+\\/.+`,
      message: "Import a package through its entry points, never through its internal files. Entry points are declared in the package's exports."
    }
  ]
  if (runtime === 'any' && !node) {
    out.push({
      regex: `^(node:|(${anyOf(builtinModules.filter((m) => !m.startsWith('_')))})(\\/|$))`,
      message: `${SCOPE}${name} runs anywhere (Node, a browser, a phone): it may not use a Node API. Ask for what it needs through a port.`
    })
  }
  return out
}

const rule = (list) => ({ 'no-restricted-imports': ['error', { patterns: list }] })
const sources = (dir, globs) => globs.map((glob) => `${dir}/${glob}`)

/** Flat-config entries that apply the table above. Later entries replace earlier ones for the files they match. */
export const boundaries = Object.entries(workspace).flatMap(([name, entry]) => {
  const configs = [{ name: `boundaries/${name}`, files: sources(entry.dir, ['**/*.{ts,tsx}']), rules: rule(patterns(name, entry)) }]
  if (entry.nodeOnly) {
    configs.push({ name: `boundaries/${name}/node-only`, files: sources(entry.dir, entry.nodeOnly), rules: rule(patterns(name, entry, { node: true })) })
  }
  if (entry.side === 'core' && name !== 'testing') {
    configs.push({
      name: `boundaries/${name}/tests`,
      files: sources(entry.dir, ['**/*.test.ts', 'test/**/*.ts']),
      rules: rule(patterns(name, entry, { tests: true, node: true }))
    })
  }
  return configs
})
