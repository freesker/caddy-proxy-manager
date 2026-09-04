import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';

export default [
  {
    // public/maplibre holds maplibre-gl's minified worker bundle, staged from
    // node_modules at build time by scripts/copy-maplibre-worker.mjs.
    ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts', '.claude/**', 'public/maplibre/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@next/next/no-img-element': 'off',
    },
  },
  {
    // Node config/build scripts (.mjs/.cjs) run outside Next's TS pipeline,
    // so declare the Node globals ESLint's no-undef cannot infer.
    files: ['**/*.{mjs,cjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
      },
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
