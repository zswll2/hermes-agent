#!/usr/bin/env node
/**
 * 写 public/build-stamp.json —— web 构建号（单一来源）。
 *
 * 为什么单独一个脚本而不是改上游的 write-build-stamp.mjs：上游那个产出的是
 * Electron 安装器的 build/install-stamp.json，语义不同。这里是**新增文件**，
 * 与上游零冲突。
 *
 * 两个消费方必须来自同一次写盘：
 *   ① vite 的 publicDir 会把 public/build-stamp.json 复制进 dist-web/（线上被页面 fetch 回来比对）；
 *   ② vite.config.ts 读同一个文件，把 buildId 内联成 __HERMES_BUILD_STAMP__。
 * 页面据此在「加载」和「visibilitychange→visible」两处自检，不一致就自动重载一次
 * （sessionStorage 防环）——主屏 WebApp 被 iOS 保活时不会重新导航，只有页面内的代码
 * 才能发现重新部署（见 src/lib/web-update.ts）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(DESKTOP_ROOT, '..', '..')

const git = args => {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const commit = git(['rev-parse', 'HEAD']) || 'unknown'
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown'
const dirty = Boolean(git(['status', '--porcelain']))
const builtAt = new Date().toISOString()
const payload = {
  schemaVersion: 1,
  commit,
  branch,
  builtAt,
  dirty,
  source: 'local',
  buildId: `${commit}+${builtAt}`
}

const out = join(DESKTOP_ROOT, 'public', 'build-stamp.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(payload, null, 2) + '\n', 'utf8')
console.log(`[write-web-stamp] ${commit.slice(0, 8)} ${branch}${dirty ? ' (dirty)' : ''} → public/build-stamp.json`)
