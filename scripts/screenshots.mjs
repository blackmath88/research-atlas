// Render desktop and mobile screenshots of the production build (served by `npm run preview`).
// Usage: node scripts/screenshots.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch(process.env.CI ? {} : { executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const shots = [
  { name: 'desktop-overview', vp: { width: 1440, height: 900 }, q: '?data=./fixtures/collections.json' },
  { name: 'desktop-person', vp: { width: 1440, height: 900 }, q: '?data=./fixtures/collections.json&sel=SYNA15' },
  { name: 'desktop-work', vp: { width: 1440, height: 900 }, q: '?data=./fixtures/collections.json&sel=SYNW002' },
  { name: 'desktop-public-data', vp: { width: 1440, height: 900 }, q: '' },
  { name: 'mobile-overview', vp: { width: 390, height: 844 }, q: '?data=./fixtures/collections.json' },
  { name: 'mobile-person', vp: { width: 390, height: 844 }, q: '?data=./fixtures/collections.json&sel=SYNA15' },
];
for (const s of shots) {
  const page = await browser.newPage({ viewport: s.vp });
  await page.goto(base + s.q);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `docs/screenshots/${s.name}.png` });
  await page.close();
}
await browser.close();
