#!/usr/bin/env node
/** 抽屉底部那一行为什么点不动：看该点上的元素栈。 */
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
  const b = await page.evaluate(() => { const el = document.querySelector('[data-titlebar-cluster="left"] button'); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
  await page.touchscreen.tap(b.x, b.y)
  await page.waitForTimeout(1200)

  const out = await page.evaluate(() => {
    const d = el => { const at = []; for (const a of el.attributes) if (a.name.startsWith('data-') || a.name === 'role' || a.name === 'aria-label') at.push(a.name + '=' + String(a.value).slice(0, 20)); const c = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 4).join(' '); return el.tagName.toLowerCase() + (at.length ? '[' + at.join(' ') + ']' : '') + (c ? '.' + c : '') }
    const ov = document.querySelector('[data-narrow-overlay]')
    const or_ = ov.getBoundingClientRect()
    const rows = [...document.querySelectorAll('[data-row-actions]')].map(h => h.closest('div[class*="group"]') || h.parentElement)
    const last = rows.map(r => r.getBoundingClientRect()).filter(r => r.bottom <= or_.bottom + 1).sort((a, b) => b.bottom - a.bottom)[0]
    const probeY = last ? Math.round(last.top + last.height / 2) : Math.round(or_.bottom - 20)
    const stack = document.elementsFromPoint(80, probeY).slice(0, 6).map(d)
    // 抽屉底部有什么固定/绝对定位的东西
    const bottomers = [...ov.querySelectorAll('*')].map(e => ({ e, c: getComputedStyle(e), r: e.getBoundingClientRect() }))
      .filter(o => (o.c.position === 'sticky' || o.c.position === 'fixed' || o.c.position === 'absolute') && o.r.bottom > or_.bottom - 90 && o.r.height > 8)
      .slice(0, 6).map(o => ({ el: d(o.e), pos: o.c.position, z: o.c.zIndex, rect: [Math.round(o.r.top), Math.round(o.r.bottom)] }))
    return { ovRect: [Math.round(or_.top), Math.round(or_.bottom)], lastRow: last ? [Math.round(last.top), Math.round(last.bottom)] : null, probeY, stack, bottomers }
  })
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
})().catch(e => { console.error(e); process.exit(2) })
