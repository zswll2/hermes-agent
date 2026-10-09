#!/usr/bin/env node
/** 抽屉 v2：开抽屉后打印覆盖层归属，再用真实鼠标点会话行，看是否折叠。 */
const { chromium } = require('playwright')
const BASE = process.argv[2]
const TOKEN = process.argv[3]
const ORIGIN = new URL(BASE).origin

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.WEB_PROBE_CHROME ?? '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  await ctx.route(`${ORIGIN}/**`, route => route.continue({ headers: { ...route.request().headers(), 'X-Hermes-Session-Token': TOKEN } }))
  await ctx.addInitScript(() => {
    try { if (localStorage.getItem('hermes.desktop.interfaceMode.v1') === null) localStorage.setItem('hermes.desktop.interfaceMode.v1', 'simple') } catch {}
  })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)

  const state = async label => {
    const s = await page.evaluate(() => {
      const ov = document.querySelector('[data-narrow-overlay]')
      const sb = document.querySelector('[data-narrow-overlay] [data-slot="sidebar"], [data-slot="sidebar"]')
      const R = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) } }
      const chain = []
      for (let e = sb; e && e !== document.body; e = e.parentElement) {
        const at = []
        for (const a of e.attributes) if (a.name.startsWith('data-')) at.push(a.name + '=' + String(a.value).slice(0, 22))
        chain.push(e.tagName.toLowerCase() + (at.length ? '[' + at.join(' ') + ']' : ''))
      }
      return { overlay: ov ? ov.getAttribute('data-narrow-overlay') : null, sidebar: R(sb), chain: chain.slice(0, 8), tabText: (document.querySelector('[data-narrow-overlay-tab]') || {}).innerText }
    })
    console.log(`[${label}] overlay=${s.overlay} sidebar=${JSON.stringify(s.sidebar)} tab=${JSON.stringify(s.tabText || '')}`)
    if (s.chain.length) console.log('   链: ' + s.chain.join(' > '))
    return s
  }

  await state('初始')
  const btn = await page.$('[data-titlebar-cluster="left"] button')
  if (btn) await btn.click()
  await page.waitForTimeout(1200)
  await state('开抽屉后')

  // 真实鼠标点会话行中心
  const target = await page.evaluate(() => {
    const h = document.querySelector('[data-row-actions]')
    const row = h && h.closest('div[class*="group"]')
    if (!row) return null
    const b = row.getBoundingClientRect()
    return { x: Math.round(b.left + 60), y: Math.round(b.top + b.height / 2), text: (row.innerText || '').slice(0, 20).replace(/\n/g, ' ') }
  })
  console.log('目标行:', JSON.stringify(target))
  if (target) { await page.mouse.click(target.x, target.y); }
  await page.waitForTimeout(2500)
  await state('点会话行后')

  await browser.close()
})().catch(e => { console.error('故障:', e); process.exit(2) })
