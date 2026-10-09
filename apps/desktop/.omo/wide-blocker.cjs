#!/usr/bin/env node
/** 宽屏停靠下，点不到的行到底被什么挡住（打印命中栈 + 归属哪一行）。 */
const { chromium } = require('playwright')
const BASE = process.argv[2], TOKEN = process.argv[3]
const ORIGIN = new URL(BASE).origin
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.WEB_PROBE_CHROME ?? '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  await ctx.route(`${ORIGIN}/**`, r => r.continue({ headers: { ...r.request().headers(), 'X-Hermes-Session-Token': TOKEN } }))
  await ctx.addInitScript(() => { try { if (localStorage.getItem('hermes.desktop.interfaceMode.v1') === null) localStorage.setItem('hermes.desktop.interfaceMode.v1', 'simple') } catch {} })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)
  const out = await page.evaluate(() => {
    const D = el => { const at = []; for (const a of el.attributes) if (a.name.startsWith('data-') || a.name === 'role') at.push(a.name + '=' + String(a.value).slice(0, 16)); const c = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join(' '); return el.tagName.toLowerCase() + (at.length ? '[' + at.join(' ') + ']' : '') + (c ? '.' + c : '') }
    const sb = document.querySelector('[data-slot=sidebar]')
    const box = sb.getBoundingClientRect()
    const rows = [...sb.querySelectorAll('[data-index]')].map(e => ({ e, r: e.getBoundingClientRect() }))
      .filter(x => x.r.height > 14 && x.r.top > box.top && x.r.bottom < box.bottom).sort((a, b) => a.r.top - b.r.top)
    const res = []
    for (const x of rows) {
      const cx = Math.round((x.r.left + x.r.right) / 2), cy = Math.round((x.r.top + x.r.bottom) / 2)
      const stack = document.elementsFromPoint(cx, cy)
      const top = stack[0]
      const ok = !!(top && top.closest('[data-index]') === x.e)
      const owner = top?.closest('[data-index]')
      res.push({ y: cy, x: cx, ok, top: top ? D(top) : 'null', owner: owner ? owner.getAttribute('data-index') : '—', me: x.e.getAttribute('data-index'), stack: stack.slice(0, 5).map(D) })
    }
    return { box: [Math.round(box.top), Math.round(box.bottom), Math.round(box.left), Math.round(box.right)], res }
  })
  console.log('sidebar box =', JSON.stringify(out.box))
  for (const r of out.res) {
    console.log(`\ny=${r.y} 行#${r.me} ${r.ok ? '✅' : '❌'}  命中归属=#${r.owner}`)
    console.log('   顶部元素: ' + r.top)
    r.stack.forEach((s, i) => console.log(`     ${i}. ${s}`))
  }
  await browser.close()
})().catch(e => { console.error(e); process.exit(2) })
