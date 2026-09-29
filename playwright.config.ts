import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Proven körs mot en byggd server (next start) med .env.local (Blob-lagret och nycklarna) eller mot KUNDSTART_BAS_URL
// (skyddad förhandsvisning hos Vercel; då används VERCEL_AUTOMATION_BYPASS_SECRET som huvud).
function lasEnv(): Record<string, string> {
  try {
    const ut: Record<string, string> = {};
    for (const rad of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(rad.trim());
      if (m) ut[m[1]] = m[2];
    }
    return ut;
  } catch {
    return {};
  }
}
const env = lasEnv();
export const INTERN_NYCKEL = process.env.KUNDSTART_INTERN_NYCKEL || env.KUNDSTART_INTERN_NYCKEL || '';
const bas = process.env.KUNDSTART_BAS_URL || 'http://127.0.0.1:3111';
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: bas,
    locale: 'sv-SE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } : {},
  },
  projects: [
    { name: 'mobil', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'dator', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.KUNDSTART_BAS_URL
    ? undefined
    : {
        command: 'npx next start -H 127.0.0.1 -p 3111',
        url: bas + '/',
        reuseExistingServer: true,
        timeout: 60_000,
        // Proven får en egen katalog för testlägets modellval, så att de aldrig ändrar ägarens eget val.
        env: { KUNDSTART_AI: process.env.KUNDSTART_AI || 'regelstyrd', KUNDSTART_PROV_DATA: process.env.KUNDSTART_PROV_DATA || '.scratch/prov-data' },
      },
});
