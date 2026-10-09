#!/usr/bin/env node
/** v3：用正确的行根选择器 div[data-index]，覆盖 顶部/中部/底部/滚动后 四行，
 *  同时断言「会话真的打开」+「抽屉折叠」。 */
const { chromium } = require('playwright')
const BASE = process.argv[2], TOKEN = process.argv[3]
const ORIGIN = new URL(BASE).origin
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.WEB_PROBE_CHROME ?? '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: { width: 402, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  await ctx.route(`${ORIGIN}/**`, r => r.continue({ headers: { ...r.request().headers(), 'X-Hermes-Session-Token': TOKEN } }))
  await ctx.addInitScript(() => { try { if (localStorage.getItem('hermes.desktop.interfaceMode.v1') === null) localStorage.setItem('hermes.desktop.interfaceMode.v1', 'simple') } catch {} })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)

  const st = () => page.evaluate(() => ({
    overlay: document.querySelector('[data-narrow-overlay]')?.getAttribute('data-narrow-overlay') ?? null,
    tab: (document.querySelector('[data-slot="pane-tab"][aria-selected="true"]')?.innerText || '').trim().slice(0, 18)
  }))
  const open = async () => {
    const b = await page.evaluate(() => { const e = document.querySelector('[data-titlebar-cluster="left"] button'); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
    await page.touchscreen.tap(b.x, b.y)
    await page.waitForTimeout(1100)
  }

  const test = async (label, frac) => {
    if ((await st()).overlay === null) await open()
    const pick = await page.evaluate(f => {
      const ov = document.querySelector('[data-narrow-overlay]')
      const o = ov.getBoundingClientRect()
      const rows = [...document.querySelectorAll('[data-index]')]
        .map(e => ({ e, r: e.getBoundingClientRect() }))
        .filter(x => x.r.height > 14 && x.r.top > o.top + 4 && x.r.bottom < o.bottom - 4 && x.r.left >= o.left && x.r.right <= o.right + 1)
        .sort((a, b) => a.r.top - b.r.top)
      if (!rows.length) return null
      const x = rows[Math.min(rows.length - 1, Math.floor(rows.length * f))]
      return { x: Math.round(x.r.left + 70), y: Math.round(x.r.top + x.r.height / 2), text: (x.e.innerText || '').split('\n')[0].slice(0, 18), n: rows.length }
    }, frac)
    if (!pick) { console.log(`  ${label}: 无可点行`); return }
    const before = (await st()).tab
    await page.touchscreen.tap(pick.x, pick.y)
    await page.waitForTimeout(2400)
    const after = await st()
    const opened = after.tab !== before
    console.log(`  ${label} 点「${pick.text}」y=${pick.y}（可见行 ${pick.n}）→ 会话 ${opened ? '✅已开「' + after.tab + '」' : '⚠ tab 未变(' + after.tab + ')'}｜抽屉 ${after.overlay === null ? '✅折叠' : '❌仍开(' + after.overlay + ')'}`)
  }

  await test('最顶行 ', 0)
  await test('中    部', 0.5)
  await test('最底行 ', 1)
  await page.evaluate(() => {
    const sc = [...document.querySelectorAll('[data-narrow-overlay] *')].find(e => e.scrollHeight > e.clientHeight + 40)
    if (sc) sc.scrollTop = sc.scrollHeight
  })
  await page.waitForTimeout(800)
  await test('滚到底 ', 1)
  await browser.close()
})().catch(e => { console.error(e); process.exit(2) })
