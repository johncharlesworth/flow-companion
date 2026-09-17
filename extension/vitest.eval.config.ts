import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// The grounding eval runs through Vitest so it shares the
// bundle's prompt loader (`?raw` import), path aliases, and adapters with the
// product. It talks to the real provider under a real key and is
// never part of `npm test`: `npm run eval`.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['eval/**/*.eval.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
