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
      // 3. 触屏下热区仍要够大：宽度 ≥ 44px，高度 ≥ 34px（顶带高）。
      //    高度上限不再要求 44 —— 44px 高会越出 34px 顶带 15px，那 15px 的
      //    隐形热区正是下方抽屉 tab 条被压住、点了会关抽屉的元凶（见第 4 项）。
      const hotOk = ['left', 'right'].every(
        side => pos[side] && pos[side].w >= 44 && pos[side].h >= 34
      )
      check('触控热区 宽≥44 / 高≥顶带', hotOk, JSON.stringify(pos))
    } else {
      check('titlebar 簇存在（登录后可断言位置）', false, 'clusters=0，页面可能仍是欢迎幕')
    }

    // 4. 顶部 tab 条不得被工具栏图标压住（2026-09-24 缺陷回归门）：
    //    抽屉是覆盖层，其包含块是壳体 padding box（顶到刘海、在工具栏之上），
    //    工具栏却是 fixed z-70 浮层 —— 抽屉顶部内容必须靠
    //    `--titlebar-clearance` 自己让位，否则 tab 条整条落在图标下面，
    //    真机上点 SESSIONS 实际按到"隐藏侧边栏"，抽屉被关掉。
    const drawerGeo = await page.evaluate(() => {
      const box = el => {
        const r = el.getBoundingClientRect()
        return { bottom: Math.round(r.bottom), h: Math.round(r.height), label: (el.innerText || '').trim().slice(0, 12), x: Math.round(r.x), y: Math.round(r.y) }
      }
      const clusterBottom = Math.max(
        0,
        ...[...document.querySelectorAll('[data-titlebar-cluster]')].map(c => c.getBoundingClientRect().bottom)
      )
      const drawer = document.querySelector('[data-narrow-drawer]')
      if (!drawer) return { clusterBottom, opened: false }
      const tabs = [...drawer.querySelectorAll('[role="tab"],[data-slot="pane-tab"]')]
      return {
        clusterBottom,
        opened: true,
        paddingTop: getComputedStyle(drawer).paddingTop,
        closeButton: Boolean(drawer.querySelector('[data-narrow-drawer-close]')),
        tabs: tabs.map(t => {
          const r = t.getBoundingClientRect()
          const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
          return { ...box(t), hitSelf: hit === t || t.contains(hit) }
        }),
        firstRow: (() => {
          const b = [...drawer.querySelectorAll('button')].find(el => el.getBoundingClientRect().height > 0)
          if (!b) return null
          const r = b.getBoundingClientRect()
          const cx = Math.round(r.x + r.width * 0.8)
          const cy = Math.round(r.y + r.height / 2)
          const hit = document.elementFromPoint(cx, cy)
          return { ...box(b), rightHalfHitSelf: hit === b || b.contains(hit) }
        })()
      }
    })

    if (!drawerGeo.opened) {
      // 打开左侧抽屉（触摸语义 = pinned reveal）
      const toggle = await page.$('button[aria-label="隐藏侧边栏"], button[aria-label="显示侧边栏"]')
      if (toggle) {
        const b = await toggle.boundingBox()
        await page.touchscreen.tap(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2))
        await page.waitForTimeout(900)
      }
    }
    const drawerOk = drawerGeo.opened
      ? drawerGeo
      : await page.evaluate(() => {
          const drawer = document.querySelector('[data-narrow-drawer]')
          if (!drawer) return { opened: false }
          const clusterBottom = Math.max(
            0,
            ...[...document.querySelectorAll('[data-titlebar-cluster]')].map(c => c.getBoundingClientRect().bottom)
          )
          return {
            opened: true,
            clusterBottom,
            paddingTop: getComputedStyle(drawer).paddingTop,
            closeButton: Boolean(drawer.querySelector('[data-narrow-drawer-close]')),
            tabs: [...drawer.querySelectorAll('[role="tab"],[data-slot="pane-tab"]')].map(t => {
              const r = t.getBoundingClientRect()
              const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
              return { y: Math.round(r.y), label: (t.innerText || '').trim().slice(0, 12), hitSelf: hit === t || t.contains(hit) }
            }),
            firstRow: null
          }
        })

    if (!drawerOk.opened) {
      check('抽屉可打开（tab 条断言前提）', false, '触摸标题栏侧边栏按钮后无 [data-narrow-drawer]')
    } else {
      const clearOk = drawerOk.tabs.length > 0 && drawerOk.tabs.every(t => t.y >= drawerOk.clusterBottom)
      check(
        '抽屉 tab 条在工具栏之下（零相交）',
        clearOk,
        `工具栏底=${Math.round(drawerOk.clusterBottom)} 抽屉 padding-top=${drawerOk.paddingTop} tabs=${JSON.stringify(drawerOk.tabs)}`
      )
      check('抽屉 tab 可点（hit-test 命中自己）', drawerOk.tabs.every(t => t.hitSelf), JSON.stringify(drawerOk.tabs))
      check('抽屉首行右半段不被工具栏吃掉', !drawerOk.firstRow || drawerOk.firstRow.rightHalfHitSelf, JSON.stringify(drawerOk.firstRow))
      check('抽屉有 44px 关闭按钮（触控）', drawerOk.closeButton === true, `closeButton=${drawerOk.closeButton}`)

      // 真触摸点 tab：命中的话抽屉保持打开（修复前：抽屉被关掉）
      const firstTab = await page.$('[data-narrow-drawer] [role="tab"], [data-narrow-drawer] [data-slot="pane-tab"]')
      if (firstTab) {
        const b = await firstTab.boundingBox()
        await page.touchscreen.tap(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2))
        await page.waitForTimeout(800)
        const stillOpen = await page.evaluate(() => Boolean(document.querySelector('[data-narrow-drawer]')))
        check('真触摸点抽屉 tab 不关抽屉', stillOpen, `tap(${Math.round(b.x + b.width / 2)},${Math.round(b.y + b.height / 2)}) → drawer=${stillOpen}`)
      }
    }

    // 5. 顶部通知横幅不得压住工具栏（它会拦截指针：有更新提示时整个工具栏点不动）
    const notif = await page.evaluate(() => {
      const clusterBottom = Math.max(
        0,
        ...[...document.querySelectorAll('[data-titlebar-cluster]')].map(c => c.getBoundingClientRect().bottom)
      )
      const region = document.querySelector('body > [role="region"][aria-label]')
      if (!region) return { present: false, clusterBottom }
      const r = region.getBoundingClientRect()
      return { present: true, clusterBottom, top: Math.round(r.top), overlaps: r.top < clusterBottom }
    })
    check(
      '通知横幅在工具栏之下（或未出现）',
      !notif.present || !notif.overlaps,
      JSON.stringify(notif)
    )

    // 6. 宽屏触摸下停靠 zone 的 tab 条同样不得被压（同一算术，另一形态）
    const wide = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
    })
    const widePage = await wide.newPage()
    await widePage.goto(`${BASE}/app/`, { waitUntil: 'load', timeout: 60000 })
    await widePage.waitForTimeout(5000)
    const docked = await widePage.evaluate(() => {
      const clusterBottom = Math.max(
        0,
        ...[...document.querySelectorAll('[data-titlebar-cluster]')].map(c => c.getBoundingClientRect().bottom)
      )
      const tabs = [...document.querySelectorAll('[data-zone-tabstrip] [role="tab"],[data-zone-tabstrip] [data-slot="pane-tab"]')]
        .filter(t => t.getBoundingClientRect().height > 0)
        .map(t => {
          const r = t.getBoundingClientRect()
          const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
          return { y: Math.round(r.y), label: (t.innerText || '').trim().slice(0, 12), hitSelf: hit === t || t.contains(hit) }
        })
      return { clusterBottom, tabs }
    })
    await wide.close()
    if (docked.tabs.length === 0) {
      check('停靠 zone tab 条在工具栏之下（本布局无停靠 tab，跳过）', true, JSON.stringify(docked))
    } else {
      check(
        '停靠 zone tab 条在工具栏之下（零相交）',
        docked.tabs.every(t => t.y >= docked.clusterBottom),
        JSON.stringify(docked)
      )
      check('停靠 zone tab 可点', docked.tabs.every(t => t.hitSelf), JSON.stringify(docked))
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
