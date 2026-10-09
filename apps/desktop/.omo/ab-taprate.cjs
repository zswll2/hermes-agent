#!/usr/bin/env node
/** 对照：窄屏（覆盖层）vs 宽屏（停靠）下，会话行的可点率 + 行是否重叠。 */
const { chromium } = require('playwright')
const BASE = process.argv[2], TOKEN = process.argv[3]
const ORIGIN = new URL(BASE).origin

async function run(browser, width, height, label) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700, deviceScaleFactor: width < 700 ? 3 : 1 })
  await ctx.route(`${ORIGIN}/**`, r => r.continue({ headers: { ...r.request().headers(), 'X-Hermes-Session-Token': TOKEN } }))
  await ctx.addInitScript(() => { try { if (localStorage.getItem('hermes.desktop.interfaceMode.v1') === null) localStorage.setItem('hermes.desktop.interfaceMode.v1', 'simple') } catch {} })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)
  if (width < 700) {
    const b = await page.evaluate(() => { const e = document.querySelector('[data-titlebar-cluster="left"] button'); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
    await page.touchscreen.tap(b.x, b.y)
    await page.waitForTimeout(2500)
  }
  const r = await page.evaluate(() => {
    const scopes = ['[data-narrow-overlay]', '[data-slot=sidebar]'].map(s => document.querySelector(s)).filter(Boolean)
    const sc = scopes[0]
    const box = sc.getBoundingClientRect()
    const rows = [...sc.querySelectorAll('[data-index]')].map(e => ({ e, r: e.getBoundingClientRect() }))
      .filter(x => x.r.height > 14 && x.r.top > box.top && x.r.bottom < box.bottom).sort((a, b) => a.r.top - b.r.top)
    let overlap = 0
    for (let i = 1; i < rows.length; i++) if (rows[i].r.top < rows[i - 1].r.bottom - 2) overlap++
    let ok = 0
    const misses = []
    for (const x of rows) {
      const cx = Math.round((x.r.left + x.r.right) / 2), cy = Math.round((x.r.top + x.r.bottom) / 2)
      const t = document.elementsFromPoint(cx, cy)[0]
      if (t && t.closest('[data-index]') === x.e) ok++
      else misses.push(cy)
    }
    return { visible: rows.length, ok, overlap, misses: misses.slice(0, 8), container: [...sc.querySelectorAll('*')].length }
  })
  console.log(`[${label}] 可见行 ${r.visible}｜可点 ${r.ok}｜行与行重叠 ${r.overlap} 处｜点不到的行 y=${r.misses.join(',') || '无'}`)
  await ctx.close()
}

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.WEB_PROBE_CHROME ?? '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  await run(browser, 402, 812, '窄屏 覆盖层')
  await run(browser, 1200, 800, '宽屏 停靠  ')
  await browser.close()
})().catch(e => { console.error(e); process.exit(2) })
