#!/usr/bin/env node
/**
 * 窄屏抽屉行为调查：点侧边栏 → 点会话行 → 抽屉有没有自动关闭？
 * 用法: node .omo/drawer-probe.cjs <baseUrl> <token>
 */
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
  await ctx.route(`${ORIGIN}/**`, route =>
    route.continue({ headers: { ...route.request().headers(), 'X-Hermes-Session-Token': TOKEN } })
  )
  await ctx.addInitScript(() => {
    try {
      if (window.localStorage.getItem('hermes.desktop.interfaceMode.v1') === null) {
        window.localStorage.setItem('hermes.desktop.interfaceMode.v1', 'simple')
      }
    } catch {}
  })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)

  const snap = async label => {
    const s = await page.evaluate(() => {
      const q = sel => document.querySelector(sel)
      const rect = el => (el ? (r => ({ t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }))(el.getBoundingClientRect()) : null)
      const sheet = q('[role="dialog"], [data-slot="sheet-content"], [data-state="open"][role="dialog"]')
      const overlay = [...document.querySelectorAll('*')].find(el => {
        const c = getComputedStyle(el)
        return c.position === 'fixed' && parseFloat(c.zIndex || 0) >= 30 && el.getBoundingClientRect().width >= innerWidth - 2 && el.getBoundingClientRect().height >= innerHeight - 2 && c.backgroundColor !== 'rgba(0, 0, 0, 0)'
      })
      return {
        dialog: sheet ? { el: sheet.tagName + (sheet.getAttribute('data-slot') || ''), rect: rect(sheet) } : null,
        overlay: overlay ? rect(overlay) : null,
        activeEl: document.activeElement?.tagName,
        sessionRows: document.querySelectorAll('[data-session-id],[data-slot="session-row"]').length
      }
    })
    console.log(`\n[${label}] dialog=${JSON.stringify(s.dialog)} overlay=${JSON.stringify(s.overlay)} rows=${s.sessionRows}`)
    return s
  }

  await snap('初始')

  // 打开抽屉：点心侧的侧边栏按钮
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('[data-titlebar-cluster] button, [data-slot="tooltip-trigger"] button')
    if (btn) { btn.click(); return btn.getAttribute('aria-label') || 'clicked' }
    return '未找到按钮'
  })
  console.log('点侧边栏按钮:', opened)
  await page.waitForTimeout(1200)
  await snap('抽屉打开后')

  // 点第一个会话行
  const rowInfo = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-session-id]')]
    if (!rows.length) return '没有会话行'
    const r = rows[0]
    const before = { id: r.getAttribute('data-session-id'), text: (r.innerText || '').slice(0, 30) }
    r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    r.click()
    return JSON.stringify(before)
  })
  console.log('点会话行:', rowInfo)
  await page.waitForTimeout(2500)
  await snap('选会话之后')

  await browser.close()
})().catch(e => { console.error('故障:', e); process.exit(2) })
