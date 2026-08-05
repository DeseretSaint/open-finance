import { chromium } from 'playwright';
const BASE = 'http://localhost:3210';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// Simulate: user already signed up before (flag present), no session
await page.goto(BASE + '/');
await page.waitForTimeout(500);
await page.evaluate(() => localStorage.setItem('of-has-account', '1'));
await page.goto(BASE + '/');
// Wait for client-side router.replace to fire
await page.waitForURL('**/login', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1000);
const returning = { finalUrl: page.url(), isLogin: page.url().includes('/login') };

// Also verify fresh (no flag) still shows create account
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p2 = await ctx2.newPage();
await p2.goto(BASE + '/');
await p2.waitForTimeout(3000);
const fresh = { finalUrl: p2.url(), text: (await p2.locator('body').innerText()).slice(0, 100) };

await browser.close();
console.log(JSON.stringify({ returning, fresh }, null, 2));
