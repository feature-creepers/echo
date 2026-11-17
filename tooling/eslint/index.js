import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { boundaries } from './boundaries.js'
import { PERSONA_DEFAULTS_FILE, personaNameSelectors } from './persona-names.js'

/** One way to export: named. A default export can be renamed by every importer. */
const namedExportsOnly = { selector: 'ExportDefaultDeclaration', message: 'Use a named export.' }

export default tseslint.config(
  { name: 'ignored', ignores: ['**/dist/**', '**/out/**', '**/release/**', '**/coverage/**', '**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    name: 'conventions',
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Types are imported as types, so a type-only import never loads a module at run time.
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': ['error', namedExportsOnly, ...personaNameSelectors]
    }
  },
  {
    // Build tools read their configuration from a default export, and a bundler gives a stylesheet's classes as one.
    name: 'conventions/default-exports-required',
    files: ['**/*.config.ts', '**/*.d.ts'],
    rules: { 'no-restricted-syntax': ['error', ...personaNameSelectors] }
  },
  {
    // The one file where the default names of the personas are written.
    name: 'conventions/persona-defaults',
    files: [PERSONA_DEFAULTS_FILE],
    rules: { 'no-restricted-syntax': ['error', namedExportsOnly] }
  },
  ...boundaries
)
