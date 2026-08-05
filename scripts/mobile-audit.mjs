// Temporary mobile audit script — real 390x844 viewport (Chromium).
import { chromium } from 'playwright';

const BASE = 'http://localhost:3210';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// login
await page.goto(BASE + '/login');
await page.waitForTimeout(1500);
await page.fill('#login-username', 'fabtest');
await page.fill('#login-password', 'fabtest-pass-1');
await page.click('button[type=submit]');
await page.waitForTimeout(2000);

const results = {};

async function auditScroll(name) {
  await page.goto(BASE + '/' + name);
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const clientW = doc.clientWidth;
    const scrollW = Math.max(doc.scrollWidth, body.scrollWidth);
    const wide = [];
    document.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > clientW + 2) {
        wide.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), w: Math.round(r.width), right: Math.round(r.right) });
      }
    });
    wide.sort((a, b) => b.w - a.w);
    // FAB
    const fab = Array.from(document.body.children).find(el => el.tagName === 'BUTTON' && el.getAttribute('aria-label'));
    const bar = document.getElementById('of-tab-bar');
    const grid = document.querySelector('main .grid');
    return {
      clientW, scrollW,
      hasHScroll: scrollW > clientW + 2,
      tabBarVisible: bar ? bar.offsetWidth > 0 : false,
      tabBarH: bar ? bar.offsetHeight : 0,
      fabBottomPx: fab ? fab.style.bottom : null,
      fabRectTop: fab ? Math.round(fab.getBoundingClientRect().top) : null,
      fabParent: fab ? fab.parentElement.tagName : null,
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.slice(0, 120) : 'none',
      gridChildCount: grid ? grid.children.length : 0,
      widest: wide.slice(0, 6)
    };
  });
  results[name] = info;
}

await auditScroll('accounts');
await auditScroll('transactions');
await auditScroll('budgets');
await auditScroll('dashboard');

await browser.close();
console.log(JSON.stringify(results, null, 2));
