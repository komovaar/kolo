// White, transparent browser-tab mark, using the shared Kolo geometry.
// Run after npm ci and npx playwright install chromium:
// node brand/favicon.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { markSvg } from './ring.ts';

const assets = new URL('../internal/hub/ui/assets/', import.meta.url);
const svg = markSvg(256, '#FFFFFF');
writeFileSync(new URL('favicon.svg', assets), svg + '\n');

const browser = await chromium.launch({ headless: true,
  ...(process.env.KOLO_CHROME ? { executablePath: process.env.KOLO_CHROME } : {}) });
try {
  for (const size of [32, 256]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`favicon-${size}.png`, assets)), omitBackground: true });
    await page.close();
  }
} finally { await browser.close(); }
