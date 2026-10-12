#!/usr/bin/env node
// @ts-check
// Ather Automata: the decision desk's command line (intent decision-desk). Run by the desk skill.
//   node desk.mjs collect <checkout>... [--fetch] [--out <dir>]
//     Reads each checkout's base branch (origin/<base>, never the working tree) and writes <dir>/desk.json
//     and <dir>/index.html, the page with that data in it (default dir: ./desk-out). --fetch fetches
//     the base branch first, the way the pane does.
//   node desk.mjs plan <desk.json> <answers.json>
//     What a session records: per repository, each answered decision and its prompt. answers.json is
//     the page's `answers` collection as a list of documents (an ArtifactData list's rows, or their data).
// Nothing here writes to a checkout.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseIntent } from '../hooks/model.mjs'
import { choosePack } from '../hooks/packs/index.mjs'
import { baseOf, fetchArgs, GIT_ENV, readMain } from '../hooks/team.mjs'
import { deskOf, planOf, planText } from './model.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** @param {string} root @returns {import('../hooks/team.mjs').Repo} */
const repoAt = root => ({
  git: async (args, options = {}) => {
    const ran = spawnSync('git', [...args], { cwd: root, input: options.stdin, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: options.timeoutMs })
    return { exitCode: ran.status ?? -1, stdout: ran.stdout ?? '', stderr: ran.stderr ?? String(ran.error ?? '') }
  },
  read: async file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null),
  list: async folder => fs.readdirSync(folder, { withFileTypes: true }).map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'dir' : 'file' })),
  mtime: async file => fs.statSync(file).mtimeMs,
})

/** @param {string} folder */
const packIo = folder => {
  const repo = repoAt(folder)
  return { read: repo.read, list: repo.list, exists: async (/** @type {string} */ file) => fs.existsSync(file), sessionId: async () => 'desk' }
}

// origin's web address, for links: "git@github.com:Owner/repo.git" and "https://…/repo.git" read as "https://github.com/Owner/repo".
/** @param {string} remote */
export const webUrl = remote => {
  const github = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return github ? `https://github.com/${github[1]}/${github[2]}` : ''
}

/** @param {string} folder @param {{ fetch?: boolean }} [options] @returns {Promise<import('./model.mjs').Checkout>} */
export const readCheckout = async (folder, options = {}) => {
  const top = await repoAt(folder).git(['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) throw new Error(`${folder}: not a git checkout`)
  const root = top.stdout.trim()
  const repo = repoAt(root)
  const { pack, profile, defaultBranch } = await choosePack(packIo(root), root)
  const base = baseOf(profile, defaultBranch)
  if (options.fetch) {
    const fetched = await repo.git(fetchArgs(base))
    if (fetched.exitCode !== 0) throw new Error(`${root}: git fetch of ${base} failed: ${fetched.stderr.trim()}`)
  }
  const main = await readMain(repo, null, base)
  if (!main) throw new Error(`${root}: no origin/${base} to read (fetch it, or run with --fetch)`)
  const url = webUrl((await repo.git(['remote', 'get-url', 'origin'])).stdout)
  const intents = [...main.folders].map(([slug, folder]) =>
    parseIntent({ slug, prompt: folder.prompt, progress: folder.progress, findings: folder.findings, files: folder.files, hasDebrief: false, updatedAt: folder.at, source: 'main', firstAuthor: folder.firstAuthor }, pack),
  )
  return { name: url ? url.split('/').pop() ?? path.basename(root) : path.basename(root), url, base, sha: main.sha, intents }
}

// The page with the desk's data in it. `<` is escaped so no text in a finding can close the script.
/** @param {import('./model.mjs').Desk} desk */
export const pageWith = desk => {
  const page = fs.readFileSync(path.join(HERE, 'page.html'), 'utf8')
  const data = JSON.stringify(desk).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16)}`)
  const slot = '<script type="application/json" id="desk-data">null</script>'
  if (!page.includes(slot)) throw new Error('page.html: no desk-data slot')
  return page.replace(slot, () => `<script type="application/json" id="desk-data">${data}</script>`)
}

// An ArtifactData list's rows ({ id, data }) or the documents themselves.
/** @param {unknown} json @returns {import('./model.mjs').Answer[]} */
export const answersFrom = json => {
  const rows = Array.isArray(json) ? json : Array.isArray(/** @type {any} */ (json)?.docs) ? /** @type {any} */ (json).docs : []
  return rows.map(row => (row && typeof row === 'object' && 'data' in row ? row.data : row)).filter(doc => doc && typeof doc.id === 'string')
}

/** @param {string[]} argv */
const main = async argv => {
  const [command, ...rest] = argv
  if (command === 'collect') {
    const outAt = rest.indexOf('--out')
    const out = path.resolve(outAt >= 0 ? (rest[outAt + 1] ?? 'desk-out') : 'desk-out')
    const folders = rest.filter((arg, index) => !arg.startsWith('--') && rest[index - 1] !== '--out')
    if (folders.length === 0) throw new Error('collect: name at least one checkout')
    const checkouts = []
    for (const folder of folders) checkouts.push(await readCheckout(path.resolve(folder), { fetch: rest.includes('--fetch') }))
    const desk = deskOf(checkouts, Date.now())
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'desk.json'), `${JSON.stringify(desk, null, 2)}\n`)
    fs.writeFileSync(path.join(out, 'index.html'), pageWith(desk))
    for (const repo of desk.repos) console.log(`${repo.name}: ${repo.waiting} waiting in ${repo.intents} open intents (origin/${repo.base} ${repo.sha.slice(0, 7)})`)
    console.log(`wrote ${path.join(out, 'desk.json')} and index.html`)
    return
  }
  if (command === 'plan') {
    const [deskFile, answersFile] = rest
    if (!deskFile || !answersFile) throw new Error('plan: name desk.json and answers.json')
    const plan = planOf(JSON.parse(fs.readFileSync(deskFile, 'utf8')), answersFrom(JSON.parse(fs.readFileSync(answersFile, 'utf8'))))
    console.log(rest.includes('--json') ? JSON.stringify(plan, null, 2) : planText(plan))
    return
  }
  throw new Error('usage: desk.mjs collect <checkout>... [--fetch] [--out <dir>] | plan <desk.json> <answers.json> [--json]')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
