import { chromium } from 'playwright';
const BASE = 'http://localhost:3210';
const browser = await chromium.launch();

// Case 1: fresh browser, never signed up → landing shows "Create an account"
const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p1 = await ctx1.newPage();
await p1.goto(BASE + '/');
await p1.waitForTimeout(3000);
const fresh = { url: p1.url(), text: (await p1.locator('body').innerText()).slice(0, 150) };

// Case 2: user registers → then returns to landing later → must go to /login
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p2 = await ctx2.newPage();
await p2.goto(BASE + '/register');
await p2.waitForTimeout(1500);
await p2.fill('#reg-display', 'Landing Test');
await p2.fill('#reg-username', 'landingtest');
await p2.fill('#reg-password', 'landing-pass-1');
await p2.click('button[type=submit]');
await p2.waitForTimeout(2000);
const afterRegister = p2.url();
const flag = await p2.evaluate(() => localStorage.getItem('of-has-account'));
// simulate "later" visit: clear session (log out), revisit landing
await p2.goto(BASE + '/api/auth/logout', { waitUntil: 'commit' }).catch(() => {});
await p2.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-of-request': '1' } }); }).catch(() => {});
await p2.goto(BASE + '/');
await p2.waitForTimeout(2500);
const returning = { url: p2.url(), final: p2.url().includes('/login') };

await browser.close();
console.log(JSON.stringify({ fresh, afterRegister, flag, returning }, null, 2));
