#!/usr/bin/env node
/**
 * 布局盒子调查：从 shell 到顶部条/主视图/输入区，逐层打印 position/rect/padding/margin。
 * 用法: node .omo/box-survey.cjs <baseUrl> <token>
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
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

  const out = await page.evaluate(() => {
    const CS = el => getComputedStyle(el)
    const R = el => {
      const b = el.getBoundingClientRect()
      return `${Math.round(b.top)}~${Math.round(b.bottom)} (h${Math.round(b.height)})`
    }
    const d = el => {
      const at = []
      for (const a of el.attributes) if (a.name.startsWith('data-') || a.name === 'id') at.push(`${a.name}=${String(a.value).slice(0, 26)}`)
      const cl = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
      return `${el.tagName.toLowerCase()}${at.length ? '[' + at.join(' ') + ']' : ''}${cl ? ' .' + cl : ''}`
    }
    const row = el => {
      const c = CS(el)
      return `${d(el)}\n      rect=${R(el)} pos=${c.position} top=${c.top} bottom=${c.bottom} h=${c.height} pt=${c.paddingTop} pb=${c.paddingBottom} mt=${c.marginTop} mb=${c.marginBottom} z=${c.zIndex} display=${c.display} overflow=${c.overflow}`
    }
    const chain = (el, n = 7) => {
      const rows = []
      for (let e = el; e && e !== document.documentElement && rows.length < n; e = e.parentElement) rows.push(row(e))
      return rows.join('\n   ^ ')
    }

    const topBand = document.querySelector('[data-slot="pane-tab"]')?.parentElement
    const thread = document.querySelector('aui_thread-viewport')
    const dock = document.querySelector('[data-slot="composer-dock"]')
    const cluster = document.querySelector('[data-titlebar-cluster="left"]')
    const root = document.getElementById('root') ?? document.body.firstElementChild

    return {
      html: row(document.documentElement),
      body: row(document.body),
      root: chain(root, 3),
      cluster: row(cluster),
      clusterParent: chain(cluster.parentElement, 4),
      topBand: chain(topBand, 5),
      thread: chain(thread, 6),
      dock: chain(dock, 6),
      dockCS: (() => { const c = CS(dock); return `pt=${c.paddingTop} pb=${c.paddingBottom} mb=${c.marginBottom} bottom=${c.bottom}` })(),
      allSlots: [...document.querySelectorAll('[data-slot]')].map(e => e.getAttribute('data-slot')).join(',')
    }
  })

  for (const [k, v] of Object.entries(out)) console.log(`\n=== ${k} ===\n${v}`)
  await browser.close()
})().catch(e => { console.error('故障:', e); process.exit(2) })
