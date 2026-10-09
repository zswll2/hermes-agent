#!/usr/bin/env node
/**
 * iOS 表面调查（一次性）：找出顶部工具簇 / 输入框停靠区 / 主壳的真实 DOM 钩子与几何。
 * 用法: node .omo/surface-survey.cjs https://hermes.simin.work/app-next/
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
  await page.goto(TARGET, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)

  const out = await page.evaluate(() => {
    const V = { w: innerWidth, h: innerHeight }
    const walk = (root, acc) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot, acc)
        acc.push(el)
        // assistant-ui 自定义元素可能有多层 shadow
        for (const d of el.querySelectorAll?.('*') ?? []) void d
      }
      return acc
    }
    const all = []
    const rec = (root) => {
      for (const el of root.querySelectorAll('*')) {
        all.push(el)
        if (el.shadowRoot) rec(el.shadowRoot)
      }
    }
    rec(document)

    const r = el => {
      const b = el.getBoundingClientRect()
      return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }
    }
    const id = el => {
      const attrs = []
      for (const a of el.attributes) if (a.name.startsWith('data-') || a.name === 'id' || a.name === 'role') attrs.push(`${a.name}=${String(a.value).slice(0, 40)}`)
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 5).join(' ')
      return `${el.tagName.toLowerCase()}${attrs.length ? ' [' + attrs.join(' ') + ']' : ''}${cls ? ' .' + cls : ''}`
    }
    const cs = el => getComputedStyle(el)

    // 1) 所有 data-slot（去重，取第一个实例）
    const slots = new Map()
    for (const el of all) {
      for (const a of el.attributes) {
        if (a.name === 'data-slot') {
          if (!slots.has(a.value)) slots.set(a.value, { rect: r(el), cs: { pos: cs(el).position, z: cs(el).zIndex, pt: cs(el).paddingTop, pb: cs(el).paddingBottom, mt: cs(el).marginTop } })
        }
      }
    }

    // 2) 顶部区域（top<70）与底部区域（bottom>h-70）的 fixed/sticky 元素
    const near = []
    for (const el of all) {
      const p = cs(el).position
      if (p !== 'fixed' && p !== 'sticky') continue
      const b = r(el)
      if (b.t < 70 || b.b > V.h - 70) {
        near.push({ el: id(el), pos: p, z: cs(el).zIndex, rect: b, pt: cs(el).paddingTop, pb: cs(el).paddingBottom })
      }
    }

    // 3) 输入框及其祖先链
    const input = document.querySelector('textarea, [contenteditable="true"], input[type="text"]')
    const chain = []
    for (let el = input; el && el !== document.body; el = el.parentElement) {
      chain.push({ el: id(el), pos: cs(el).position, rect: r(el), pb: cs(el).paddingBottom, mb: cs(el).marginBottom })
    }

    return { V, slots: [...slots.entries()].map(([k, v]) => ({ slot: k, ...v })), near: near.slice(0, 25), inputChain: chain.slice(0, 10), inputFound: !!input }
  })

  console.log('=== viewport ===', JSON.stringify(out.V))
  console.log('\n=== data-slot 钩子 ===')
  for (const s of out.slots) console.log(`${s.slot.padEnd(28)} rect=${JSON.stringify(s.rect)} pos=${s.cs.pos} z=${s.cs.z} pt=${s.cs.pt} pb=${s.cs.pb}`)
  console.log('\n=== 顶部/底部 fixed|sticky 元素 ===')
  for (const n of out.near) console.log(`${n.pos} z=${n.z} rect=${JSON.stringify(n.rect)} pt=${n.pt} pb=${n.pb}\n    ${n.el}`)
  console.log('\n=== 输入框祖先链 (found=' + out.inputFound + ') ===')
  for (const c of out.inputChain) console.log(`${c.pos} pb=${c.pb} mb=${c.mb} rect=${JSON.stringify(c.rect)}\n    ${c.el}`)

  await browser.close()
})().catch(e => {
  console.error('调查脚本故障:', e)
  process.exit(2)
})
