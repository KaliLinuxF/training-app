import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dev-dist/**', 'design/**', '**/coverage/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/web/src/sw.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['apps/server/**/*.{ts,mjs}', '**/*.config.{ts,js}', 'apps/web/scripts/**', 'e2e/**', 'deploy/**'],
    languageOptions: { globals: globals.node },
  },
);
