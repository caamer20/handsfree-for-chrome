import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep an optional local browser download inside the ignored workspace directory.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('.browser-test-data/browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.browser-test-data/browsers');
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 0,
  maxFailures: process.env.CI ? 3 : 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  // Windows CI has an interactive desktop; use native windows for popup/panel APIs.
  use: { headless: !(process.env.CI && process.platform === 'win32'), trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
