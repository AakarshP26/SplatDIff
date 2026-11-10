// Export the "How it works" pipeline diagram (diagram + step cards) as a PNG for the report/slides.
// Usage (server on :8765 serving web/): node scripts/export_diagram.mjs [out.png]
import { chromium } from 'playwright-core';
import fs from 'fs';
const out = process.argv[2] || 'results/figures/pipeline_diagram.png';
const exe = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
await page.goto('http://localhost:8765/index.html');
await page.waitForFunction(() => window.__splatdiffReady === true, null, { timeout: 180000 });
await page.evaluate(() => document.querySelector('#nav button[data-page="how"]').click());
await page.waitForTimeout(3000);
// Clip a box around the diagram and the step cards, with a small margin.
const box = await page.evaluate(() => {
  const a = document.getElementById('diagram').getBoundingClientRect();
  const b = document.querySelector('#page-how .steps').getBoundingClientRect();
  const m = 24;
  const x = Math.min(a.left, b.left) - m, y = a.top - m;
  return { x, y, width: Math.max(a.right, b.right) + m - x, height: b.bottom + m - y };
});
await page.screenshot({ path: out, clip: box });
console.log('wrote', out, JSON.stringify(box));
await browser.close();
