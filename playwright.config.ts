import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // The frame-budget trace must not share the CPU with other workers: run it alone via `npm run e2e:perf`.
  testIgnore: process.env.PERF ? [] : ['**/perf.spec.ts'],
  outputDir: 'tests/artifacts/playwright',
  timeout: 1_500_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4180',
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu'] },
    video: 'retain-on-failure',
    // No trace: its DOM snapshots of a whole match (hundreds of beats and cards) slowed the page to a crawl; video stays for failures.
    trace: 'off',
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4180 --strictPort',
    url: 'http://localhost:4180',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    { name: 'laptop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'], browserName: 'chromium' } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
