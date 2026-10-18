// What the end-to-end runs share (repos.mjs, board.mjs): a sandbox folder with git's own settings kept out, the
// checks and their report, and the drawn tree's lookups. run.mjs keeps its own: it runs only against an S2 checkout.
import fs from 'fs'
import os from 'os'
import path from 'path'

// Folders with forward slashes, as the hooks name a checkout: on Windows path.join and the temporary folder give backslashes.
export const join = (...parts) => path.join(...parts).split(path.sep).join('/')

// A folder of the run's own, by its real path (git names a checkout by it; macOS's temporary folder is behind a link).
// The person's own git settings (signing, hooks, default branch) stay out of its repositories and of the hooks' git calls.
/** @param {string} prefix */
export const sandbox = prefix => {
  const base = join(fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), prefix))))
  fs.writeFileSync(join(base, 'gitconfig'), '')
  process.env.GIT_CONFIG_GLOBAL = join(base, 'gitconfig')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  return base
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
  return { results, expect, finish }
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
