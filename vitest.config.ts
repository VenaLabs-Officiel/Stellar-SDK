/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    // API tests run in node; component tests run in jsdom (see below)
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [
      // jsdom with Node's native AbortController, required by the native fetch
      ['src/components/**/*.test.tsx', './src/test/jsdom-environment.ts'],
    ],
    // Loaded for every test file; DOM-only mocks are guarded inside the file
    setupFiles: ['./src/test/setup.ts'],
    server: {
      deps: {
        // The published ESM build of the wallet kit cannot be loaded by Node
        // as-is (named imports from a CommonJS dependency), so let Vite
        // process it instead of externalizing it
        inline: ['@creit.tech/stellar-wallets-kit'],
      },
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/api/**/*.ts', 'src/components/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/index.ts'],
    },
  },
});
