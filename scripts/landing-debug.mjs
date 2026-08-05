import { chromium } from 'playwright';
const BASE = 'http://localhost:3210';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message.slice(0, 200)}`));

await page.goto(BASE + '/');
await page.waitForTimeout(1000);
await page.evaluate(() => localStorage.setItem('of-has-account', '1'));
await page.goto(BASE + '/');
await page.waitForTimeout(6000);
const state = await page.evaluate(() => ({
  url: location.pathname,
  flag: localStorage.getItem('of-has-account'),
  hasAccountVar: !!window.__next_f
}));
await browser.close();
console.log(JSON.stringify({ state, logs: logs.slice(0, 30) }, null, 2));
