import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/generated/**',
      '**/.local/**',
      '.agents/**',
      '.conversation/**',
      'attached_assets/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      complexity: ['warn', { max: 20, variant: 'modified' }],
      'max-depth': ['warn', 4],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
  {
    files: ['artifacts/*/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['artifacts/glyph/src/**/*.{ts,tsx}'],
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['extensions/glyph-gmail/*.js'],
    languageOptions: { globals: { chrome: 'readonly' } },
  },
  {
    files: [
      'scripts/test-*.mjs',
      'scripts/*.test.mjs',
      'scripts/tests/**/*.test.mjs',
      'artifacts/glyph/tests/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[property.name=/^(only|skip|todo|skipIf|runIf)$/]',
          message:
            'Focused, skipped, or TODO tests cannot pass a release gate.',
        },
        {
          selector:
            'CallExpression[callee.name=/^(test|it|describe)$/] > ObjectExpression > Property[key.name=/^(only|skip|todo)$/]',
          message:
            'Test options must not hide focused, skipped, or TODO cases.',
        },
      ],
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['scripts/tests/**/*.integration.test.mjs'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['artifacts/api-server/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
);
