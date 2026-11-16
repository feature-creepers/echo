import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { boundaries } from './boundaries.js'

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
      // One way to export: named. A default export can be renamed by every importer.
      'no-restricted-syntax': ['error', { selector: 'ExportDefaultDeclaration', message: 'Use a named export.' }]
    }
  },
  ...boundaries
)
