import { defineConfig, devices } from '@playwright/test'

/**
 * The road gate: a real browser against a real stand.
 *
 * The unit tests prove the offline code says the right things when it is
 * handed the right facts. They cannot prove a browser registers the worker,
 * that the worker caches what it is told to, or that the app still opens with
 * the stand switched off - and on 2026-09-07 exactly that broke, quietly,
 * because nothing here was watching.
 *
 * `localhost` is a secure context by browser rule, so this runs without a
 * certificate; on the Pi the same secure context comes from https (see the
 * "Behind a door" guide). The test is about what the app does with a secure
 * context, not about how the stand got one.
 */
export default defineConfig({
  testDir: './road',
  // A worker cache is per-origin and shared; two tests filling it at once
  // would each see the other's pieces.
  workers: 1,
  fullyParallel: false,
  // A flake here is a real doubt about the offline promise, so it is reported
  // rather than retried away.
  retries: 0,
  reporter: process.env.CI ? 'list' : 'line',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:8099',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Built, not `pnpm dev`: the service worker is stamped with the version at
  // build time and the dev server does not serve it the way a stand does.
  webServer: {
    command: 'node road/stand.mjs',
    url: 'http://localhost:8099/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
