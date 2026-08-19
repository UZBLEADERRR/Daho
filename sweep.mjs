import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];
for (const vp of [{ width: 390, height: 844, name: 'mobil' }]) {
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(`${vp.name} pageerror: ${e.message}`));
  p.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('ERR_CONNECTION') && !t.includes('Failed to load resource')) errs.push(`${vp.name} console: ${t}`);
  });
  await p.goto('http://localhost:4179/', { waitUntil: 'networkidle' });
  await p.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('daho'); });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.keyboard.press('Escape');
  await p.locator('.modal-scrim .icon-btn, [aria-label="Yopish"]').first().click().catch(() => {});
  await p.waitForTimeout(400);

  // Yon paneldagi hamma boʻlim
  if (vp.name === 'mobil') {
    await p.locator('[aria-label="Menyu"], .topbar .icon-btn').first().click().catch(() => {});
    await p.waitForTimeout(300);
  }
  const labels = await p.locator('.side-link').allInnerTexts();
  const links = labels;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i].replace(/\s+/g, ' ').trim();
    if (/Sozlamalar/.test(label)) continue;
    const link = p.locator('.side-link').nth(i);
    if (!(await link.isVisible().catch(() => false))) {
      errs.push(`${vp.name}: «${label}» yon panelda koʻrinmayapti`);
      await p.screenshot({ path: `/tmp/claude-0/-home-user-Daho/b4c8d94a-9a73-57c5-bc84-7fe0a1c1985e/scratchpad/stuck.png` });
      break;
    }
    await link.click({ timeout: 4000 }).catch((e) => errs.push(`${vp.name}: «${label}» — ${String(e).split('\n').slice(0,4).join(' | ')}`));
    await p.waitForTimeout(450);
    const h = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (h) errs.push(`${vp.name}: «${label}» gorizontal siljish`);
    if (vp.name === 'mobil') {
      // Toʻliq ekranli oyna ochilgan boʻlsa avval orqaga qaytamiz
      const back = p.locator('.viewer [aria-label="Orqaga"], .viewer [aria-label="Yopish"]').first();
      if (await back.isVisible().catch(() => false)) { await back.click(); await p.waitForTimeout(300); }
      await p.locator('[aria-label="Menyu"], .topbar .icon-btn').first().click().catch(() => {});
      await p.waitForTimeout(250);
    }
  }
  results.push({ vp: vp.name, links: links.length, errs });
  await ctx.close();
}
for (const r of results) console.log(r.vp, '| boʻlimlar:', r.links, '| xatolar:', r.errs.length ? r.errs : 'yoʻq');
await b.close();
