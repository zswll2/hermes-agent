#!/usr/bin/env node
/** 量化：抽屉里可见的行，有多少是"点得到"的（命中测试落在行内）。 */
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
  const b = await page.evaluate(() => { const e = document.querySelector('[data-titlebar-cluster="left"] button'); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
  await page.touchscreen.tap(b.x, b.y)
  await page.waitForTimeout(3000)   // 给虚拟列表充分时间

  const scan = async tag => {
    const r = await page.evaluate(() => {
      const ov = document.querySelector('[data-narrow-overlay]')
      const o = ov.getBoundingClientRect()
      const rows = [...document.querySelectorAll('[data-index]')]
        .map(e => ({ e, r: e.getBoundingClientRect() }))
        .filter(x => x.r.height > 14 && x.r.top > o.top && x.r.bottom < o.bottom)
        .sort((a, b) => a.r.top - b.r.top)
      const detail = rows.map(x => {
        const cx = Math.round((x.r.left + x.r.right) / 2), cy = Math.round((x.r.top + x.r.bottom) / 2)
        const top = document.elementsFromPoint(cx, cy)[0]
        const inside = !!(top && top.closest('[data-index]') === x.e)
        const blocker = inside ? '' : top ? top.tagName.toLowerCase() + (top.getAttribute('data-sidebar') || top.getAttribute('data-slot') || (top.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.')) : 'null'
        return { i: x.e.getAttribute('data-index'), y: cy, ok: inside, blocker }
      })
      return { total: rows.length, ok: detail.filter(d => d.ok).length, bad: detail.filter(d => !d.ok) }
    })
    console.log(`[${tag}] 可见行 ${r.total}，点得到 ${r.ok}，点不到 ${r.bad.length}`)
    if (r.bad.length) console.log('   点不到的行: ' + r.bad.map(d => `y=${d.y}(被 ${d.blocker} 挡住)`).join('  '))
    return r
  }

  await scan('打开后 3s')
  await page.evaluate(() => {
    const sc = [...document.querySelectorAll('[data-narrow-overlay] *')].find(e => e.scrollHeight > e.clientHeight + 40)
    if (sc) sc.scrollTop = sc.scrollTop + 40
  })
  await page.waitForTimeout(1200)
  await scan('轻微滚动后')
  await browser.close()
})().catch(e => { console.error(e); process.exit(2) })
