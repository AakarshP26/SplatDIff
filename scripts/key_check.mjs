// Keyboard shortcut check: 1-5, O, R, space, P, ?. Server on :8765 serving web/.
// Usage: node scripts/key_check.mjs <outdir> [scene] [width] [height]
import { chromium } from 'playwright-core';
import fs from 'fs';
const [dir = '.', scene = 'guitar', w = '1280', h = '720'] = process.argv.slice(2);
const exe = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
// Real fullscreen blocks headless screenshots, so it is stubbed; the layout class is still toggled.
await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.resolve(); });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
let fails = 0;
const ok = (name, c) => { console.log(c ? 'PASS' : 'FAIL', name); if (!c) fails++; };
const idle = () => page.waitForFunction(() => document.getElementById('loading').classList.contains('hide'), null, { timeout: 180000 });
const caseParam = () => page.evaluate(() => new URL(location).searchParams.get('case'));
const toastText = () => page.evaluate(() => document.getElementById('toast').textContent);
const pressed = (sel) => page.evaluate((s) => document.querySelector(s)?.getAttribute('aria-pressed'), sel);

await page.goto(`http://localhost:8765/index.html?scene=${scene}&case=reparam`);
await page.waitForFunction(() => window.__splatdiffReady === true, null, { timeout: 180000 });
const ids = await page.evaluate(() => [...document.querySelectorAll('#cases button')].map((b) => b.textContent));
for (let k = 1; k <= ids.length; k++) {
  await page.keyboard.press(String(k)); await page.waitForTimeout(400); await idle();
  ok(`key ${k} selects case ${k} (${ids[k - 1]})`, (await pressed(`#cases button:nth-child(${k})`)) === 'true');
  await page.screenshot({ path: `${dir}/k_${scene}_${k}.png`, timeout: 120000 });
}
await page.keyboard.press('o'); await page.waitForTimeout(200);
ok('O turns overlay off', (await toastText()) === 'Overlay off');
await page.keyboard.press('o'); await page.waitForTimeout(200);
ok('O turns overlay on', (await toastText()) === 'Overlay on');
await page.evaluate(() => document.querySelector('#camSeg [data-cam=top]').click()); await page.waitForTimeout(300);
await page.keyboard.press('r'); await page.waitForTimeout(300);
ok('R resets camera preset', (await pressed('#camSeg [data-cam=top]')) === 'false');
await page.keyboard.press('Space'); await page.waitForTimeout(200);
ok('space starts auto-rotate', (await pressed('#btnRotate')) === 'true');
await page.keyboard.press('Space'); await page.waitForTimeout(200);
ok('space stops auto-rotate', (await pressed('#btnRotate')) === 'false');
await page.keyboard.press('?'); await page.waitForTimeout(300);
ok('? opens help', await page.evaluate(() => document.getElementById('help').classList.contains('open')));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('Escape closes help', !(await page.evaluate(() => document.getElementById('help').classList.contains('open'))));
await page.keyboard.press('p'); await page.waitForTimeout(1500);
ok('P enters presentation mode', await page.evaluate(() => document.getElementById('app').classList.contains('present')));
await page.screenshot({ path: `${dir}/k_${scene}_present.png`, timeout: 120000 });
await page.keyboard.press('p'); await page.waitForTimeout(500);
ok('P leaves presentation mode', !(await page.evaluate(() => document.getElementById('app').classList.contains('present'))));
ok('no console errors', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 5));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await browser.close();
process.exit(fails ? 1 : 0);
