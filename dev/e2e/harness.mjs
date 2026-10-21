// What the end-to-end runs share (repos.mjs, board.mjs): a sandbox folder with git's own settings kept out, the
// run's arguments, the checks and their report, what was drawn written as text, and the drawn tree's lookups.
// run.mjs keeps its own sandbox (it runs only against an S2 checkout) and shares only tempDir.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { check } from './screen.mjs'

// Folders with forward slashes, as the hooks name a checkout: on Windows path.join and the temporary folder give backslashes.
export const join = (...parts) => path.join(...parts).split(path.sep).join('/')

// A new folder under the temporary folder, removed when the run ends however it ends (a throw, a skipped clean-up,
// Ctrl+C): an S2 sandbox holds a copy of docs/intent, over a GB, and kept ones filled the disk.
/** @type {string[]} */
const temps = []
/** @param {string} prefix */
export const tempDir = prefix => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temps.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of temps) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      console.log(`left behind ${dir}: ${/** @type {NodeJS.ErrnoException} */ (error).code ?? error}`)
    }
  }
})
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) process.on(signal, () => process.exit(128 + os.constants.signals[signal]))

// A folder of the run's own, by its real path (git names a checkout by it; macOS's temporary folder is behind a link).
// The person's own git settings (signing, hooks, default branch) stay out of its repositories and of the hooks' git calls.
/** @param {string} prefix */
export const sandbox = prefix => {
  const base = join(fs.realpathSync(tempDir(prefix)))
  fs.writeFileSync(join(base, 'gitconfig'), '')
  process.env.GIT_CONFIG_GLOBAL = join(base, 'gitconfig')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  return base
}

// A run's arguments: the report's path, if one is given, and `--out <dir>`, where it writes what it drew ('' for none).
export const runArgs = () => {
  const args = process.argv.slice(2)
  const at = args.indexOf('--out')
  return { report: args.find((one, index) => !one.startsWith('--') && (at < 0 || index !== at + 1)), out: at >= 0 ? (args[at + 1] ?? '') : '' }
}

// A drawn tree as the terminal lays it out at `width` columns, written to <dir>/<name>-<width>.txt.
/** @param {string} dir @param {string} name @param {any} tree @param {number} width */
export const writeDrawn = (dir, name, tree, width) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(join(dir, `${name}-${width}.txt`), `${check(tree, width).lines.join('\n')}\n`)
}

// The checks: `expect` records one, `finish` writes the report (when asked), prints the failures and the count,
// and exits with the verdict: timers the hooks started must not keep the run alive.
export const checks = () => {
  /** @type {{ name: string, ok: boolean, detail: string }[]} */
  const results = []
  /** @param {string} name @param {unknown} ok @param {unknown} [detail] */
  const expect = (name, ok, detail = '') => void results.push({ name, ok: Boolean(ok), detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })
  /** @param {{ title: string, report?: string, cut?: number }} how */
  const finish = ({ title, report, cut = 400 }) => {
    const passed = results.filter(one => one.ok).length
    const lines = [`# ${title}`, '', `${passed} of ${results.length} checks passed.`, '']
    for (const one of results) lines.push(`- ${one.ok ? '✅' : '❌'} ${one.name}${one.ok || !one.detail ? '' : `  \n  ${one.detail}`}`)
    if (report) fs.writeFileSync(report, `${lines.join('\n')}\n`)
    console.log(`${passed}/${results.length} passed`)
    for (const one of results.filter(r => !r.ok)) console.log(`FAIL ${one.name}\n     ${one.detail.slice(0, cut)}`)
    process.exit(passed === results.length ? 0 : 1)
  }
  return { expect, finish }
}

// A drawn tree's nodes, depth first, and the one with a key.
/** @param {any} node @returns {any[]} */
export const nodesOf = node => (!node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flatMap(nodesOf)])
/** @param {any} tree @param {string} key */
export const byKey = (tree, key) => nodesOf(tree).find(node => node.props?.key === key)

// Waits until `test` holds, up to `ms`.
/** @param {() => Promise<unknown>} test @param {number} [ms] */
export const until = async (test, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 150))) if (await test()) return true
  return false
}
