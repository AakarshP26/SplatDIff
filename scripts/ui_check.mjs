// Interaction check of the viewer in one browser session. Server on :8765 serving web/.
// Usage: node scripts/ui_check.mjs <outdir> [width] [height]
import { chromium } from 'playwright-core';
import fs from 'fs';
const [dir = '.', w = '1280', h = '720'] = process.argv.slice(2);
const exe = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (n) => { await page.waitForTimeout(2500); await page.screenshot({ path: `${dir}/${n}.png`, timeout: 120000 }); console.log('shot', n); };
const ok = (name, c) => console.log(c ? 'PASS' : 'FAIL', name);
const idle = () => page.waitForFunction(() => document.getElementById('loading').classList.contains('hide'), null, { timeout: 120000 });
await page.goto('http://localhost:8765/index.html?scene=biker&case=delete');
await page.waitForFunction(() => window.__splatdiffReady === true, null, { timeout: 180000 });
await shot('v_biker_delete');
const wipeL = () => page.evaluate(() => parseFloat(document.getElementById('wipe').style.left));
const before = await wipeL();
const box = await page.locator('#wipe .knob').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
await page.mouse.move(box.x - 200, box.y + 20, { steps: 5 }); await page.mouse.up();
ok('wipe drag', (await wipeL()) < before - 5);
await page.keyboard.press('?'); await shot('v_help'); await page.keyboard.press('Escape');
await page.evaluate(() => document.querySelector('#ovStyle [data-style=heat]').click()); await shot('v_heat');
await page.evaluate(() => { document.querySelector('#ovStyle [data-style=solid]').click(); document.getElementById('onlyChanges').click(); }); await shot('v_only');
await page.evaluate(() => document.getElementById('onlyChanges').click());
await page.keyboard.press('5'); await page.waitForTimeout(600); await idle(); await shot('v_biker_copy');
await page.keyboard.press('Space'); await page.waitForTimeout(500);
ok('auto-rotate on', await page.evaluate(() => document.getElementById('btnRotate').getAttribute('aria-pressed') === 'true'));
await page.keyboard.press('Space');
// Fullscreen hangs headless screenshots, so presentation layout is checked via its class only.
await page.evaluate(() => document.getElementById('app').classList.add('present')); await page.waitForTimeout(800);
await shot('v_present');
console.log('console errors:', errors.length, errors.slice(0, 5));
await browser.close();
