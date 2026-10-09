#!/usr/bin/env node
/**
 * iOS 表面调查/验收（一次性脚本）：连本地免登录实例，模拟 iPhone 安全区，量真实几何。
 *
 * 用法: node .omo/ios-surface-probe.cjs <baseUrl> <token> [--set-safe]
 *   baseUrl 例: http://127.0.0.1:9321/api/plugins/hermes-webapp/
 *   --set-safe 注入 --hermes-safe-top:59px / --hermes-safe-bottom:34px（headless 里 env() 恒 0）
 */
const { chromium } = require('playwright')

const BASE = process.argv[2]
const TOKEN = process.argv[3]
const SET_SAFE = process.argv.includes('--set-safe')
const ORIGIN = new URL(BASE).origin

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
  // 只对本机 origin 注入会话 token（别发给第三方域，否则 CORS 噪声）
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
  const errs = []
  const bad = []
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  page.on('console', m => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 200)))
  page.on('response', r => r.status() >= 400 && bad.push(`${r.status()} ${r.url().slice(0, 120)}`))

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)

  if (SET_SAFE) {
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--hermes-safe-top', '59px')
      document.documentElement.style.setProperty('--hermes-safe-bottom', '34px')
    })
    await page.waitForTimeout(400)
  }

  const out = await page.evaluate(() => {
    const all = []
    const rec = root => {
      for (const el of root.querySelectorAll('*')) {
        all.push(el)
        if (el.shadowRoot) rec(el.shadowRoot)
      }
    }
    rec(document)
    const R = el => {
      const b = el.getBoundingClientRect()
      return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height) }
    }
    const CS = el => getComputedStyle(el)
    const desc = el => {
      const at = []
      for (const a of el.attributes) if (a.name.startsWith('data-') || a.name === 'id') at.push(`${a.name}=${String(a.value).slice(0, 32)}`)
      const cl = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 4).join(' ')
      return `${el.tagName.toLowerCase()}${at.length ? ' [' + at.join(' ') + ']' : ''}${cl ? ' .' + cl : ''}`
    }

    const slots = new Map()
    for (const el of all) {
      const v = el.getAttribute?.('data-slot')
      if (v && !slots.has(v)) slots.set(v, { rect: R(el), pos: CS(el).position, z: CS(el).zIndex })
    }

    const near = []
    for (const el of all) {
      const p = CS(el).position
      if (p !== 'fixed' && p !== 'sticky') continue
      const b = R(el)
      if (b.t < 90 || b.b > innerHeight - 90) near.push({ el: desc(el), pos: p, z: CS(el).zIndex, rect: b, pt: CS(el).paddingTop, pb: CS(el).paddingBottom })
    }

    // 顶部最小 top（判断有没有让位）
    const tops = near.filter(n => n.rect.t < 90).map(n => n.rect.t)
    const bots = near.filter(n => n.rect.b > innerHeight - 90).map(n => n.rect.b)

    const input = document.querySelector('textarea, [contenteditable="true"]')
    const inputRect = input ? R(input) : null

    return {
      V: { w: innerWidth, h: innerHeight },
      safeTop: getComputedStyle(document.documentElement).getPropertyValue('--hermes-safe-top').trim(),
      safeBottom: getComputedStyle(document.documentElement).getPropertyValue('--hermes-safe-bottom').trim(),
      slots: [...slots.entries()].map(([k, v]) => ({ slot: k, ...v })),
      near: near.slice(0, 20),
      minTop: tops.length ? Math.min(...tops) : null,
      maxBottom: bots.length ? Math.max(...bots) : null,
      inputRect,
      text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 400)
    }
  })

  console.log('viewport', JSON.stringify(out.V), '| safeTop=' + out.safeTop, 'safeBottom=' + out.safeBottom)
  console.log('顶部最小 top =', out.minTop, '（安全区要求 ≥ safeTop）  底部最大 bottom =', out.maxBottom, '（要求 ≤', out.V.h - (parseInt(out.safeBottom) || 0), '）')
  console.log('输入框 rect =', JSON.stringify(out.inputRect))
  console.log('\n--- data-slot ---')
  for (const s of out.slots) console.log(`${s.slot.padEnd(26)} rect=${JSON.stringify(s.rect)} pos=${s.pos} z=${s.z}`)
  console.log('\n--- 顶部/底部 fixed|sticky ---')
  for (const n of out.near) console.log(`${n.pos} z=${n.z} rect=${JSON.stringify(n.rect)} pt=${n.pt} pb=${n.pb}\n   ${n.el}`)
  console.log('\n--- 可见文本 ---\n' + out.text)
  console.log('\n--- pageerror/console.error (' + errs.length + ') ---\n' + [...new Set(errs)].slice(0, 6).join('\n'))
  console.log('--- 4xx/5xx (' + bad.length + ') ---\n' + [...new Set(bad)].slice(0, 8).join('\n'))

  await browser.close()
})().catch(e => {
  console.error('故障:', e)
  process.exit(2)
})
