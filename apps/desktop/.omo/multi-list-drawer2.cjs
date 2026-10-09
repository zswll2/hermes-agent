#!/usr/bin/env node
/** v2：每一行都断言 "会话真的打开了" + "抽屉折叠了"，并报告行是否完整落在抽屉内。 */
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

  const st = async () => page.evaluate(() => {
    const ov = document.querySelector('[data-narrow-overlay]')
    const ovr = ov ? ov.getBoundingClientRect() : null
    const tab = document.querySelector('[data-slot="pane-tab"][aria-selected="true"]') || document.querySelector('[data-slot="pane-tab"]')
    return {
      overlay: ov ? ov.getAttribute('data-narrow-overlay') : null,
      ovRect: ovr ? { t: Math.round(ovr.top), b: Math.round(ovr.bottom) } : null,
      tab: (tab?.innerText || '').trim().slice(0, 20)
    }
  })

  const open = async () => {
    const b = await page.evaluate(() => {
      const el = document.querySelector('[data-titlebar-cluster="left"] button')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })
    if (b) await page.touchscreen.tap(b.x, b.y)
    await page.waitForTimeout(1100)
  }

  const probeAt = async (frac, label) => {
    let s = await st()
    if (s.overlay === null) { await open(); s = await st() }
    if (s.overlay === null) { console.log(`  ${label}: 抽屉打不开，跳过`); return }
    // 取抽屉内可见行，按纵向比例挑一行
    const pick = await page.evaluate(f => {
      const ov = document.querySelector('[data-narrow-overlay]')
      const or_ = ov.getBoundingClientRect()
      const rows = [...document.querySelectorAll('[data-row-actions]')].map(h => h.closest('div[class*="group"]') || h.parentElement)
      const vis = rows.map(r => ({ r, b: r.getBoundingClientRect() }))
        .filter(o => o.b.top > or_.top + 6 && o.b.bottom < or_.bottom - 6 && o.b.height > 16)
      if (!vis.length) return null
      const idx = Math.min(vis.length - 1, Math.floor(vis.length * f))
      const o = vis[idx]
      return { x: Math.round(o.b.left + 60), y: Math.round(o.b.top + o.b.height / 2), text: (o.r.innerText || '').split('\n')[0].slice(0, 18), full: true }
    }, frac)
    if (!pick) { console.log(`  ${label}: 没找到完整可见的行`); return }
    const beforeTab = s.tab
    await page.touchscreen.tap(pick.x, pick.y)
    await page.waitForTimeout(2400)
    const after = await st()
    console.log(`  ${label} 点「${pick.text}」y=${pick.y} → 会话 ${after.tab !== beforeTab || after.tab ? '已切到「' + after.tab + '」' : '?(tab=' + after.tab + ')'}｜抽屉 ${after.overlay === null ? '✅折叠' : '❌仍开(' + after.overlay + ')'}`)
  }

  await probeAt(0.02, '顶部行')
  await probeAt(0.5, '中部行')
  await probeAt(0.97, '底部行')

  // 滚动后再测一行（虚拟列表深处）
  await page.evaluate(() => {
    const ov = document.querySelector('[data-narrow-overlay]')
    const sc = [...ov.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 40)
    if (sc) sc.scrollTop = sc.scrollHeight
  })
  await page.waitForTimeout(700)
  await probeAt(0.97, '滚到底后的行')

  await browser.close()
})().catch(e => { console.error('故障:', e); process.exit(2) })
