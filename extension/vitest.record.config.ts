import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// The demo recorder runs through Vitest for the same reason the grounding eval
// does: it shares the bundle's prompt loader (`?raw` import), path aliases, and
// adapters with the product. It talks to the real provider under a real key
// and is never part of `npm test` or `npm run eval`: `npm run record-demo`.
// The timeouts are longer than the eval's because the Document answer is long.
// It stops at the first failure: nothing is written unless every recording
// passes, so the remaining requests would only spend the key.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['eval/**/*.record.ts'],
    testTimeout: 330_000,
    bail: 1,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
