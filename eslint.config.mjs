import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**', 'apps/mobile/.expo/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/gateway/**/*.ts', 'packages/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  {
    files: ['**/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
  },
);
