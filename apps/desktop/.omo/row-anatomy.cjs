#!/usr/bin/env node
/** 摸清会话行的真实根元素：打印 [data-row-actions] 的祖先链（tag/class/rect/display）。 */
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
    const D = el => { const at = []; for (const a of el.attributes) if (a.name.startsWith('data-') || a.name === 'role') at.push(a.name + '=' + String(a.value).slice(0, 18)); const c = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join(' '); return el.tagName.toLowerCase() + (at.length ? '[' + at.join(' ') + ']' : '') + (c ? '.' + c : '') }
    const R = el => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)] }
    const hs = [...document.querySelectorAll('[data-row-actions]')]
    const target = hs[hs.length - 1]
    const chain = []
    for (let e = target; e && chain.length < 6; e = e.parentElement) chain.push({ el: D(e), rect: R(e), pe: getComputedStyle(e).pointerEvents, pos: getComputedStyle(e).position })
    // 行内可点区域的真实命中测试（逐 y 扫）
    const rows = [...document.querySelectorAll('[data-index]')].map(e => ({ el: D(e), rect: R(e), idx: e.getAttribute('data-index') }))
    const hit = []
    for (let y = 740; y <= 800; y += 6) {
      const top = document.elementsFromPoint(80, y)[0]
      hit.push(y + ':' + (top ? D(top) : 'null'))
    }
    return { chain, rows: rows.slice(-4), hit }
  })
  console.log(JSON.stringify(out, null, 1))
  await browser.close()
})().catch(e => { console.error(e); process.exit(2) })
