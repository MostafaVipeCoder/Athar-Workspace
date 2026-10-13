import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

const physicalDir = String.raw`\b(ml|mr|pl|pr|left|right|text-left|text-right|rounded-l|rounded-r|border-l|border-r)-(\d|\[|auto|px|full)`

// RTL-safe Tailwind: physical direction utilities are flagged (design 06 sections 7 and 13.3)
const physicalDirRule = {
  selector: `JSXAttribute[name.name='className'] Literal[value=/${physicalDir}/]`,
  message: 'Use logical utilities (ms-/me-/ps-/pe-/start-/end-/text-start/text-end) so the layout is RTL-safe.',
}
// Owner decision 08 section 17.3 (universal WebP): a file reaches Storage ONLY through src/data/storage.js (images are converted to WebP there).
const directUploadRule = {
  selector: 'CallExpression[callee.property.name=/^(upload|uploadToSignedUrl|createSignedUploadUrl)$/]',
  message: 'Never call storage .upload() / .uploadToSignedUrl() / .createSignedUploadUrl() directly: use storeImage / uploadImage (images -> WebP) or uploadObject (other files) from src/data/storage.js.',
}
// `.update(path, file)` REPLACES a stored object (a second door to the same bucket). `.update` alone is the PostgREST row update everywhere, so only a call on a
// storage bucket handle is flagged: `<x>.storage.from(bucket).update(...)` and `store.update(...)` / `bucket.update(...)` on a variable holding one.
const directReplaceRules = [
  {
    selector: 'CallExpression[callee.property.name="update"][callee.object.type="CallExpression"][callee.object.callee.property.name="from"][callee.object.callee.object.property.name="storage"]',
    message: 'Never replace a stored file with storage .update() directly: use storeImage / uploadObject from src/data/storage.js.',
  },
  {
    selector: 'CallExpression[callee.property.name="update"][callee.object.name=/^(store|bucket|storageBucket|files)$/]',
    message: 'Never replace a stored file with storage .update() directly: use storeImage / uploadObject from src/data/storage.js.',
  },
]

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite, jsxA11y.flatConfigs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^(_|[A-Z])' }],
      'no-restricted-globals': ['error', 'alert', 'confirm', 'prompt'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': ['error', physicalDirRule],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Supabase only through data/
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/data/**', 'src/**/*.test.*'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['@supabase/*'], message: 'Import Supabase only inside src/data/.' },
        { group: ['**/data/client', '**/data/client.js'], message: 'Use the data/ modules, not the raw client.' },
      ] }],
    },
  },
  {
    // universal WebP: no direct storage uploads outside data/storage.js (the certificate template goes through storeImage too, m42)
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/data/storage.js', 'src/**/*.test.*'],
    rules: { 'no-restricted-syntax': ['error', physicalDirRule, directUploadRule, ...directReplaceRules] },
  },
  {
    // ui/ is generic
    files: ['src/ui/**/*.{js,jsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [
      { group: ['@supabase/*'], message: 'ui/ must stay generic.' },
      { group: ['**/data/*', '**/shared/*', '**/nodes/*', '**/app/*'], message: 'ui/ must stay generic.' },
    ] }] },
  },
  {
    // a node folder never imports another node folder
    files: ['src/nodes/*/**/*.{js,jsx}'],
    ignores: ['src/nodes/_kit/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [
      { group: ['@supabase/*'], message: 'Nodes use data/ modules only.' },
      { regex: '^[.][.]/(?!_kit/)[^./][^/]*/', message: 'A node folder must not import another node folder.' },
    ] }] },
  },
  { files: ['**/*.test.{js,jsx}', 'src/test/**'], languageOptions: { globals: { ...globals.browser, ...globals.vitest } }, rules: { 'no-console': 'off', 'no-restricted-imports': 'off' } },
  { files: ['*.config.js'], languageOptions: { globals: globals.node } },
  { files: ['src/lib/log.js'], rules: { 'no-console': 'off' } },
])
