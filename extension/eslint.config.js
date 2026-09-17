import eslintReact from '@eslint-react/eslint-plugin';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'public/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Invariant 5, the non-JSX spellings: createElement props, direct DOM
      // writes. The JSX attribute is caught by @eslint-react below.
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: 'Invariant 5: no dangerouslySetInnerHTML. Render through the sanitised markdown component.',
        },
        {
          selector: "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]",
          message: 'Invariant 5: never assign innerHTML/outerHTML.',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'Invariant 5: never call insertAdjacentHTML.',
        },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    extends: [
      eslintReact.configs['recommended-typescript'],
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    rules: {
      // Invariant 5: no dangerouslySetInnerHTML for any model-, provider-, or
      // flow-derived string. Markdown goes through the sanitised renderer.
      '@eslint-react/dom-no-dangerously-set-innerhtml': 'error',
      '@eslint-react/dom-no-dangerously-set-innerhtml-with-children': 'error',
    },
  },
);
