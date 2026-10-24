// @ts-check
// Ather Lanes: the engine half. /lanes opens the pane; while it is shown (and only then, D3) a 30-second timer reads
// the slot and heartbeat files, and every 2 minutes (and on r) runs lanes.ps1 Status, the one for-each-ref and reads
// the lanes' intents; gh at most every 5 minutes, its answer kept in the store for any session. One process at a
// time: a run that comes due while one runs is skipped. Read-only: the mod writes only its own store (Status' own
// stale-sidecar move aside, README). It hooks no tool call, prompt or turn, and a draw only reads what the last
// refresh left. Everything here catches its own failures: the pane says what it could not read and draws the rest.

import { parseIntent } from './ather/model.mjs'
import { unreal } from './ather/packs/unreal.mjs'
import { boardOf } from './board.mjs'
import { drawPane, paneLines } from './pane.mjs'
import { NO_SOURCES, laneBranches, laneRecords } from './records.mjs'
import { REF_FORMAT, mainOfGitFile, prListArgs, readLaneBeat, readOrigin, readPrs, readRefs, readReflogTime, readSessionBeat, readSlot, readSlotCounts, readStatus } from './sources.mjs'

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {import('./records.mjs').Sources} Sources
 * @typedef {{ root: string, main: string, machineDir: string, scriptsDir: string, repo: string, errors: string[], canRun: boolean }} Place
 *   the session's checkout and lane 0, the machine folder and the scripts, and what of them could not be found
 */

const PANE_ID = 'lanes'
const FILES_EVERY_MS = 30 * 1000
const STATUS_EVERY_MS = 2 * 60 * 1000
const PRS_EVERY_MS = 5 * 60 * 1000
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
// A timer tick lands a little early or late: a read due within this much of its time runs on this tick, not the next.
const SLACK_MS = 5 * 1000

/** @type {{ -readonly [K in keyof Sources]: Sources[K] }} */
let sources = { ...NO_SOURCES }
/** @type {Record<string, number> | null} */
let counts = null
// When each source was last asked for; -Infinity: never, so the first refresh asks for all.
let statusAt = -Infinity
let prsAt = -Infinity
// When the pane was last refreshed; null before the first.
/** @type {number | null} */
let refreshedAt = null
let isBusy = false
/** @type {string[]} */
let errors = []
/** @type {Record<string, string>} */
let runErrors = {}
/** @type {import('claude-code').Timer | null} */
let timer = null
let opened = ''
let isFoldOpen = false

/** @param {string} path */
const slash = path => path.replace(/\\/g, '/').replace(/\/+$/, '')
/** @param {string} path */
const parentOf = path => slash(path).replace(/\/[^/]*$/, '')
/** @param {Engine} $ @param {string} path */
const read = ($, path) => $.fs.read(path).then(text => (typeof text === 'string' ? text : null), () => null)
/** @param {Engine} $ @param {string} path */
const exists = ($, path) => $.fs.exists(path).catch(() => false)
/** @param {Engine} $ @param {string} path */
const list = ($, path) => $.fs.list(path).catch(() => [])

// Where the lanes are, from files alone (no process): the checkout the session runs in (the nearest folder with a
// .git), lane 0 (a worktree's .git file names it), the machine folder and the scripts (D6). What is missing is said.
/** @param {Engine} $ @param {Record<string, unknown>} options @returns {Promise<Place>} */
const placeOf = async ($, options) => {
  let root = slash(await $.session.root())
  while (root && !(await exists($, `${root}/.git`))) root = root.includes('/') && parentOf(root) !== root ? parentOf(root) : ''
  if (!root) return { root: '', main: '', machineDir: '', scriptsDir: '', repo: '', errors: ['This session is not in a git checkout, so there are no lanes to read. Open it in an S2 checkout or a lane.'], canRun: false }
  const gitFile = (await $.fs.stat(`${root}/.git`).catch(() => null))?.kind === 'file' ? await read($, `${root}/.git`) : null
  const main = gitFile === null ? root : slash(mainOfGitFile(gitFile)) || root
  const machineDir = slash(String(options.machineDir ?? '')) || `${parentOf(main)}/lanes/_machine`
  const scriptsDir = slash(String(options.scriptsDir ?? '')) || `${root}/.agents/skills/s2-agent-lanes/scripts`
  const found = []
  if (!(await exists($, `${scriptsDir}/lanes.ps1`))) found.push(`No lanes.ps1 in ${scriptsDir}: set Ather Lanes' scriptsDir to the S2 lane scripts.`)
  // Status would create the machine folder: the mod never runs it where there is none (D6).
  if (!(await exists($, machineDir))) found.push(`No machine folder at ${machineDir}, so no lanes here.`)
  return { root, main, machineDir, scriptsDir, repo: readOrigin(await read($, `${main}/.git/config`)), errors: found, canRun: found.length === 0 }
}

// One process, logged to the debug log so its runs can be counted (A4).
/** @param {Engine} $ @param {readonly string[]} argv @param {string} cwd @param {string} what */
const run = async ($, argv, cwd, what) => {
  $.ui.log(`Ather Lanes: spawn ${what}`, { to: 'debug' })
  return $.process.run(argv, { cwd, env: GIT_ENV, timeoutMs: 60000 }).catch(error => ({ exitCode: -1, stdout: '', stderr: String(error) }))
}

/** @param {string} what @param {{ exitCode: number, stderr: string }} ran */
const failed = (what, ran) => `${what} failed (exit ${ran.exitCode}): ${(ran.stderr || '').trim().split(/\r?\n/)[0] ?? ''}`

// The files of D2.2 and the reflog, no process: slots, slot counts, lane and session heartbeats.
/** @param {Engine} $ @param {Place} at @param {number} now */
const readFiles = async ($, at, now) => {
  const machineDir = slash(sources.status?.machineDir || at.machineDir)
  const minutes = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const slotFiles = (await list($, `${machineDir}/slots`)).filter(one => one.kind === 'file' && one.name.endsWith('.txt'))
  const slots = (await Promise.all(slotFiles.map(async one => readSlot(one.name.replace(/\.txt$/, ''), await read($, `${machineDir}/slots/${one.name}`), minutes)))).filter(one => one !== null)
  counts = readSlotCounts(await read($, `${machineDir}/slot-counts.json`)) ?? readSlotCounts(await read($, `${parentOf(at.scriptsDir)}/data/slot-counts.json`))
  const lanes = sources.status?.lanes ?? []
  const laneBeats = new Map()
  const sessionBeats = new Map()
  const beatFiles = new Set((await list($, `${machineDir}/heartbeats`)).map(one => one.name))
  await Promise.all(
    lanes.map(async lane => {
      const beat = beatFiles.has(`${lane.name}.json`) ? readLaneBeat(await read($, `${machineDir}/heartbeats/${lane.name}.json`)) : null
      if (beat) laneBeats.set(lane.name, beat)
      if (lane.missing || !lane.path) return
      const dir = `${slash(lane.path)}/${unreal.localDir}/lanes`
      const beats = await Promise.all((await list($, dir)).filter(one => one.name.endsWith('.json')).map(async one => readSessionBeat(await read($, `${dir}/${one.name}`), lane.branch)))
      const newest = beats.filter(one => one !== null).sort((a, b) => b.at - a.at)[0]
      if (newest) sessionBeats.set(lane.path, newest)
    }),
  )
  sources = { ...sources, slots, laneBeats, sessionBeats, mainMovedAt: readReflogTime(await read($, `${at.main}/.git/logs/refs/remotes/origin/main`)) }
}

// D2.1, D2.3 and D2.5: Status, the one for-each-ref over the lane branches, and each registered lane's intent.
/** @param {Engine} $ @param {Place} at @param {Record<string, unknown>} options */
const readLanes = async ($, at, options) => {
  const machine = options.machineDir ? ['-MachineDir', at.machineDir.replace(/\//g, '\\')] : []
  const ran = await run($, ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${at.scriptsDir}/lanes.ps1`.replace(/\//g, '\\'), '-Action', 'Status', '-Json', '-Repo', at.root.replace(/\//g, '\\'), ...machine], at.root, 'powershell lanes.ps1 -Action Status')
  const status = readStatus(ran.stdout)
  runErrors.status = status ? '' : failed('lanes.ps1 -Action Status', ran)
  if (!status) return
  sources = { ...sources, status }
  const branches = laneBranches(status)
  if (branches.length > 0) {
    const refs = await run($, ['git', '-C', at.main, 'for-each-ref', `--format=${REF_FORMAT}`, ...branches.map(branch => `refs/heads/${branch}`)], at.main, 'git for-each-ref')
    runErrors.refs = refs.exitCode === 0 ? '' : failed('git for-each-ref', refs)
    sources = { ...sources, refs: refs.exitCode === 0 ? readRefs(refs.stdout) : sources.refs }
  }
  const intents = new Map()
  for (const lane of status.lanes.filter(one => one.sidecar === 'registered' && one.intent && !one.missing)) {
    const dir = `${slash(lane.path)}/docs/intent/${lane.intent}`
    const prompt = await read($, `${dir}/prompt.md`)
    intents.set(lane.name, prompt === null ? null : parseIntent({ slug: lane.intent, prompt, progress: (await read($, `${dir}/progress.md`)) ?? '', findings: (await read($, `${dir}/findings.md`)) ?? '', files: [], hasDebrief: false, updatedAt: 0, source: 'local', firstAuthor: '' }))
  }
  sources = { ...sources, intents }
}

// D2.4: the lane branches' PRs, from the store when another session read them in the last 5 minutes.
/** @param {Engine} $ @param {Place} at @param {number} now */
const readPrList = async ($, at, now) => {
  const branches = laneBranches(sources.status, { forPrs: true })
  if (!at.repo || branches.length === 0) {
    sources = { ...sources, prs: new Map() }
    return
  }
  const key = `prs:${at.repo}`
  const kept = /** @type {{ at: number, branches: string[], stdout: string } | undefined} */ (await $.store.get(key).catch(() => undefined))
  const isKept = kept && now - kept.at < PRS_EVERY_MS && branches.every(branch => kept.branches.includes(branch))
  const stdout = isKept ? kept.stdout : await (async () => {
    const ran = await run($, ['gh', ...prListArgs(at.repo, branches)], at.machineDir, 'gh pr list')
    runErrors.prs = ran.exitCode === 0 ? '' : failed('gh pr list', ran)
    if (ran.exitCode === 0) await $.store.set(key, { at: now, branches, stdout: ran.stdout }).catch(() => undefined)
    return ran.exitCode === 0 ? ran.stdout : ''
  })()
  const prs = readPrs(stdout, at.repo, branches)
  if (prs) sources = { ...sources, prs }
}

/** @param {Engine} $ */
const isShown = async $ => (await $.ui.panes().catch(() => [])).some(pane => pane.id === PANE_ID && pane.isShown)

// One refresh (D3): only while the pane is shown; the files each time, the rest when due or forced. Skipped while
// another runs, never queued.
/** @param {Engine} $ @param {Record<string, unknown>} options @param {boolean} [force] */
const refresh = async ($, options, force = false) => {
  if (isBusy || !(await isShown($))) return
  isBusy = true
  try {
    const at = await placeOf($, options)
    if (at.canRun) {
      const now = await $.clock.now()
      if (force || now - statusAt >= STATUS_EVERY_MS - SLACK_MS) {
        statusAt = now
        await readLanes($, at, options)
      }
      await readFiles($, at, now)
      if (now - prsAt >= PRS_EVERY_MS - SLACK_MS) {
        prsAt = now
        await readPrList($, at, now)
      }
    } else sources = { ...NO_SOURCES }
    errors = [...at.errors, ...Object.values(runErrors).filter(Boolean)]
    refreshedAt = await $.clock.now()
  } catch (error) {
    $.ui.log(`Ather Lanes: the refresh failed: ${String(error)}`, { to: 'debug' })
  } finally {
    isBusy = false
    $.ui.invalidate('ui.render')
  }
}

// The timer runs while the pane is open; each tick does nothing unless the pane is shown.
/** @param {Engine} $ @param {Record<string, unknown>} options */
const ensureTimer = ($, options) => {
  timer ??= $.clock.every(FILES_EVERY_MS, () => void refresh($, options))
}

/** @param {import('claude-code').On} on @param {Record<string, unknown>} options */
export function register(on, options) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lanes', description: 'The machine’s lanes: what needs you, what needs a look, and every lane' }).catch(error => $.ui.log(`Ather Lanes: /lanes not registered: ${String(error)}`, { to: 'debug' }))
    return next(e)
  })

  on('command.run', { command: 'lanes' }, async $ => {
    try {
      await $.ui.open({ id: PANE_ID, title: 'LANES', focus: true, closeOnEscape: true, rows: 24 })
      ensureTimer($, options)
      // After the command returns, so nothing on its path waits for a process.
      $.clock.after(0, () => void refresh($, options, true))
      return { text: 'Lanes opened.' }
    } catch (error) {
      return { text: `Ather Lanes: ${String(error)}` }
    }
  })

  // Closing the pane stops the timer; a failure here never keeps the pane open.
  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    timer?.cancel()
    timer = null
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const el = $.ui.resolve(e)
    try {
      // A module reloaded while its pane stayed up starts its timer again, and reads once, outside this hook.
      if (!timer) {
        ensureTimer($, options)
        if (refreshedAt === null) $.clock.after(0, () => void refresh($, options, true))
      }
      const isDesktop = e.surface !== 'terminal'
      const width = Math.max(40, Number(e.props?.bodyColumns ?? 72))
      const records = laneRecords(sources)
      const board = boardOf(records, sources.slots, counts)
      const view = { width, isDesktop, now: await $.clock.now(), clock: (/** @type {number} */ ms) => new Date(ms).toTimeString().slice(0, 5), opened, isFoldOpen, refreshedAt, errors, slots: sources.slots, counts }
      return drawPane(el, paneLines(board, view), {
        isDesktop,
        onPress: id => {
          if (id === 'refresh') void refresh($, options, true)
          else if (id === 'fold') {
            isFoldOpen = !isFoldOpen
            if (opened.endsWith(':fold')) opened = ''
          } else opened = opened === id.slice('lane:'.length) ? '' : id.slice('lane:'.length)
          $.ui.invalidate('ui.render')
        },
      })
    } catch (error) {
      $.ui.log(`Ather Lanes: the pane failed to draw: ${String(error)}`, { to: 'debug' })
      return el.Text({ children: 'Ather Lanes could not draw. /lanes tries again.' })
    }
  })
}
