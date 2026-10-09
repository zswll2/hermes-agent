#!/usr/bin/env node
/**
 * 两件事一次查：① 输入框被谁裁掉 ② 窄屏抽屉能不能关/选完会不会关
 * 用法: node .omo/ios-issues-probe.cjs <baseUrl> <token>
 */
const { chromium } = require('playwright')

const BASE = process.argv[2]
const TOKEN = process.argv[3]
const ORIGIN = new URL(BASE).origin

const HELPERS = `
  const Q = s => document.querySelector(s);
  const ALL = s => [...document.querySelectorAll(s)];
  const R = el => { const b = el.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  const D = el => {
    const at = [];
    for (const a of el.attributes) if (a.name.startsWith('data-') || a.name === 'role') at.push(a.name + '=' + String(a.value).slice(0, 24));
    const cl = (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 3).join(' ');
    return el.tagName.toLowerCase() + (at.length ? '[' + at.join(' ') + ']' : '') + (cl ? '.' + cl : '');
  };
`

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
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--hermes-safe-top', '59px')
    document.documentElement.style.setProperty('--hermes-safe-bottom', '34px')
  })
  await page.waitForTimeout(500)

  // ---------- ① 输入框 ----------
  const box = await page.evaluate(`(() => { ${HELPERS}
    const surf = Q("[data-slot='composer-surface']") || Q("[data-slot='composer-root']") || Q("[data-slot='composer-dock']");
    const ancestors = [];
    for (let e = surf; e && e !== document.documentElement; e = e.parentElement) {
      const c = getComputedStyle(e);
      ancestors.push({ el: D(e), rect: R(e), overflowY: c.overflowY, overflowX: c.overflowX, padB: c.paddingBottom, h: c.height });
    }
    // 数据源里哪些元素的可视区底边 < 输入框底边 → 就是它裁的
    const surfB = R(surf).b;
    const clippers = ancestors.filter(a => (a.overflowY === 'hidden' || a.overflowY === 'clip' || a.overflowY === 'auto') && a.rect.b < surfB);
    return { vh: innerHeight, surf: D(surf), surfRect: R(surf), ancestors, clippers,
             dock: Q("[data-slot='composer-dock']") ? R(Q("[data-slot='composer-dock']")) : null };
  })()`)

  console.log('=== ① 输入框 ===')
  console.log('视口高', box.vh, '| surface', box.surf, JSON.stringify(box.surfRect), '| dock', JSON.stringify(box.dock))
  console.log('祖先链（里→外）:')
  for (const a of box.ancestors) console.log(`   ${a.el}\n      rect=${JSON.stringify(a.rect)} overflowY=${a.overflowY} padB=${a.padB} h=${a.h}`)
  console.log('⚠ 会裁掉输入框的祖先:', box.clippers.length ? JSON.stringify(box.clippers.map(c => ({ el: c.el, bottom: c.rect.b }))) : '无')

  // ---------- ② 抽屉 ----------
  const drawerState = async label => {
    const s = await page.evaluate(`(() => { ${HELPERS}
      const sheets = ALL("[data-slot='sheet-content']").map(e => ({ el: D(e), rect: R(e), state: e.getAttribute('data-state') }));
      const sb = ALL("[data-slot='sidebar']").map(e => ({ d: D(e), rect: R(e), mobile: e.getAttribute('data-mobile'), state: e.getAttribute('data-state') }));
      const overlays = ALL("[data-slot='sheet-overlay']").map(e => ({ rect: R(e), opacity: getComputedStyle(e).opacity }));
      const toggles = ALL("[data-titlebar-cluster='left'] *").filter(e => e.tagName === 'BUTTON').map(e => e.getAttribute('aria-label'));
      // 会话行候选：sidebar 内可点的行
      const rows = ALL("[data-slot='sidebar'] *").filter(e => e.hasAttribute('data-row-actions')).map(e => ({ el: D(e.parentElement), rect: R(e.parentElement), text: (e.parentElement.innerText || '').slice(0, 24).replace(/\\n/g, ' ') }));
      return { sheets, sb, overlays, toggles, rowCount: rows.length, rows: rows.slice(0, 3) };
    })()`)
    console.log(`\n[${label}] sidebar=${JSON.stringify(s.sb)} sheet=${JSON.stringify(s.sheets)} overlay=${JSON.stringify(s.overlays)}`)
    console.log(`   左侧按钮 aria-label=${JSON.stringify(s.toggles)}  会话行数=${s.rowCount}`, s.rows.length ? JSON.stringify(s.rows[0]) : '')
    return s
  }

  await drawerState('初始')
  await page.evaluate(`(() => { ${HELPERS}
    const b = ALL("[data-titlebar-cluster='left'] button")[0]; if (b) b.click();
  })()`)
  await page.waitForTimeout(1200)
  const open = await drawerState('点开抽屉后')

  // 点一个会话行
  const clicked = await page.evaluate(`(() => { ${HELPERS}
    const h = Q("[data-row-actions]");
    const row = h && h.closest('[role="button"],[data-slot],div');
    if (!row) return '没找到会话行';
    const t = (row.innerText || '').slice(0, 24).replace(/\\n/g, ' ');
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    row.click();
    return t;
  })()`)
  console.log('\n点了会话行:', clicked)
  await page.waitForTimeout(2500)
  const after = await drawerState('选会话之后')

  // 试试点遮罩（右侧空白带）
  const tapped = await page.evaluate(`(() => { ${HELPERS}
    const ov = Q("[data-slot='sheet-overlay']");
    if (!ov) return '没有遮罩元素';
    const r = ov.getBoundingClientRect();
    const x = Math.min(innerWidth - 8, r.right - 8), y = Math.round(innerHeight / 2);
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      ov.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    }
    return 'x=' + x + ' y=' + y;
  })()`)
  console.log('点遮罩:', tapped)
  await page.waitForTimeout(1500)
  await drawerState('点遮罩之后')

  await browser.close()
})().catch(e => { console.error('故障:', e); process.exit(2) })
