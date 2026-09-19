#!/usr/bin/env node
/**
 * Web 版行为探针 — 升级后验收必跑项（rebase sanity gate）。
 *
 * 为什么存在：rebases 会把「构建绿但行为错」的回归悄悄带进来——
 *   - 上游重构 titlebar-controls.tsx → safe-top 让位从 top: calc 丢失
 *     （typecheck/build 全绿，但 iOS 上工具簇顶进状态栏被灵动岛盖住）
 *   - 新桥通道缺失 → workspace 整屏 failed to render（e.onStatus is not a function）
 * 这些只有真实渲染才看得出，HTTP 200 / typecheck 拦不住。
 *
 * 用法（升级脚本里、或手动确认新 dist-web 行为）：
 *   node apps/desktop/scripts/web-probe.cjs [--port 9319] [--safe-top 44]
 * 默认配 9319 e2e 实例（auth_required:false 免登录，serve 同一份 dist-web）。
 * 退出码：0=全部通过，1=有行为断言失败，2=探针自身故障（连不上等）。
 */
const { chromium } = require('playwright')

const PORT = parseInt(process.argv[find('--port')] ?? '9319', 10)
const SAFE_TOP = parseInt(process.argv[find('--safe-top')] ?? '44', 10)
function find(flag) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? -1 : i + 1
}
const BASE = `http://127.0.0.1:${PORT}`
const results = [] // {name, ok, detail}
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  return ok
}

;(async () => {
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.WEB_PROBE_CHROME ??
        '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    })
    const ctx = await browser.newContext({
      viewport: { width: 402, height: 874 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3
    })
    const page = await ctx.newPage()

    const pageErrors = []
    const consoleErrors = []
    const badResponses = []
    page.on('pageerror', e => pageErrors.push(String(e)))
    page.on('console', m => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('response', r => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`)
    })

    // 1. workspace 必须真实渲染（登录后视图）——抓 screenshot 崩溃类回归
    await page.goto(`${BASE}/app/`, { waitUntil: 'load', timeout: 60000 })
    await page.waitForTimeout(5000)
    const rendered = await page.evaluate(() => {
      const text = document.body?.innerText ?? ''
      return {
        hasHero: text.includes('HERMES AGENT') || text.includes('HERMES'),
        hasFailedToRender: text.includes('failed to render') || text.includes('onStatus'),
        hasRetry: text.includes('Retry'),
        clusters: document.querySelectorAll('[data-titlebar-cluster]').length
      }
    })

    check(
      'workspace 渲染（无 failed to render / 无 Retry）',
      rendered.hasHero && !rendered.hasFailedToRender && !rendered.hasRetry,
      JSON.stringify(rendered)
    )
    check('无页面级 JS 崩溃 (pageerror=0)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    check('无 console error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    check('无 4xx/5xx 响应', badResponses.length === 0, badResponses.slice(0, 5).join(' | '))

    // 2. titlebar 工具簇必须让位安全区：注入 safe-top 后簇 top >= safe-top
    //    （上游重构若再丢掉 top calc 里的 var(--safe-top)，这里立刻变红）
    if (rendered.clusters > 0) {
      const pos = await page.evaluate(safeTop => {
        document.documentElement.style.setProperty('--safe-top', `${safeTop}px`)
        const get = sel => {
          const el = document.querySelector(sel)
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { top: r.top, w: r.width, h: r.height }
        }
        return { left: get('[data-titlebar-cluster="left"]'), right: get('[data-titlebar-cluster="right"]') }
      }, SAFE_TOP)
      const topOk = ['left', 'right'].every(
        side => pos[side] && pos[side].top >= SAFE_TOP - 1
      )
      check(`titlebar 簇让位安全区 (top ≥ ${SAFE_TOP}px)`, topOk, JSON.stringify(pos))
      // 3. 触屏下热区 ≥ 44px（防 44px 规则选择器再失配）
      const hotOk = ['left', 'right'].every(
        side => pos[side] && pos[side].h >= 44 && pos[side].w >= 44
      )
      check('触控热区 ≥ 44px', hotOk, JSON.stringify(pos))
    } else {
      check('titlebar 簇存在（登录后可断言位置）', false, 'clusters=0，页面可能仍是欢迎幕')
    }

    await page.screenshot({ path: '/tmp/web-probe-screenshot.png' })
  } catch (e) {
    check('探针运行（连不上 / 启动失败）', false, String(e))
  } finally {
    if (browser) await browser.close()
  }

  const okCount = results.filter(r => r.ok).length
  console.log(`\n[web-probe] ${okCount}/${results.length} 通过  (端口 ${PORT}, safe-top ${SAFE_TOP})`)
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`)
    if (!r.ok) console.log(`        ${r.detail}`)
  }
  const anyFail = results.some(r => !r.ok)
  process.exit(anyFail ? 1 : 0)
})()
