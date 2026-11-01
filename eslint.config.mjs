import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', '**/node_modules/', 'examples/*/docs/', 'packages/*/dist/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The page runs in a browser; everything else in Node.
    files: ['packages/addon-explorer/src/page/**'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    ignores: ['packages/addon-explorer/src/page/**'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    rules: {
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
