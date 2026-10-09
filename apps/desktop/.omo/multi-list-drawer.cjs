#!/usr/bin/env node
/** 多列表路径验证：置顶/最近/项目/分组 各点一行，分别断言抽屉是否折叠。 */
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

  const openDrawer = async () => {
    const b = await page.evaluate(() => {
      const el = document.querySelector('[data-titlebar-cluster="left"] button')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })
    if (b) await page.touchscreen.tap(b.x, b.y)
    await page.waitForTimeout(1100)
  }
  const overlay = () => page.evaluate(() => document.querySelector('[data-narrow-overlay]')?.getAttribute('data-narrow-overlay') ?? null)

  // 列出可见行：带 y、文本、以及它上方最近的段落标题（用于判断属于哪一段）
  const rows = async () => page.evaluate(() => {
    const all = [...document.querySelectorAll('[data-row-actions]')]
    return all.map(h => {
      const row = h.closest('div[class*="group"]') || h.parentElement
      const r = row.getBoundingClientRect()
      let sec = ''
      for (let e = row; e; e = e.previousElementSibling) {
        const t = (e.innerText || '').split('\n')[0]
        if (t && t.length < 24) { sec = t; break }
      }
      if (!sec) for (let e = row.parentElement; e; e = e.parentElement) {
        const t = (e.innerText || '').split('\n').find(x => x && x.length < 24)
        if (t) { sec = t; break }
      }
      return { y: Math.round(r.top + r.height / 2), x: Math.round(r.left + 60), text: (row.innerText || '').split('\n')[0].slice(0, 16), sec: sec.slice(0, 14) }
    }).filter(r => r.y > 90 && r.y < 800)
  })

  await openDrawer()
  const list = await rows()
  const seen = new Set()
  const picks = []
  for (const r of list) { if (!seen.has(r.sec) && picks.length < 5) { seen.add(r.sec); picks.push(r) } }
  // 再补一行"最底部"的（虚拟列表深处）
  if (list.length > 3) picks.push(list[list.length - 1])

  console.log(`抽屉已开，行数=${list.length}，分段: ${[...seen].join(' | ')}`)
  for (const p of picks) {
    if (await overlay() === null) await openDrawer()
    if (await overlay() === null) { console.log(`  跳过（抽屉没打开）`); break }
    await page.touchscreen.tap(p.x, p.y)
    await page.waitForTimeout(2200)
    const ov = await overlay()
    console.log(`  点[${p.sec}] "${p.text}" y=${p.y} → 抽屉 ${ov === null ? '✅ 已折叠' : '❌ 仍开着(' + ov + ')'}`)
  }

  await browser.close()
})().catch(e => { console.error('故障:', e); process.exit(2) })
