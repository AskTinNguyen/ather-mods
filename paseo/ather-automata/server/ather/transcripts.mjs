// Ather Automata: Claude Code's own records of this checkout's sessions, read-only. Each session is
// <config>/projects/<checkout path, dashed>/<session id>.jsonl, its workers under
// <session id>/subagents/agent-<id>.jsonl with a .meta.json beside each. Records run to many MB, so
// they are grepped, never read whole. The one owner of these paths and of what is cached from them.

import { sessionTitle } from './model.mjs'

/**
 * What these readers need of the engine, as closures over `$` built in the half that holds it
 * (`$` itself may only be passed to functions in its own file).
 * @typedef {{
 *   home: () => Promise<string>, configDir: () => Promise<string>, list: (path: string) => Promise<{ name: string, kind: string }[]>,
 *   read: (path: string) => Promise<string | null>, exists: (path: string) => Promise<boolean>,
 *   run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number, stdout: string } | undefined>,
 *   agents: () => Promise<import('claude-code').AgentInfo[]>
 * }} Host
 */

/** @type {string | null} */
let home = null
/** @type {string | null} */
let project = null
/** @type {Map<string, { name: string, at: number }>} */
const names = new Map()
/** @type {Map<string, { found: WorkerRecord | null, at: number }>} */
const records = new Map()
const NAME_TTL_MS = 5 * 60 * 1000
const MISS_RETRY_MS = 60 * 1000

/** @typedef {{ startedAt: number, model: string }} WorkerRecord */

// A new session (or a reload) reads everything afresh.
export const resetTranscripts = () => {
  home = null
  project = null
  names.clear()
  records.clear()
}

// The person's home folder, forward slashes; '' when the engine cannot say.
/** @param {Host} host */
export async function homeDir(host) {
  if (home === null) home = (await host.home().catch(() => '')).replace(/\\/g, '/')
  return home
}

// This checkout's records folder. The drive letter's case is whatever a session was started with:
// E--s2- and E--S2- are one checkout, so an exact match wins and any case does otherwise.
/** @param {Host} host @param {string} root */
async function projectDir(host, root) {
  if (project !== null) return project
  const user = await homeDir(host)
  if (!user) return ''
  const config = ((await host.configDir().catch(() => '')) || `${user}/.claude`).replace(/\\/g, '/')
  const want = root.replace(/[^a-zA-Z0-9]/g, '-')
  const all = (await host.list(`${config}/projects`).catch(() => [])).filter(one => one.kind === 'dir')
  const entry = all.find(one => one.name === want) ?? all.find(one => one.name.toLowerCase() === want.toLowerCase())
  project = entry ? `${config}/projects/${entry.name}` : ''
  return project
}

// The lines of a file matching a pattern (only the first with `first`): grep, or PowerShell where there is none.
/** @param {Host} host @param {string} path @param {string} pattern @param {{ first?: boolean }} [options] */
async function grepFile(host, path, pattern, { first = false } = {}) {
  const grep = await host.run(['grep', ...(first ? ['-m1'] : []), '-oE', pattern, path], 15000)
  if (grep && (grep.exitCode === 0 || grep.exitCode === 1)) return grep.stdout
  const select = `Select-String -LiteralPath '${path.replace(/'/g, "''")}' -Pattern '${pattern}' ${first ? '-List' : '-AllMatches'} | ForEach-Object { $_.Matches.Value }`
  const ps = await host.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', select], 20000)
  return ps?.exitCode === 0 ? ps.stdout : ''
}

// A session's name as its tab shows it, from the first 8 hex of its id; '' when not found.
/** @param {Host} host @param {string} root @param {string} prefix */
export async function sessionName(host, root, prefix) {
  const hit = names.get(prefix)
  if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.name
  const dir = await projectDir(host, root)
  const file = dir ? (await host.list(dir).catch(() => [])).find(one => one.kind === 'file' && one.name.startsWith(prefix) && one.name.endsWith('.jsonl')) : undefined
  const name = file ? sessionTitle(await grepFile(host, `${dir}/${file.name}`, '"(customTitle|aiTitle)":"[^"]*"')) : ''
  names.set(prefix, { name, at: Date.now() })
  return name
}

// When one of this session's workers started (its record's first line) and on what model (its
// .meta.json); null when there is no record, asked again no sooner than a minute later.
/** @param {Host} host @param {string} root @param {string} session @param {string} id @returns {Promise<WorkerRecord | null>} */
export async function workerRecord(host, root, session, id) {
  const hit = records.get(id)
  if (hit && (hit.found || Date.now() - hit.at < MISS_RETRY_MS)) return hit.found
  const found = await readWorkerRecord(host, root, session, id).catch(() => null)
  records.set(id, { found, at: Date.now() })
  return found
}

/** @param {Host} host @param {string} root @param {string} session @param {string} id @returns {Promise<WorkerRecord | null>} */
async function readWorkerRecord(host, root, session, id) {
  const dir = await projectDir(host, root)
  if (!dir || !session) return null
  const base = `${dir}/${session}/subagents/agent-${id}`
  if (!(await host.exists(`${base}.jsonl`))) return null
  const first = await grepFile(host, `${base}.jsonl`, '"timestamp":"[^"]*"', { first: true })
  const startedAt = Date.parse(/"timestamp":"([^"]*)"/.exec(first)?.[1] ?? '')
  if (Number.isNaN(startedAt)) return null
  const meta = await host.read(`${base}.meta.json`)
  let model = ''
  try {
    model = String(JSON.parse(meta ?? '{}').model ?? '')
  } catch {
    // no meta: the model stays unsaid
  }
  return { startedAt, model }
}
