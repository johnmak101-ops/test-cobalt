import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

// Flat config for the pnpm workspace (backend NestJS + frontend React). Pragmatic ruleset tuned to
// pass the previously-unlinted code — a working guardrail, tightened incrementally, not a big-bang.
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'backend/drizzle/**',
      'backend/test/smoke.mjs',
      'eslint.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Backend — Node globals.
  {
    files: ['backend/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Tooling / config scripts (plain JS) run in Node.
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Frontend — browser + React-hooks rules. (The plugin and its rules must live in the SAME config
  // object under flat config, so the exhaustive-deps downgrade goes here, not in the block below.)
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'warn',
      // Syncing local form state from fetched data in an effect is a legitimate, widespread pattern
      // here; this new (v7) rule is too aggressive to block CI. Keep it visible as a warning.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // Pragmatic downgrades: the code was never linted, so start lenient and tighten later.
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // pervasive in tests + adapter boundaries
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  prettier, // MUST be last — disables ESLint rules that would fight Prettier
)
