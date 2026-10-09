#!/usr/bin/env node
/** 触摸路径验证：用真实 touch 事件开抽屉 + 点会话行，看抽屉是否折叠、会话是否真的打开了。 */
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
  const ctx = await browser.newContext({ viewport: { width: 402, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  await ctx.route(`${ORIGIN}/**`, route => route.continue({ headers: { ...route.request().headers(), 'X-Hermes-Session-Token': TOKEN } }))
  await ctx.addInitScript(() => {
    try { if (localStorage.getItem('hermes.desktop.interfaceMode.v1') === null) localStorage.setItem('hermes.desktop.interfaceMode.v1', 'simple') } catch {}
  })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)

  const snap = async label => {
    const s = await page.evaluate(() => {
      const ov = document.querySelector('[data-narrow-overlay]')
      const active = document.querySelector('[data-slot="pane-tab"][aria-selected="true"], [data-slot="pane-tab"]')
      const sel = document.querySelector('[data-row-actions]')?.closest('div[class*="group"]')
      return {
        overlay: ov ? ov.getAttribute('data-narrow-overlay') : null,
        tab: (active?.innerText || '').slice(0, 22),
        rows: document.querySelectorAll('[data-row-actions]').length,
        selRow: (sel?.innerText || '').slice(0, 18).replace(/\n/g, ' ')
      }
    })
    console.log(`[${label}] overlay=${s.overlay} tab=${JSON.stringify(s.tab)} rows=${s.rows}`)
    return s
  }

  const touchTap = async (x, y) => {
    await page.touchscreen.tap(x, y)
  }

  await snap('初始')

  // 用触摸点标题栏左侧按钮
  const btn = await page.evaluate(() => {
    const b = document.querySelector('[data-titlebar-cluster="left"] button')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: b.getAttribute('aria-label') }
  })
  console.log('标题栏按钮:', JSON.stringify(btn))
  if (btn) await touchTap(btn.x, btn.y)
  await page.waitForTimeout(1200)
  await snap('触摸开抽屉')

  // 用触摸点一个会话行（取行容器中心）
  const row = await page.evaluate(() => {
    const h = document.querySelector('[data-row-actions]')
    const r0 = h && h.closest('div[class*="group"]')
    if (!r0) return null
    const b = r0.getBoundingClientRect()
    return { x: Math.round(b.left + 70), y: Math.round(b.top + b.height / 2), text: (r0.innerText || '').slice(0, 18).replace(/\n/g, ' ') }
  })
  console.log('目标行:', JSON.stringify(row))
  if (row) await touchTap(row.x, row.y)
  await page.waitForTimeout(2500)
  await snap('触摸点会话行后')
  await page.waitForTimeout(2500)
  await snap('再过 2.5s')

  // 键盘/焦点放大检查：输入框字号
  const fs = await page.evaluate(() => {
    const el = document.querySelector('[data-slot="composer-rich-input"], textarea, [contenteditable="true"]')
    if (!el) return '未找到输入框'
    const c = getComputedStyle(el)
    return { tag: el.tagName, slot: el.getAttribute('data-slot'), fontSize: c.fontSize, zoomable: document.querySelector('meta[name=viewport]')?.getAttribute('content') }
  })
  console.log('输入框:', JSON.stringify(fs))

  await browser.close()
})().catch(e => { console.error('故障:', e); process.exit(2) })
