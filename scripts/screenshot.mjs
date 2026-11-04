// Headless screenshots of the web UI. Usage (server on :8765 serving web/):
//   node scripts/screenshot.mjs <out.png> <width> <height> [query] [action]
// action: none | results | benchmark | how | help | present
import { chromium } from 'playwright-core';
const [out, w = '1920', h = '1080', query = '', action = 'none'] = process.argv.slice(2);
import fs from 'fs';
const exe = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
await page.mouse.move(+w / 2, +h - 2);
await page.goto(`http://localhost:8765/index.html${query}`);
await page.waitForFunction(() => window.__splatdiffReady === true, null, { timeout: 180000 });
await page.waitForTimeout(6000);
if (['results', 'benchmark', 'how'].includes(action)) { await page.evaluate((a) => document.querySelector(`#nav button[data-page="${a}"]`).click(), action); await page.waitForTimeout(6000); }
if (action === 'scroll') { await page.evaluate(() => { document.querySelector('#nav button[data-page="benchmark"]').click(); }); await page.waitForTimeout(6000); await page.evaluate(() => { const c = document.querySelector('.page.active'); c.scrollTop = c.scrollHeight; [...document.querySelectorAll('.page.active *')].forEach((e) => { if (e.scrollHeight > e.clientHeight + 4) e.scrollTop = e.scrollHeight; }); }); await page.waitForTimeout(1500); }
if (action === 'mid') { await page.evaluate(() => document.querySelector('#nav button[data-page="benchmark"]').click()); await page.waitForTimeout(5000);
  console.log(await page.evaluate(() => [...document.querySelectorAll('#nav button')].map((b) => [b.textContent, b.getAttribute('aria-selected'), getComputedStyle(b).backgroundColor, b.getAnimations().map((a) => a.playState + ':' + a.currentTime).join()].join(' | ')).join('\n')));
  await page.evaluate(() => document.getElementById('chScale').scrollIntoView({ block: 'center' })); await page.waitForTimeout(1200); }
if (action === 'help') { await page.keyboard.press('?'); await page.waitForTimeout(400); }
if (action === 'present') { await page.evaluate(() => document.getElementById('app').classList.add('present')); await page.waitForTimeout(1200); }
await page.screenshot({ path: out, timeout: 120000 });
await browser.close();
