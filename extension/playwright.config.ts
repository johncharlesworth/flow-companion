import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // A flaky smoke check is a bug, not something to retry past.
  retries: 0,
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
