import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import noLiteralUiText from './eslint/no-literal-ui-text.js';

export default tseslint.config(
  { ignores: ['**/dist', '**/target', '**/node_modules', 'apps/desktop/src-tauri/gen'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Interface text comes from the catalogue in packages/i18n (translation plan).
    files: [
      'apps/desktop/src/**/*.tsx',
      'apps/remote/src/**/*.tsx',
      'apps/admin/src/**/*.tsx',
      'apps/output/src/**/*.tsx',
      'packages/ui/src/**/*.tsx',
    ],
    ignores: ['**/*.test.tsx'],
    plugins: { 'worship-q': { rules: { 'no-literal-ui-text': noLiteralUiText } } },
    rules: { 'worship-q/no-literal-ui-text': 'error' },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint/**/*.js'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
);
