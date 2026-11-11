// Lint: TypeScript recommended rules plus React's rules of hooks.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'public/**',
      'reports/**',
      '.stryker-tmp/**',
      'server/**',
      'src/generated/**',
      'scripts/webr/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['scripts/**/*.mjs', '*.config.{js,mjs}'], languageOptions: { globals: globals.node } },
  {
    // Parsers of the R bridges' JSON (written by our own R code) and the validation-corpus
    // checker: loosely typed input shaped field by field.
    files: ['src/rengine/*.ts', 'src/engine/validationHarness.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
