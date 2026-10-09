#!/usr/bin/env node
/** 验证本轮四条：① 布局按钮消失 ② 会话拖拽被禁用 ③ 抽屉下移 ④ 终端 tab 规则已注入 */
const { chromium } = require('playwright')
const BASE = process.argv[2], TOKEN = process.argv[3]
const ORIGIN = new URL(BASE).origin

const cdpSession = async (page) => await page.context().newCDPSession(page)

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.WEB_PROBE_CHROME ?? '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const ctx = await browser.newContext({ viewport: { width: 402, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  await ctx.route(`${ORIGIN}/**`, r => r.continue({ headers: { ...r.request().headers(), 'X-Hermes-Session-Token': TOKEN } }))
  await ctx.addInitScript(() => { try { if (localStorage.getItem('hermes.desktop.interfaceMode.v1') === null) localStorage.setItem('hermes.desktop.interfaceMode.v1', 'simple') } catch {} })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)

  // ① 标题栏右侧按钮
  const btns = await page.evaluate(() => {
    const r = document.querySelector('[data-titlebar-cluster="right"]')
    const l = document.querySelector('[data-titlebar-cluster="left"]')
    const one = c => c ? [...c.querySelectorAll('button')].map(b => ({ label: b.getAttribute('aria-label'), icons: [...b.querySelectorAll('i,span')].map(i => i.className).filter(x => /codicon-/.test(x)).join('|'), vis: b.getBoundingClientRect().width > 0 })) : []
    return { right: one(r), left: one(l) }
  })
  console.log('右侧按钮:', JSON.stringify(btns.right))
  console.log('左侧按钮:', JSON.stringify(btns.left))

  // ② 抽屉下移 + 行序（拖拽前后）
  const openBtn = await page.evaluate(() => { const e = document.querySelector('[data-titlebar-cluster="left"] button'); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
  await page.touchscreen.tap(openBtn.x, openBtn.y)
  await page.waitForTimeout(1500)
  const before = await page.evaluate(() => {
    const ov = document.querySelector('[data-narrow-overlay]')
    const rows = [...document.querySelectorAll('[data-index]')].map(e => (e.innerText || '').split('\n')[0].slice(0, 14))
    return { ovTop: Math.round(ov.getBoundingClientRect().top), ovBottom: Math.round(ov.getBoundingClientRect().bottom), order: rows.slice(0, 5) }
  })
  console.log('抽屉 rect top/bottom =', before.ovTop, before.ovBottom, '（下移后 top 应 = 安全区 + 12）')

  // 真实触摸拖拽第一行
  const row = await page.evaluate(() => {
    const e = [...document.querySelectorAll('[data-index]')].map(x => ({ x, r: x.getBoundingClientRect() })).filter(o => o.r.height > 14 && o.r.top > 100).sort((a, b) => a.r.top - b.r.top)[0]
    return { x: Math.round((row_x => row_x)((row_box => Math.round((row_box.left + row_box.right) / 2))(e.r))), y: Math.round((e.r.top + e.r.bottom) / 2), text: (e.x.innerText || '').split('\n')[0].slice(0, 14) }
  })
  const cdp = await cdpSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: row.x, y: row.y }] })
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: row.x, y: row.y + i * 12 }] })
    await page.waitForTimeout(30)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(1500)
  const after = await page.evaluate(() => ({ order: [...document.querySelectorAll('[data-index]')].map(e => (e.innerText || '').split('\n')[0].slice(0, 14)).slice(0, 5), dragged: document.querySelectorAll('[data-dnd-dragging],[aria-pressed=true][data-reorder-handle]').length }))
  console.log('拖拽目标行:', row.text, ' y=', row.y)
  console.log('拖前前 5 行:', JSON.stringify(before.order))
  console.log('拖后前 5 行:', JSON.stringify(after.order), '→', JSON.stringify(before.order) === JSON.stringify(after.order) ? '✅ 顺序未变（拖拽已禁用）' : '❌ 顺序变了（拖拽仍在生效）')

  // ④ CSS 规则
  const css = await page.evaluate(() => [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText) } catch { return [] } }).filter(t => /narrow-overlay-tab|codicon-layout|margin-top: 12px|margin-top:12px/.test(t)).slice(0, 5))
  console.log('注入的规则:', JSON.stringify(css, null, 1))

  await browser.close()
})().catch(e => { console.error(e); process.exit(2) })
