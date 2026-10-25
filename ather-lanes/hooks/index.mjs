// @ts-check
// Ather Lanes: the engine half. /lanes (or the lanes_open tool) opens the pane. One 30-second timer, started on a
// lanes machine at session start: while the pane is shown (D3) each tick reads the slot and heartbeat files, and
// every 2 minutes (and on r) runs lanes.ps1 Status, the one for-each-ref and reads the lanes' intents; gh at most
// every 5 minutes, its answer kept in the store for any session. While the pane is closed (D8) a tick at most once a
// minute reads files only, no process: the sidecars, the lanes folder's one listing, the slots, heartbeats and
// intents, with the git and gh figures of the last full read kept in the store. The status line and the
// lanes_summary tool (D9) say what those reads left. One process at a time: a run that comes due while one runs is
// skipped. Read-only: the mod writes only its own store (Status' own stale-sidecar move aside, README). It hooks no
// tool call but its own two tools', no prompt or turn, and a draw only reads what the last refresh left.
// Everything here catches its own failures: the pane says what it could not read and draws the rest.

import { unreal } from './ather/packs/unreal.mjs'
import { GIT_ENV } from './ather/team.mjs'
import { checkoutOf, gitDirOf, normalFolder } from './ather/workspace.mjs'
import { boardOf, lineText, sectionOf, summaryText } from './board.mjs'
import { drawPane, paneLines } from './pane.mjs'
import { NO_SOURCES, beatsOf, fullData, fullOf, intentOf, laneBranches, laneOf, laneRecords, statusOfFiles } from './records.mjs'
import { REF_FORMAT, folderKey, laneZeroOf, prListArgs, readOrigin, readPrs, readRefs, readReflogTime, readSidecar, readSlot, readStatus } from './sources.mjs'

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {import('./records.mjs').Sources} Sources
 * @typedef {import('./sources.mjs').Status} Status
 * @typedef {import('./pane.mjs').Opened} Opened
 * @typedef {import('./pane.mjs').Press} Press
 * @typedef {{ root: string, main: string, lanesRoot: string, machineDir: string, scriptsDir: string, repo: string, isMachine: boolean, errors: string[] }} Place
 *   the session's checkout and lane 0, the lanes and machine folders and the scripts; `isMachine`: a checkout with a
 *   machine folder, so a lanes machine; `errors`: what could not be found (empty: Status may run)
 * @typedef {import('./records.mjs').Full} Full
 */

const PANE_ID = 'lanes'
const SUMMARY_TOOL = 'lanes_summary'
const OPEN_TOOL = 'lanes_open'
const TICK_MS = 30 * 1000
const CLOSED_EVERY_MS = 60 * 1000
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
let filesAt = -Infinity
// When the pane was last refreshed; null before the first.
/** @type {number | null} */
let refreshedAt = null
/** @type {Full | null} */
let full = null
let isBusy = false
/** @type {Record<string, string>} */
let runErrors = {}
/** @type {import('claude-code').Timer | null} */
let timer = null
/** @type {Opened | null} */
let opened = null
let isFoldOpen = false
/** @type {string | undefined} the status line as last set */
let shownLine

/** @param {Engine} $ @param {string} path */
const read = ($, path) => $.fs.read(path).then(text => (typeof text === 'string' ? text : null), () => null)
/** @param {Engine} $ @param {string} path */
const exists = ($, path) => $.fs.exists(path).catch(() => false)
/** @param {Engine} $ @param {string} path */
const list = ($, path) => $.fs.list(path).catch(() => [])
/** @param {string} path */
const parentOf = path => path.replace(/\/[^/]*$/, '')
/** @param {number} ms */
const clockText = ms => new Date(ms).toTimeString().slice(0, 5)

// Where the lanes are, from files alone (no process): the checkout the session runs in and lane 0 (Ather's
// workspace.mjs), the lanes folder beside lane 0 (as lanes.ps1 finds it), the machine folder and the scripts (D6).
/** @param {Engine} $ @param {Record<string, unknown>} options @returns {Promise<Place>} */
const placeOf = async ($, options) => {
  const files = { read: (/** @type {string} */ path) => read($, path), exists: (/** @type {string} */ path) => exists($, path) }
  const root = await checkoutOf(files, await $.session.root())
  if (root === null) return { root: '', main: '', lanesRoot: '', machineDir: '', scriptsDir: '', repo: '', isMachine: false, errors: [NOT_HERE] }
  const main = laneZeroOf((await gitDirOf(files, root)) ?? `${root}/.git`)
  const lanesRoot = `${parentOf(main)}/lanes`
  const machineDir = normalFolder(String(options.machineDir ?? '')) || `${lanesRoot}/_machine`
  const scriptsDir = normalFolder(String(options.scriptsDir ?? '')) || `${root}/.agents/skills/s2-agent-lanes/scripts`
  // Status would create the machine folder: the mod never runs it where there is none (D6).
  const isMachine = await exists($, machineDir)
  const errors = []
  if (!(await exists($, `${scriptsDir}/lanes.ps1`))) errors.push(`No lanes.ps1 in ${scriptsDir}: set Ather Lanes' scriptsDir to the S2 lane scripts.`)
  if (!isMachine) errors.push(`No machine folder at ${machineDir}, so no lanes here.`)
  return { root, main, lanesRoot, machineDir, scriptsDir, repo: readOrigin(await read($, `${main}/.git/config`)), isMachine, errors }
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

// D2.5: each registered lane's intent, from its own docs/intent folder.
/** @param {Engine} $ @param {Status} status */
const readIntents = async ($, status) => {
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
  await readIntents($, status)
}

// D8, the pane closed: the lanes from files alone (records.mjs statusOfFiles), no process. The sidecars, the lanes
// folder's one listing (a folder with a `.git` in it is a worktree), the last full read in the store (any session's,
// read again each time) for the rest and for its git and gh figures; then each registered lane's intent.
/** @param {Engine} $ @param {Place} at */
const readLaneFiles = async ($, at) => {
  full = fullOf(await $.store.get(fullKey(at)).catch(() => undefined)) ?? full
  const [sidecarFiles, entries] = await Promise.all([list($, `${at.machineDir}/lanes`), list($, at.lanesRoot)])
  const sidecars = (await Promise.all(sidecarFiles.filter(one => one.kind === 'file' && one.name.endsWith('.json')).map(one => read($, `${at.machineDir}/lanes/${one.name}`)))).map(readSidecar)
  const folders = entries.filter(one => one.kind === 'dir' && folderKey(`${at.lanesRoot}/${one.name}`) !== folderKey(at.machineDir))
  const worktrees = await Promise.all(folders.map(async one => ((await exists($, `${at.lanesRoot}/${one.name}/.git`)) ? one.name : '')))
  const status = statusOfFiles({ kept: full?.status ?? null, main: at.main, lanesRoot: at.lanesRoot, machineDir: at.machineDir, sidecars: sidecars.filter(one => one !== null), entries: worktrees.filter(Boolean) })
  sources = { ...sources, status, refs: full?.refs ?? sources.refs, prs: full?.prs ?? sources.prs }
  await readIntents($, status)
}

/** @param {Place} at */
const fullKey = at => `full:${folderKey(at.main)}`

// The full read just made, kept for the closed pane and for other sessions (records.mjs fullData).
/** @param {Engine} $ @param {Place} at @param {number} now */
const keepFull = async ($, at, now) => {
  if (!sources.status) return
  full = { at: now, status: sources.status, refs: sources.refs, prs: sources.prs }
  await $.store.set(fullKey(at), fullData(full)).catch(() => undefined)
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

// The board from what the last refresh left, this session's lane marked (D10).
const currentBoard = () => boardOf(laneRecords(sources), sources.slots, laneOf(sources.status, place?.root ?? ''))

// The status line (D8): set when it changes; none off a lanes machine.
/** @param {Engine} $ */
const showLine = $ => {
  const text = place?.isMachine ? lineText(currentBoard()) : undefined
  if (text === shownLine) return
  shownLine = text
  $.ui.status(text)
}

// The pane shown, with the scripts (D3): Status when due, the files each time, gh when due, the full read kept.
// Until a Status run gives the lanes, they are read from files as the closed pane reads them.
/** @param {Engine} $ @param {Place} at @param {Record<string, unknown>} options @param {number} now @param {boolean} isStatusDue */
const readShown = async ($, at, options, now, isStatusDue) => {
  if (isStatusDue) {
    statusAt = now
    await readLanes($, at, options)
  }
  if (sources.status === null) await readLaneFiles($, at)
  await readFiles($, at, now)
  const isPrsDue = now - prsAt >= PRS_EVERY_MS - SLACK_MS
  if (isPrsDue) {
    prsAt = now
    await readPrList($, at, now)
  }
  if (isStatusDue || isPrsDue) await keepFull($, at, now)
}

// The pane closed, or shown without the scripts (D8): files only, no process.
/** @param {Engine} $ @param {Place} at @param {number} now */
const readClosed = async ($, at, now) => {
  await readLaneFiles($, at)
  await readFiles($, at, now)
}

// One refresh: shown with the scripts, readShown; else readClosed, at most once a minute while closed. The lanes are
// found again (files only) for each closed read and when Status is due, so a machine folder that went away stops
// every read. Skipped while another runs.
/** @param {Engine} $ @param {Record<string, unknown>} options @param {boolean} [force] */
const refresh = async ($, options, force = false) => {
  if (isBusy) return
  isBusy = true
  let isRead = false
  try {
    const now = await $.clock.now()
    const isOpen = await isShown($)
    if (!isOpen && now - filesAt < CLOSED_EVERY_MS - SLACK_MS) return
    isRead = true
    const isStatusDue = force || now - statusAt >= STATUS_EVERY_MS - SLACK_MS
    if (!isOpen || isStatusDue || place === null) place = await placeOf($, options)
    if (!place.isMachine) {
      sources = { ...NO_SOURCES }
      runErrors = {}
    } else if (isOpen && place.errors.length === 0) await readShown($, place, options, now, isStatusDue)
    else await readClosed($, place, now)
    filesAt = now
    refreshedAt = await $.clock.now()
  } catch (error) {
    $.ui.log(`Ather Lanes: the refresh failed: ${String(error)}`, { to: 'debug' })
  } finally {
    isBusy = false
    if (isRead) {
      showLine($)
      $.ui.invalidate('ui.render')
    }
  }
}

// The one timer; each tick decides what is due.
/** @param {Engine} $ @param {Record<string, unknown>} options */
const ensureTimer = ($, options) => {
  timer ??= $.clock.every(TICK_MS, () => void refresh($, options))
}

// /lanes and lanes_open: the pane opened, read at once after the caller returns (nothing on its path waits for a
// process).
/** @param {Engine} $ @param {Record<string, unknown>} options */
const openPane = async ($, options) => {
  const shown = await $.ui.open({ id: PANE_ID, title: 'LANES', focus: true, closeOnEscape: true, rows: 24 })
  ensureTimer($, options)
  $.clock.after(0, () => void refresh($, options, true))
  return shown
}

// lanes_open (D9): the pane, and a lane opened in place from the first section that lists it.
/** @param {Engine} $ @param {Record<string, unknown>} options @param {string} name */
const openTool = async ($, options, name) => {
  const shown = await openPane($, options)
  let said = 'Lanes opened.'
  if (name !== '') {
    const from = sectionOf(currentBoard(), name)
    opened = from === null ? null : { name, from }
    // A lane listed only in the fold opens it; an unknown one leaves the pane folded (D9).
    isFoldOpen = from === 'fold' || (from !== null && isFoldOpen)
    said = from === null ? `No lane named ${name} here; Lanes opened, folded.` : `Lanes opened, with ${name} open in place.`
    $.ui.invalidate('ui.render')
  }
  return shown.isPlaced ? said : `${said} It waits for room on screen: /lanes places it.`
}

// lanes_summary (D9): closed, the files are read first (at most once a minute, no process); shown, what the pane has.
/** @param {Engine} $ @param {Record<string, unknown>} options */
const summaryTool = async ($, options) => {
  if (!(await isShown($))) await refresh($, options)
  if (!place?.isMachine) return place?.errors.at(-1) ?? NOT_HERE
  return summaryText(currentBoard(), { now: await $.clock.now(), readAt: full?.at ?? null, clock: clockText })
}

/** @param {Engine} $ */
const registerTools = async $ => {
  await $.tool.register({
    name: SUMMARY_TOOL,
    description: "Ather Lanes: which S2 agent lane this session is in (name, branch, intent, tier, slot, PR) and what on this machine's lanes waits for the user (For you: decisions) or needs a look (A look: failing checks, far behind main, slots, unregistered). Read-only text.",
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  })
  await $.tool.register({
    name: OPEN_TOOL,
    description: 'Ather Lanes: open the Lanes pane beside the chat, as /lanes does, for the user to see the lanes; with `lane`, that lane opened in place. Read-only.',
    inputSchema: { type: 'object', properties: { lane: { type: 'string', description: 'A lane to open in place, by its name' } } },
    isDeferred: false,
  })
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

// A tool hook that failed answers the call with what went wrong, never leaves it unanswered.
/** @param {Engine} $ @param {unknown} e @param {{ error: unknown }} next */
const failedTool = ($, e, next) => ({ result: `Ather Lanes could not answer: ${String(next.error)}` })

/** @param {import('claude-code').On} on @param {Record<string, unknown>} options */
export function register(on, options) {
  // On a lanes machine (files only): the tools, the timer, and one closed read after the start returns (D8).
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lanes', description: 'The machine’s lanes: what needs you, what needs a look, and every lane' }).catch(error => $.ui.log(`Ather Lanes: /lanes not registered: ${String(error)}`, { to: 'debug' }))
    try {
      place = await placeOf($, options)
      if (place.isMachine) {
        await registerTools($)
        ensureTimer($, options)
        $.clock.after(0, () => void refresh($, options))
      }
    } catch (error) {
      $.ui.log(`Ather Lanes: not started: ${String(error)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('command.run', { command: 'lanes' }, async $ => {
    try {
      await openPane($, options)
      return { text: 'Lanes opened.' }
    } catch (error) {
      return { text: `Ather Lanes: ${String(error)}` }
    }
  })

  // The two tools' own names only, so these hooks never see another tool's call (F-12). A failure answers in words.
  on('tool.call', { tool: 'mcp__ather-lanes__lanes_summary' }, async $ => ({ result: await summaryTool($, options) })).catch(failedTool)
  on('tool.call', { tool: 'mcp__ather-lanes__lanes_open' }, async ($, e) => {
    const input = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (e))
    return { result: await openTool($, options, typeof input.lane === 'string' ? input.lane.trim() : '') }
  }).catch(failedTool)

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const el = $.ui.resolve(e)
    try {
      // A module reloaded while its pane stayed up starts its timer again, and reads once, outside this hook.
      if (!timer) {
        ensureTimer($, options)
        if (refreshedAt === null) $.clock.after(0, () => void refresh($, options, true))
      }
      const isDesktop = e.surface !== 'terminal'
      const errors = [...(place?.errors ?? []), ...Object.values(runErrors).filter(Boolean)]
      const view = { width: Math.max(40, Number(e.props?.bodyColumns ?? 72)), isDesktop, now: await $.clock.now(), clock: clockText, opened, isFoldOpen, refreshedAt, errors }
      return drawPane(el, paneLines(currentBoard(), view), { isDesktop, onPress: press => onPress($, options, press) })
    } catch (error) {
      $.ui.log(`Ather Lanes: the pane failed to draw: ${String(error)}`, { to: 'debug' })
      return el.Text({ children: 'Ather Lanes could not draw. /lanes tries again.' })
    }
  })
}
