import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['.vite/', 'out/', 'dist/', 'node_modules/', 'backend/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
