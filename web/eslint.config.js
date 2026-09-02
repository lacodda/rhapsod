import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
// The line's rule: a component names a colour from the dowel vocabulary and
// never writes one down, so the theme can swap it and the accent can move.
import dowel from 'dowel-ui/eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  // The `flat` variant; the top-level one is still in the legacy shape.
  reactHooks.configs.flat['recommended-latest'],
  ...dowel.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // The service worker runs in its own global scope - `self`, `caches`, and
    // the fetch and message events - which is neither the page's nor Node's.
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
)
