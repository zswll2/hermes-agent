#!/usr/bin/env node
/**
 * 一次性诊断：未登录时 /app-next 到底渲染出什么（不是探针，用完即弃）。
 * 用法: node .omo/app-next-boot-probe.cjs https://hermes.simin.work/app-next/
 */
const { chromium } = require('playwright')

const TARGET = process.argv[2] || 'https://hermes.simin.work/app-next/'

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.WEB_PROBE_CHROME ?? '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3
  })
  const page = await ctx.newPage()
  const consoleErrors = []
  const pageErrors = []
  const bad = []

  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text().slice(0, 300)}`)
  })
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)))
  page.on('response', async r => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 160)}`)
  })

  await page.goto(TARGET, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)

  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 1500),
    hasRoot: !!document.getElementById('root'),
    childCount: document.getElementById('root')?.childElementCount ?? -1
  }))

  console.log('=== URL ===\n' + info.url)
  console.log('=== TITLE ===\n' + info.title)
  console.log('=== ROOT children: ' + info.childCount + ' / has #root: ' + info.hasRoot)
  console.log('=== 可见文本 ===\n' + info.text)
  console.log('=== pageerror (' + pageErrors.length + ') ===\n' + pageErrors.slice(0, 8).join('\n'))
  console.log('=== console error/warning (' + consoleErrors.length + ') ===\n' + consoleErrors.slice(0, 12).join('\n'))
  console.log('=== 4xx/5xx (' + bad.length + ') ===\n' + [...new Set(bad)].slice(0, 12).join('\n'))

  await browser.close()
})().catch(e => {
  console.error('探针故障:', e)
  process.exit(2)
})
