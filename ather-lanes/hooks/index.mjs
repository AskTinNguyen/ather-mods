// @ts-check
// Ather Lanes: the engine half. /lanes opens the pane; while it is shown (and only then, D3) a 30-second timer reads
// the slot and heartbeat files, and every 2 minutes (and on r) finds the lanes again (files only), runs lanes.ps1
// Status, the one for-each-ref and reads the lanes' intents; gh at most every 5 minutes, its answer kept in the store
// for any session. One process at a time: a run that comes due while one runs is skipped. Read-only: the mod writes
// only its own store (Status' own stale-sidecar move aside, README). It hooks no tool call, prompt or turn, and a draw
// only reads what the last refresh left. Everything here catches its own failures: the pane says what it could not
// read and draws the rest.

import { unreal } from './ather/packs/unreal.mjs'
import { GIT_ENV } from './ather/team.mjs'
import { checkoutOf, gitDirOf, normalFolder } from './ather/workspace.mjs'
import { boardOf } from './board.mjs'
import { drawPane, paneLines } from './pane.mjs'
import { NO_SOURCES, beatsOf, intentOf, laneBranches, laneRecords } from './records.mjs'
import { REF_FORMAT, laneZeroOf, prListArgs, readOrigin, readPrs, readRefs, readReflogTime, readSlot, readStatus } from './sources.mjs'

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {import('./records.mjs').Sources} Sources
 * @typedef {import('./pane.mjs').Opened} Opened
 * @typedef {import('./pane.mjs').Press} Press
 * @typedef {{ root: string, main: string, machineDir: string, scriptsDir: string, repo: string, errors: string[] }} Place
 *   the session's checkout and lane 0, the machine folder and the scripts, and what of them could not be found
 *   (`errors` empty: Status may run)
 */

const PANE_ID = 'lanes'
const FILES_EVERY_MS = 30 * 1000
const STATUS_EVERY_MS = 2 * 60 * 1000
const PRS_EVERY_MS = 5 * 60 * 1000
// A timer tick lands a little early or late: a read due within this much of its time runs on this tick, not the next.
const SLACK_MS = 5 * 1000
const NOT_HERE = 'This session is not in a git checkout, so there are no lanes to read. Open it in an S2 checkout or a lane.'

/** @type {{ -readonly [K in keyof Sources]: Sources[K] }} */
let sources = { ...NO_SOURCES }
/** @type {Place | null} */
let place = null
// When each source was last asked for; -Infinity: never, so the first refresh asks for all.
let statusAt = -Infinity
let prsAt = -Infinity
// When the pane was last refreshed; null before the first.
/** @type {number | null} */
let refreshedAt = null
let isBusy = false
/** @type {Record<string, string>} */
let runErrors = {}
/** @type {import('claude-code').Timer | null} */
let timer = null
/** @type {Opened | null} */
let opened = null
let isFoldOpen = false

/** @param {Engine} $ @param {string} path */
const read = ($, path) => $.fs.read(path).then(text => (typeof text === 'string' ? text : null), () => null)
/** @param {Engine} $ @param {string} path */
const exists = ($, path) => $.fs.exists(path).catch(() => false)
/** @param {Engine} $ @param {string} path */
const list = ($, path) => $.fs.list(path).catch(() => [])
/** @param {string} path */
const parentOf = path => path.replace(/\/[^/]*$/, '')

// Where the lanes are, from files alone (no process): the checkout the session runs in and lane 0 (Ather's
// workspace.mjs), the machine folder and the scripts (D6). What is missing is said.
/** @param {Engine} $ @param {Record<string, unknown>} options @returns {Promise<Place>} */
const placeOf = async ($, options) => {
  const files = { read: (/** @type {string} */ path) => read($, path), exists: (/** @type {string} */ path) => exists($, path) }
  const root = await checkoutOf(files, await $.session.root())
  if (root === null) return { root: '', main: '', machineDir: '', scriptsDir: '', repo: '', errors: [NOT_HERE] }
  const main = laneZeroOf((await gitDirOf(files, root)) ?? `${root}/.git`)
  const machineDir = normalFolder(String(options.machineDir ?? '')) || `${parentOf(main)}/lanes/_machine`
  const scriptsDir = normalFolder(String(options.scriptsDir ?? '')) || `${root}/.agents/skills/s2-agent-lanes/scripts`
  const errors = []
  if (!(await exists($, `${scriptsDir}/lanes.ps1`))) errors.push(`No lanes.ps1 in ${scriptsDir}: set Ather Lanes' scriptsDir to the S2 lane scripts.`)
  // Status would create the machine folder: the mod never runs it where there is none (D6).
  if (!(await exists($, machineDir))) errors.push(`No machine folder at ${machineDir}, so no lanes here.`)
  return { root, main, machineDir, scriptsDir, repo: readOrigin(await read($, `${main}/.git/config`)), errors }
}

// One process, logged to the debug log so its runs can be counted (A4).
/** @param {Engine} $ @param {readonly string[]} argv @param {string} cwd @param {string} what */
const run = async ($, argv, cwd, what) => {
  $.ui.log(`Ather Lanes: spawn ${what}`, { to: 'debug' })
  return $.process.run(argv, { cwd, env: GIT_ENV, timeoutMs: 60000 }).catch(error => ({ exitCode: -1, stdout: '', stderr: String(error) }))
}

/** @param {string} what @param {{ exitCode: number, stderr: string }} ran */
const failed = (what, ran) => `${what} gave nothing to read (exit ${ran.exitCode}): ${(ran.stderr || '').trim().split(/\r?\n/)[0] ?? ''}`

/** @param {string} path */
const windows = path => path.replace(/\//g, '\\')

// The files of D2.2 and the reflog, no process: slots, lane and session heartbeats.
/** @param {Engine} $ @param {Place} at @param {number} now */
const readFiles = async ($, at, now) => {
  const machineDir = normalFolder(sources.status?.machineDir || at.machineDir)
  const minutes = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const lanes = sources.status?.lanes ?? []
  const [slotFiles, beatFiles] = await Promise.all([list($, `${machineDir}/slots`), list($, `${machineDir}/heartbeats`)])
  const beatNames = new Set(beatFiles.map(one => one.name))
  const [slots, laneTexts, sessionTexts, reflog] = await Promise.all([
    Promise.all(slotFiles.filter(one => one.kind === 'file' && one.name.endsWith('.txt')).map(async one => readSlot(one.name.replace(/\.txt$/, ''), await read($, `${machineDir}/slots/${one.name}`), minutes))),
    Promise.all(lanes.filter(lane => beatNames.has(`${lane.name}.json`)).map(async lane => /** @type {const} */ ([lane.name, await read($, `${machineDir}/heartbeats/${lane.name}.json`)]))),
    Promise.all(
      lanes
        .filter(lane => !lane.missing && lane.path)
        .map(async lane => {
          const dir = `${normalFolder(lane.path)}/${unreal.localDir}/lanes`
          const texts = await Promise.all((await list($, dir)).filter(one => one.name.endsWith('.json')).map(one => read($, `${dir}/${one.name}`)))
          return /** @type {const} */ ([lane.path, texts])
        }),
    ),
    read($, `${at.main}/.git/logs/refs/remotes/origin/main`),
  ])
  sources = { ...sources, slots: slots.filter(one => one !== null), ...beatsOf(sources.status, new Map(laneTexts), new Map(sessionTexts)), mainMovedAt: readReflogTime(reflog) }
}

// D2.1, D2.3 and D2.5: Status, the one for-each-ref over the lane branches, and each registered lane's intent.
/** @param {Engine} $ @param {Place} at @param {Record<string, unknown>} options */
const readLanes = async ($, at, options) => {
  const machine = options.machineDir ? ['-MachineDir', windows(at.machineDir)] : []
  const ran = await run($, ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windows(`${at.scriptsDir}/lanes.ps1`), '-Action', 'Status', '-Json', '-Repo', windows(at.root), ...machine], at.root, 'powershell lanes.ps1 -Action Status')
  const status = readStatus(ran.stdout)
  runErrors.status = status ? '' : failed('lanes.ps1 -Action Status', ran)
  if (!status) return
  sources = { ...sources, status }
  const branches = laneBranches(status)
  if (branches.length > 0) {
    const refs = await run($, ['git', '-C', at.main, 'for-each-ref', `--format=${REF_FORMAT}`, ...branches.map(branch => `refs/heads/${branch}`)], at.main, 'git for-each-ref')
    runErrors.refs = refs.exitCode === 0 ? '' : failed('git for-each-ref', refs)
    if (refs.exitCode === 0) sources = { ...sources, refs: readRefs(refs.stdout) }
  }
  const registered = status.lanes.filter(one => one.sidecar === 'registered' && one.intent && !one.missing)
  const intents = await Promise.all(
    registered.map(async lane => {
      const dir = `${normalFolder(lane.path)}/docs/intent/${lane.intent}`
      const [prompt, progress, findings] = await Promise.all(['prompt.md', 'progress.md', 'findings.md'].map(name => read($, `${dir}/${name}`)))
      return /** @type {const} */ ([lane.name, intentOf(lane.intent, { prompt, progress, findings })])
    }),
  )
  sources = { ...sources, intents: new Map(intents) }
}

// gh's answer for some lane branches: the one another session kept in the last 5 minutes, else one gh run from the
// machine folder (outside any checkout), kept for the next.
/** @param {Engine} $ @param {Place} at @param {string[]} branches @param {number} now */
const ghPrs = async ($, at, branches, now) => {
  const key = `prs:${at.repo}`
  const kept = /** @type {{ at: number, branches: string[], stdout: string } | undefined} */ (await $.store.get(key).catch(() => undefined))
  if (kept && now - kept.at < PRS_EVERY_MS && branches.every(branch => kept.branches.includes(branch))) return kept.stdout
  const ran = await run($, ['gh', ...prListArgs(at.repo, branches)], at.machineDir, 'gh pr list')
  runErrors.prs = ran.exitCode === 0 ? '' : failed('gh pr list', ran)
  if (ran.exitCode !== 0) return ''
  await $.store.set(key, { at: now, branches, stdout: ran.stdout }).catch(() => undefined)
  return ran.stdout
}

// D2.4: the lane branches' PRs; none to ask for without a GitHub origin or a lane branch.
/** @param {Engine} $ @param {Place} at @param {number} now */
const readPrList = async ($, at, now) => {
  const branches = laneBranches(sources.status, { forPrs: true })
  const prs = at.repo && branches.length > 0 ? readPrs(await ghPrs($, at, branches, now), at.repo, branches) : new Map()
  if (prs) sources = { ...sources, prs }
}

/** @param {Engine} $ */
const isShown = async $ => (await $.ui.panes().catch(() => [])).some(pane => pane.id === PANE_ID && pane.isShown)

// One refresh (D3): only while the pane is shown. When Status is due (or forced) the lanes are found again first, so
// a machine folder that went away stops every process; the files each time; gh when due. Skipped while another runs.
/** @param {Engine} $ @param {Record<string, unknown>} options @param {boolean} [force] */
const refresh = async ($, options, force = false) => {
  if (isBusy || !(await isShown($))) return
  isBusy = true
  try {
    const now = await $.clock.now()
    const isStatusDue = force || place === null || now - statusAt >= STATUS_EVERY_MS - SLACK_MS
    if (isStatusDue) place = await placeOf($, options)
    const at = /** @type {Place} */ (place)
    if (at.errors.length > 0) {
      sources = { ...NO_SOURCES }
      runErrors = {}
    } else {
      if (isStatusDue) {
        statusAt = now
        await readLanes($, at, options)
      }
      await readFiles($, at, now)
      if (now - prsAt >= PRS_EVERY_MS - SLACK_MS) {
        prsAt = now
        await readPrList($, at, now)
      }
    }
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

// A press: ↻ reads again now; the fold opens or closes (and with it a lane opened from it); a lane opens in place,
// or closes when it was the one open there.
/** @param {Engine} $ @param {Record<string, unknown>} options @param {Press} press */
const onPress = ($, options, press) => {
  if (press.kind === 'refresh') void refresh($, options, true)
  else if (press.kind === 'fold') {
    isFoldOpen = !isFoldOpen
    if (opened?.from === 'fold') opened = null
  } else opened = opened?.name === press.lane.name && opened.from === press.lane.from ? null : press.lane
  $.ui.invalidate('ui.render')
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
      const board = boardOf(laneRecords(sources), sources.slots)
      const errors = [...(place?.errors ?? []), ...Object.values(runErrors).filter(Boolean)]
      const view = { width: Math.max(40, Number(e.props?.bodyColumns ?? 72)), isDesktop, now: await $.clock.now(), clock: (/** @type {number} */ ms) => new Date(ms).toTimeString().slice(0, 5), opened, isFoldOpen, refreshedAt, errors }
      return drawPane(el, paneLines(board, view), { isDesktop, onPress: press => onPress($, options, press) })
    } catch (error) {
      $.ui.log(`Ather Lanes: the pane failed to draw: ${String(error)}`, { to: 'debug' })
      return el.Text({ children: 'Ather Lanes could not draw. /lanes tries again.' })
    }
  })
}
