#!/usr/bin/env node
/** 为什么抽屉下半部分的行点不动：逐点 dump 命中栈 + pointer-events。 */
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
  await page.waitForTimeout(1200)

  const out = await page.evaluate(() => {
    const D = el => { const at = []; for (const a of el.attributes) if (a.name.startsWith('data-') || a.name === 'role') at.push(a.name + '=' + String(a.value).slice(0, 16)); const c = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join(' '); return el.tagName.toLowerCase() + (at.length ? '[' + at.join(' ') + ']' : '') + (c ? '.' + c : '') }
    const res = []
    for (const y of [546, 620, 676, 738, 780]) {
      const stack = document.elementsFromPoint(80, y).slice(0, 8).map(e => D(e) + ' pe=' + getComputedStyle(e).pointerEvents + ' z=' + getComputedStyle(e).zIndex)
      const row = document.elementsFromPoint(80, y).find(e => e.closest('[data-index]'))?.closest('[data-index]')
      res.push({ y, row: row ? D(row) + ' rect=' + JSON.stringify([Math.round(row.getBoundingClientRect().top), Math.round(row.getBoundingClientRect().bottom)]) : '无行元素命中', stack })
    }
    // 抽屉内下部的绝对/固定层
    const ov = document.querySelector('[data-narrow-overlay]')
    const layer = [...ov.querySelectorAll('*')].map(e => ({ e, c: getComputedStyle(e), r: e.getBoundingClientRect() }))
      .filter(o => (o.c.position === 'absolute' || o.c.position === 'fixed' || o.c.position === 'sticky') && o.r.height > 20 && o.r.bottom > 560)
      .map(o => ({ el: D(o.e), pos: o.c.position, z: o.c.zIndex, pe: o.c.pointerEvents, rect: [Math.round(o.r.top), Math.round(o.r.bottom)] }))
    return { res, layer: layer.slice(0, 10) }
  })
  for (const r of out.res) {
    console.log(`\ny=${r.y}  命中行: ${r.row}`)
    for (const s of r.stack) console.log('    ' + s)
  }
  console.log('\n=== 抽屉内下部定位层 ===')
  for (const l of out.layer) console.log('  ' + JSON.stringify(l))
  await browser.close()
})().catch(e => { console.error(e); process.exit(2) })
