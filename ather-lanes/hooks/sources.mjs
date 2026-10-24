// @ts-check
// Ather Lanes: one pure reader per source (D2). Each takes what the source gave (a script's stdout, a file's
// text) and returns plain values; none throws, and a missing, empty or half-written input reads as unknown.
// No `$` here: index.mjs runs the processes and reads the files, and hands their text in.

import { parseEditorLock } from './ather/packs/unreal.mjs'

/**
 * One worktree as `lanes.ps1 -Action Status -Json` lists it, its fields taken as they are (D2.1).
 * @typedef {{ name: string, path: string, branch: string, head: string, kind: string, missing: boolean, sidecar: string,
 *   intent: string, tier: string, slotNeed: string }} StatusLane
 * @typedef {{ machineDir: string, lanes: StatusLane[] }} Status
 */

/** @param {unknown} value */
const text = value => (typeof value === 'string' ? value : '')

/** @param {string} raw @returns {any} */
const json = raw => {
  try {
    return JSON.parse(raw.replace(/^﻿/, ''))
  } catch {
    return null
  }
}

// Status' JSON (D2.1); null when it is not that JSON (a script error, a cut output).
/** @param {string} stdout @returns {Status | null} */
export const readStatus = stdout => {
  const data = json(stdout)
  if (!data || typeof data !== 'object' || !Array.isArray(data.lanes)) return null
  const lanes = data.lanes
    .filter((/** @type {any} */ one) => one && typeof one === 'object' && text(one.name) !== '')
    .map((/** @type {any} */ one) => ({ name: text(one.name), path: text(one.path), branch: text(one.branch), head: text(one.head), kind: text(one.kind), missing: one.missing === true, sidecar: text(one.sidecar), intent: text(one.intent), tier: text(one.tier), slotNeed: text(one.slotNeed) }))
  return { machineDir: text(data.machineDir), lanes }
}

// Status' kinds, as `lanes.ps1` writes them; the mod shows them, it does not decide them.
export const KIND_LANE_0 = 'main checkout (lane 0)'
/** @param {string} kind */
export const isPool = kind => kind.startsWith('pool (')
/** @param {string} kind */
export const isPoolReady = kind => kind === 'pool (ready)'

/**
 * One slot file `slots\<id>.txt` (D2.2): its first line through Ather's `parseEditorLock` (holder, end, past its
 * end by its 30-minute rule), plus the first line's `kind <k>`; `pastMinutes`: how long since its end, 0 before it.
 * @typedef {{ id: string, holder: string, until: string, kind: string, isStale: boolean, pastMinutes: number, leftMinutes: number }} Slot
 */

// "HH:MM" to minutes of the day; null for none.
/** @param {string} clock */
const minutesOf = clock => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

// The minutes from now to `until` (negative once passed), read in the window parseEditorLock reads an end in:
// up to 12 hours past it, else it is the next day's.
/** @param {string} until @param {number} nowMinutes */
const minutesTo = (until, nowMinutes) => {
  const end = minutesOf(until)
  if (end === null) return null
  const ago = (nowMinutes - end + 1440) % 1440
  return ago > 0 && ago < 12 * 60 ? -ago : (end - nowMinutes + 1440) % 1440
}

/** @param {string} id @param {string | null} raw @param {number} nowMinutes @returns {Slot | null} */
export const readSlot = (id, raw, nowMinutes) => {
  const first = (raw ?? '').trim().split(/\r?\n/)[0] ?? ''
  const lock = parseEditorLock(first, nowMinutes)
  if (lock.state !== 'held') return null
  const to = minutesTo(lock.until, nowMinutes)
  return { id, holder: lock.holder, until: lock.until, kind: /\bkind\s+([a-z]+)/i.exec(first)?.[1]?.toLowerCase() ?? '', isStale: lock.isStale, pastMinutes: to !== null && to < 0 ? -to : 0, leftMinutes: to !== null && to > 0 ? to : 0 }
}

// The slot counts (`slot-counts.json`, the machine folder's else the skill's data folder): how many slots of each
// kind there are, so a lane that needs one knows whether one is free. null when unread.
/** @param {string | null} raw @returns {Record<string, number> | null} */
export const readSlotCounts = raw => {
  const data = json(raw ?? '')
  if (!data || typeof data !== 'object') return null
  const counts = Object.fromEntries(['full', 'light', 'build'].filter(kind => Number.isInteger(data[kind])).map(kind => [kind, Number(data[kind])]))
  return Object.keys(counts).length > 0 ? counts : null
}

/**
 * A heartbeat, either source (D2.2): `source` says whose, `at` when (ms), `state` what it said ('' for none).
 * @typedef {{ source: 'lane heartbeat' | 'session heartbeat', at: number, state: string }} Beat
 */

// `_machine\heartbeats\<lane>.json`, written by `lanes.ps1 -Action Heartbeat` ({ lane, state, at: ISO }).
/** @param {string | null} raw @returns {Beat | null} */
export const readLaneBeat = raw => {
  const data = json(raw ?? '')
  const at = Date.parse(text(data?.at))
  return Number.isFinite(at) ? { source: 'lane heartbeat', at, state: text(data?.state) } : null
}

// An Ather Automata session heartbeat (`<worktree>\<pack local folder>\lanes\<session>.json`), used only when
// its branch is the worktree's (D2.2): another branch's says nothing of this lane. An ended session reads "ended".
/** @param {string | null} raw @param {string} branch @returns {Beat | null} */
export const readSessionBeat = (raw, branch) => {
  const data = json(raw ?? '')
  const at = Number(data?.updatedAt)
  if (!data || !branch || text(data.branch) !== branch || !Number.isFinite(at) || at <= 0) return null
  return { source: 'session heartbeat', at, state: data.hasEnded === true ? 'ended' : '' }
}

/**
 * One lane branch from the `for-each-ref` (D2.3): ahead of and behind `origin/main`, and its last commit (ms).
 * @typedef {{ ahead: number, behind: number, committedAt: number }} Ref
 */

// The format the `for-each-ref` asks for; readRefs reads it.
export const REF_FORMAT = '%(refname:short) %(ahead-behind:origin/main) %(committerdate:unix)'

/** @param {string} stdout @returns {Map<string, Ref>} */
export const readRefs = stdout => {
  const refs = new Map()
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\S+) (\d+) (\d+) (\d+)$/.exec(line.trim())
    if (match) refs.set(match[1], { ahead: Number(match[2]), behind: Number(match[3]), committedAt: Number(match[4]) * 1000 })
  }
  return refs
}

// When `origin/main` last moved here: the last line of its reflog (`.git\logs\refs\remotes\origin\main`), its
// time field; 0 when unread. The mod never fetches (D2.3).
/** @param {string | null} raw */
export const readReflogTime = raw => {
  const last = (raw ?? '').trim().split(/\r?\n/).pop() ?? ''
  const match = /^[0-9a-f]+ [0-9a-f]+ .*?> (\d+) [+-]\d{4}\t/.exec(last)
  return match ? Number(match[1]) * 1000 : 0
}

// The GitHub `owner/repo` of `remote "origin"` in a `.git\config`; '' for none or another host (D2.4).
/** @param {string | null} raw */
export const readOrigin = raw => {
  const block = /\[remote "origin"\]([^[]*)/.exec(raw ?? '')?.[1] ?? ''
  const url = /^\s*url\s*=\s*(\S+)/m.exec(block)?.[1] ?? ''
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url)
  return match ? `${match[1]}/${match[2]}` : ''
}

// Where a worktree's own `.git` file points (`gitdir: <main>/.git/worktrees/<id>`): the main checkout, lane 0; '' when
// the text is no such pointer.
/** @param {string | null} raw */
export const mainOfGitFile = raw => {
  const dir = /^gitdir:\s*(.+?)\s*$/m.exec(raw ?? '')?.[1]?.replace(/\\/g, '/') ?? ''
  const match = /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(dir)
  return match ? match[1] ?? '' : ''
}

/**
 * A lane branch's PR (D2.4): its number and link, state, draft or not, and its checks rolled up.
 * @typedef {{ number: number, url: string, state: string, isDraft: boolean, checks: 'failing' | 'pending' | 'passing' | 'none' }} Pr
 */

const FAILED = /^(FAILURE|ERROR|CANCELLED|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE)$/
const DONE = /^(SUCCESS|NEUTRAL|SKIPPED)$/

/** @param {unknown} rollup @returns {Pr['checks']} */
const checksOf = rollup => {
  const list = Array.isArray(rollup) ? rollup : []
  if (list.length === 0) return 'none'
  const states = list.map(one => text(one?.conclusion) || text(one?.state))
  if (states.some(state => FAILED.test(state))) return 'failing'
  return states.every(state => DONE.test(state)) ? 'passing' : 'pending'
}

// `gh pr list --json number,headRefName,state,isDraft,statusCheckRollup` for the lane branches: each branch's PR,
// an open one first, else the newest. Branches another fork also has are filtered out by the caller's set.
/** @param {string} stdout @param {string} repo @param {readonly string[]} branches @returns {Map<string, Pr> | null} */
export const readPrs = (stdout, repo, branches) => {
  const data = json(stdout)
  if (!Array.isArray(data)) return null
  const prs = new Map()
  for (const one of data) {
    const branch = text(one?.headRefName)
    const number = Number(one?.number)
    if (!branches.includes(branch) || !Number.isInteger(number)) continue
    const pr = { number, url: `https://github.com/${repo}/pull/${number}`, state: text(one.state).toLowerCase(), isDraft: one.isDraft === true, checks: checksOf(one.statusCheckRollup) }
    const kept = prs.get(branch)
    if (!kept || (pr.state === 'open') > (kept.state === 'open') || ((pr.state === 'open') === (kept.state === 'open') && pr.number > kept.number)) prs.set(branch, pr)
  }
  return prs
}

// The `gh pr list` arguments for some lane branches (D2.4): one search, the branches OR'd.
/** @param {string} repo @param {readonly string[]} branches */
export const prListArgs = (repo, branches) => ['pr', 'list', '-R', repo, '--state', 'all', '--limit', String(Math.max(30, 4 * branches.length)), '--search', branches.map(branch => `head:${branch}`).join(' '), '--json', 'number,headRefName,state,isDraft,statusCheckRollup']
