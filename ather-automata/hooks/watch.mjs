// @ts-check
// Ather Automata, the silent half: guards that protect work, the autonomy
// window's holds and decision ledger, evidence read from tool output, and the
// tools the model calls. Its only interface is toasts. Every hook passes the
// call on and keeps its own failures to itself, except a held action, which it
// refuses on purpose. Shared state changes only through state.mjs.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import { clampHours, isHolding, mandateText, offAway, windowEndText } from './away.mjs'
import { HELD_LABELS, HELD_NOUNS, briefIssues, explainGuard, gitFolders, heldKindsOf, heldShell, isMergeCommand, isSearchCommand, matchGotchas, mcpServer } from './guards.mjs'
import { STAGE_LABELS, andList, clockText, currentStage, directorCalls, localMinutes, parseIntent, parseTzOffset, prStatusList } from './model.mjs'
import * as state from './state.mjs'
import { recordSpawn, recordTool, resetWorkers } from './workers.mjs'
import { intentChanges, intentFileOf } from './changes.mjs'
import { untrackText } from './home.mjs'

/** @typedef {import('claude-code').EngineInterface} Engine */

const IDLE_MS = 10 * 60 * 1000

let cwd = ''
let briefGate = 'warn'
// Traps already counted in this session: each counts once per session.
const seenTraps = new Set()
// Last tool each worker called, for the idle-worker toast.
const lastTools = new Map()
const idleWarned = new Set()
// When the person last typed a prompt: after an away window has ended, it means they are back.
let lastPersonAt = 0
// When this session started: a with-proof merge counts only proof seen since (D2: "passed in tool output this session").
// A hot reload starts it again, which only makes the rule stricter.
let sessionStartedAt = Date.now()

// The store, files and session as closures: `$` cannot be handed to state.mjs itself.
/** @param {Engine} $ @returns {import('./state.mjs').Io} */
function io($) {
  return {
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    remove: key => $.store.delete(key),
    keys: () => $.store.keys(),
    read: path => $.fs.read(path).then(text => (typeof text === 'string' ? text : null), () => null),
    write: (path, text) => $.fs.write(path, text),
    exists: path => $.fs.exists(path).catch(() => false),
    sessionId: () => $.session.id(),
    root: () => $.session.root(),
    gitUser: async () => ((await $.process.run(['git', 'config', 'user.name'], { cwd: cwd || (await $.session.root()), timeoutMs: 10000 })).stdout ?? '').trim(),
    redraw: () => $.ui.invalidate('ui.render'),
    list: path => $.fs.list(path),
  }
}

/** @param {Engine} $ */
function laneOf($) {
  return state.lane(io($), cwd)
}

/** @param {import('claude-code').On} on @param {import('claude-code').PluginOptions} options */
export function register(on, options) {
  briefGate = String(options?.briefGate ?? 'warn')

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    seenTraps.clear()
    lastTools.clear()
    idleWarned.clear()
    resetWorkers()
    lastPersonAt = 0
    sessionStartedAt = Date.now()
    state.markActive()
    cwd = e.cwd
    try {
      const { me, root, isS2, pack } = await laneOf($)
      await registerTools($, pack)
      await state.migrateRole(io($), me)
      const adopted = isS2 && e.isInteractive ? await state.adoptWindow(io($), { me, root, isAlive: sid => isLaneAlive($, sid) }).catch(() => null) : null
      if (isS2) void state.prune(io($), sid => isLaneGone($, sid)).catch(() => undefined)
      if (adopted) $.ui.toast(adopted.isOver ? 'Ather: welcome back. Your away window has ended; merges stay held until you review it. Type /ather.' : 'Ather: your away window from an earlier session is still running. Type /ather to see it, or /away end.', { timeoutMs: 15000 })
      // The timezone probe starts a process; it must not hold the session's first prompt.
      void detectTz($).catch(() => undefined)
      $.clock.every(30000, () => void tick($).catch(() => undefined))
    } catch (error) {
      $.ui.log(`Ather watch: start failed: ${String(error)}`, { to: 'debug' })
    }
    return result
  })

  // The lane's heartbeat says it has ended, so peers stop listing it at once. After /clear
  // the process goes on under a new session id (no session.start fires): the lane moves to it.
  on('session.end', async ($, e, next) => {
    await heartbeat($, true).catch(() => undefined)
    if (e.reason === 'clear') followClear($, e.sessionId, 25)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Typed at the terminal or the desktop, or sent from a phone over Remote Control: the person is back.
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') lastPersonAt = Date.now()
    // Any prompt, or any tool call below, is the lane's last activity (its heartbeat says when).
    state.markActive()
    return next(e)
  })

  on('tool.call', { tool: 'mcp__ather-automata__status' }, async $ => ({ result: await statusText($) }))
  on('tool.call', { tool: 'mcp__ather-automata__away' }, async ($, e) => ({ result: await awayTool($, /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (e))) }))
  on('tool.call', { tool: 'mcp__ather-automata__profile' }, async ($, e) => ({ result: await profileTool($, /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (e))) }))

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    try {
      const text = (await laneOf($)).isS2 ? await laneText($) : ''
      return text === '' ? result : { ...result, sections: [...result.sections, { id: 'ather-automata:lane', text, scope: /** @type {const} */ ('session') }] }
    } catch {
      return result
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => shell($, e.command, e, next))
  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => shell($, e.command, e, next))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const issues = briefGate === 'off' ? [] : briefIssues(e.prompt, e.subagent_type, (await laneOf($).catch(() => null))?.pack)
    const missing = andList(issues)
    if (issues.length > 0 && briefGate === 'enforce') {
      $.ui.toast(`Ather brief gate: refused a worker brief missing ${missing}.`)
      return { deny: `Ather Automata brief gate: this worker brief is missing ${missing}. Add them (template: .agents/skills/intent/assets/worker-brief.md) and dispatch again.` }
    }
    const ran = await next(e)
    if (issues.length === 0 || ran.deny !== undefined) return ran
    $.ui.toast(`Ather: worker "${e.description}" was briefed without ${missing}.`)
    void state.bump(io($), 'briefsFlagged').catch(() => undefined)
    return { ...ran, context: [...(ran.context ?? []), `Ather Automata: the brief for "${e.description}" did not name ${missing}. If the worker edits files or the Editor, message it the missing parts now.`] }
  })

  // From the start of an away window until its review, the model's questions go to the ledger instead of waiting.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    // Ather's own dialogs are the person answering, never deferred.
    if (next.origin.plugin === $.plugin.name) return next(e)
    const deferred = await state.deferQuestions(io($), e.questions, lastPersonAt).catch(() => null)
    if (deferred === null) return next(e)
    const { ids, away } = deferred
    void state.bump(io($), 'decisionsLedgered').catch(() => undefined)
    $.ui.toast(`Ather: ${ids.join(', ')} recorded for your review instead of waiting.`)
    return {
      deny: `${away.phase === 'review' ? 'The user has not reviewed the away window yet' : `The user is away until ${clockText(away.wakeAt, await state.readTz(io($)))}`} (Ather autonomy window). Do not wait. Take the recommended option for ${ids.join(', ')}, complete ${ids.length === 1 ? 'its entry' : 'their entries'} in ${away.ledgerPath} (Choice, Why, Evidence, Revert), and continue. Exception: if the question is about a destructive, production, credential, cost or CI-global action, do not take it; set the entry's Choice to "parked for the director" and move on to other work.`,
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId) recordSpawn({ agentId: spawned.agentId, subagentType: e.subagentType, prompt: e.prompt, description: e.description, model: spawned.model, at: Date.now() })
    return spawned
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    state.markActive()
    // A worker's tool call: what it is doing now, for its avatar and trail.
    if (e.agentId) recordTool(e.agentId, tool, /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (e)), Date.now())
    const isMcp = tool.startsWith('mcp__') && !tool.startsWith('mcp__ather-automata__')
    const input = JSON.stringify(e).slice(0, 4000)
    if (e.agentId) lastTools.set(e.agentId, { tool, at: Date.now() })
    if (isMcp && (await laneOf($)).pack.isAssetSave(input)) {
      const denied = await hold($, 'asset-save', `${tool} ${input.slice(0, 300)}`).catch(() => null)
      if (denied) return { deny: denied }
    }
    const path = /** @type {{ file_path?: unknown }} */ (e).file_path
    const intent = typeof path === 'string' && /^(Write|Edit|NotebookEdit)$/.test(tool) ? /docs[\\/]intent[\\/]([^\\/]+)[\\/]/.exec(path)?.[1] : undefined
    // The intent this session writes to becomes its tracked one; reading another does not.
    if (intent) void laneOf($).then(({ root }) => state.track(io($), root, intent, { onlyIfNone: true })).catch(() => undefined)
    // An edit to an intent's prompt, findings or progress: what it changed, read off the file before and after.
    const intentFile = /^(Write|Edit|MultiEdit)$/.test(tool) ? intentFileOf(path) : null
    const before = intentFile ? ((await readFile($, String(path))) ?? '') : ''
    const ran = await next(e)
    if (isMcp && ran.deny === undefined) void noteMcp($, tool, input, ran).catch(() => undefined)
    if (intentFile && ran.deny === undefined) void noteIntentEdit($, intentFile, String(path), before).catch(() => undefined)
    return ran
  })
}

// ---------------------------------------------------------------- what an intent edit recorded

/** @param {Engine} $ @param {string} path */
async function readFile($, path) {
  const full = /^([A-Za-z]:|[\\/])/.test(path) ? path : `${(await laneOf($)).root}/${path}`
  return io($).read(full)
}

/** @param {Engine} $ @param {{ slug: string, file: import('./changes.mjs').IntentFile }} target @param {string} path @param {string} before */
async function noteIntentEdit($, target, path, before) {
  const after = (await readFile($, path)) ?? ''
  // The edited file's sibling, as it is now: prompt.md for findings and progress, progress.md for prompt.
  const sibling = async (/** @type {string} */ name) => (await readFile($, path.replace(/[^\\/]+\.md$/i, name))) ?? ''
  const intent = target.file === 'prompt.md' ? { progress: await sibling('progress.md') } : { prompt: await sibling('prompt.md') }
  await state.noteChanges(io($), target.slug, intentChanges(target.file, before, after, intent), Date.now())
}

// ---------------------------------------------------------------- intents and the lane

/** @param {Engine} $ @param {string} slug */
async function readIntent($, slug) {
  const { root, pack } = await laneOf($)
  const dir = `${root}/docs/intent/${slug}`
  const files = io($)
  const prompt = await files.read(`${dir}/prompt.md`)
  if (prompt === null) return undefined
  return parseIntent({
    slug,
    prompt,
    findings: (await files.read(`${dir}/findings.md`)) ?? '',
    progress: (await files.read(`${dir}/progress.md`)) ?? '',
    files: (await $.fs.list(dir).catch(() => [])).map(entry => entry.name),
    hasDebrief: await files.exists(`${root}/${pack.debriefPath(slug)}`),
    mtimeMs: 0,
  }, pack)
}

/** @param {Engine} $ */
// The branch checked out in a folder (null: the session's checkout); '' when it cannot be told.
/** @param {Engine} $ @param {string | null} [folder] */
async function readBranch($, folder = null) {
  const { root } = await laneOf($)
  const base = folder === null ? root : /^([A-Za-z]:[\\/]|[\\/])/.test(folder) ? folder : `${root}/${folder}`
  const files = io($)
  let head = null
  // Walk up to the checkout the folder is in: `cd Plugins/X && git push` pushes the checkout's branch.
  for (let folderAt = base.replace(/[\\/]+$/, ''), depth = 0; head === null && folderAt !== '' && depth < 12; depth += 1) {
    head = await files.read(`${folderAt}/.git/HEAD`)
    if (head === null) {
      // A worktree: .git is a file naming its gitdir.
      const gitdir = /gitdir:\s*(.+)/.exec((await files.read(`${folderAt}/.git`)) ?? '')?.[1]?.trim()
      if (gitdir) head = await files.read(`${gitdir}/HEAD`)
    }
    const parent = folderAt.replace(/[\\/][^\\/]*$/, '')
    folderAt = parent === folderAt ? '' : parent
  }
  return /ref:\s*refs\/heads\/(.+)/.exec(head ?? '')?.[1]?.trim() ?? (head ?? '').trim().slice(0, 12)
}

// The branch each git segment of a command runs on, read before the pure hold check.
/** @param {Engine} $ @param {string} command */
async function branchesFor($, command) {
  const branches = new Map()
  for (const folder of gitFolders(command)) branches.set(folder, await readBranch($, folder).catch(() => ''))
  return (/** @type {string | null} */ folder) => branches.get(folder) ?? ''
}

/** @param {Engine} $ @param {boolean} hasEnded */
async function heartbeat($, hasEnded) {
  const { root, isS2, pack } = await laneOf($)
  if (!isS2) return
  await state.writeHeartbeat(io($), { root, localDir: pack.localDir, branch: await readBranch($), hasEnded })
}

// A session this checkout can vouch has gone: its heartbeat is here and says ended, or is stale.
// A session with no heartbeat here may be alive in another checkout, so it is left alone.
/** @param {Engine} $ @param {string} sid */
async function isLaneGone($, sid) {
  const { root, pack } = await laneOf($)
  const lane = await state.readLane(io($), root, pack.localDir, sid)
  return lane !== null && !state.isLaneLive(lane)
}

// Another session is alive while its heartbeat is fresh and has not said it ended.
/** @param {Engine} $ @param {string} sid */
async function isLaneAlive($, sid) {
  const { root, pack } = await laneOf($)
  const lane = await state.readLane(io($), root, pack.localDir, sid)
  return lane !== null && state.isLaneLive(lane)
}

// Where this session's evidence goes: the tracked intent at its current commit, or the session.
/** @param {Engine} $ */
async function scopeOf($) {
  return state.evidenceScope(io($))
}

/** @param {Engine} $ */
async function peers($) {
  const { root, pack } = await laneOf($)
  return state.readPeers(io($), root, pack.localDir)
}

// What every prompt is told about this lane: the tracked intent, the Editor lock, live peers, the window's mandate.
/** @param {Engine} $ */
async function laneText($) {
  const { root, me, pack } = await laneOf($)
  const lines = []
  const tz = await state.readTz(io($))
  const slug = await state.readPinned(io($))
  const intent = slug ? await readIntent($, slug) : undefined
  if (intent) {
    const { role } = await state.readProfile(io($), me, pack)
    const prs = await state.readPrStates(io($))
    const stage = STAGE_LABELS[currentStage(intent, await state.readEvidence(io($), await state.evidenceScope(io($)), pack), role, prs, pack)]
    lines.push(`Tracked intent: ${intent.slug} (docs/intent/${intent.slug}/), status ${intent.status}, stage ${stage} (Plan, Build, Prove, Ship), checklist ${intent.acceptanceDone}/${intent.acceptanceTotal}${intent.prs.length > 0 ? `, PRs ${prStatusList(intent, prs).join(', ')}` : ''}, open director calls ${directorCalls(intent).length}.`)
  }
  const lock = pack.parseLock(pack.lockFile ? await io($).read(`${root}/${pack.lockFile}`) : null, localMinutes(Date.now(), tz))
  if (lock.state === 'held') lines.push(`Editor owner lock: held by ${lock.holder || 'another lane'}${lock.until ? ` until ${lock.until}` : ''}.`)
  const live = await peers($)
  if (live.length > 0) lines.push(`Live peer lanes on this checkout: ${live.map(lane => `${lane.intent ?? 'no intent'} on ${lane.branch}`).join('; ')}.`)
  const away = await state.readAway(io($))
  if (isHolding(away)) lines.push(mandateText(away, tz, pack))
  return lines.length > 0 ? `Ather Automata lane state (live, read-only):\n${lines.join('\n')}` : ''
}

// While session.end runs the old id is still current: wait for the new one, then move the lane to it.
/** @param {Engine} $ @param {string} oldSid @param {number} tries */
function followClear($, oldSid, tries) {
  $.clock.after(200, () => {
    void $.session
      .id()
      .then(sid => {
        if (sid !== oldSid) return state.moveLane(io($), oldSid, sid)
        if (tries > 0) return followClear($, oldSid, tries - 1)
        $.ui.log('Ather watch: the session id did not change within 5 s of /clear; the lane stays under the old id.', { to: 'debug' })
      })
      .catch(() => undefined)
  })
}

// Every 30 seconds: the heartbeat, quiet workers, and the end of an autonomy window.
/** @param {Engine} $ */
async function tick($) {
  await heartbeat($, false)
  const now = Date.now()
  for (const agent of await $.agent.list().catch(() => [])) {
    const last = lastTools.get(agent.id)
    if (agent.status !== 'running' || !last || now - last.at < IDLE_MS || idleWarned.has(agent.id)) continue
    idleWarned.add(agent.id)
    $.ui.toast(`Ather: worker "${agent.description}" has been quiet for ${Math.round((now - last.at) / 60000)} min after ${last.tool}. Possibly a stuck permission prompt.`)
  }
  // A window ends at its time, or when the session reports the goal done; holds stay until the review.
  const away = await state.readAway(io($))
  if (away.phase === 'running' && now >= away.wakeAt && (await state.endAway(io($)))) $.ui.toast('Ather: the away window has ended; held actions stay held until you review it. Type /ather.', { timeoutMs: 15000 })
}

/** @param {Engine} $ */
async function detectTz($) {
  for (const argv of [['powershell', '-NoProfile', '-Command', "(Get-Date).ToString('zzz')"], ['date', '+%z']]) {
    const run = await $.process.run(argv, { timeoutMs: 15000 }).catch(() => undefined)
    const offset = run && run.exitCode === 0 ? parseTzOffset(run.stdout) : null
    if (offset !== null) return state.setTz(io($), offset)
  }
}

// ---------------------------------------------------------------- the model's tools

// A held action, parked for the person's review; null when no window holds it.
/** @param {Engine} $ @param {import('./guards.mjs').HeldKind} kind @param {string} command */
async function hold($, kind, command) {
  const held = await state.park(io($), kind, command, Date.now())
  if (held === null) return null
  void state.bump(io($), 'heldParked').catch(() => undefined)
  $.ui.toast(`Ather: held ${HELD_NOUNS[kind]} until you review the away window (${held.parked.id}).`)
  return `Held by the Ather away window until the user reviews it: ${HELD_LABELS[kind]}. Recorded as ${held.parked.id}. Do not retry it; continue with other work.`
}

/** @param {Engine} $ @param {Record<string, unknown>} input */
async function awayTool($, input) {
  const action = String(input.action ?? '')
  const tz = await state.readTz(io($))
  if (action === 'start') {
    const { root, me, pack } = await laneOf($)
    const held = Array.isArray(input.held) ? heldKindsOf(pack).filter(kind => /** @type {unknown[]} */ (input.held).includes(kind)) : undefined
    const choice = { hours: clampHours(Number(input.hours) || 8), untilDone: input.untilDone === true, goal: typeof input.goal === 'string' ? input.goal.trim() : '', held }
    const started = await state.startAway(io($), choice, { root, me, tz, now: Date.now(), pack })
    if (started === null) return 'An away window is already running or waiting for the user\'s review.'
    $.ui.toast(`Ather: away window running ${windowEndText(started, tz)}.`)
    return `Autonomy window open ${windowEndText(started, tz)}. Allowed without asking: ${pack.mandate.allowed}. Ledger: ${started.ledgerPath}. Held: ${started.held.map(kind => HELD_LABELS[/** @type {import('./guards.mjs').HeldKind} */ (kind)] ?? kind).join(', ')}. Questions to the user are now recorded in the ledger instead of asked.`
  }
  if (action === 'end') return (await state.endAway(io($))) ? 'Autonomy window ended; the user reviews it with /ather.' : 'No autonomy window is running.'
  if (action === 'close') return (await state.closeAway(io($))) ? 'Autonomy window closed.' : 'No autonomy window to close.'
  return 'Unknown action: use start, end or close.'
}

/** @param {Engine} $ @param {Record<string, unknown>} input */
async function profileTool($, input) {
  const { root, me, pack } = await laneOf($)
  const done = []
  const role = input.role === undefined ? undefined : String(input.role).toLowerCase()
  if (role !== undefined && !pack.roles.includes(role)) return `Unknown role "${role}": use ${pack.roles.join(', ')}.`
  const area = input.area === undefined ? undefined : pack.normalizeArea(String(input.area))
  if (area === 'Unsorted') return `Unknown area "${String(input.area)}": use one of ${pack.areas.join(', ')}.`
  if (role !== undefined || area !== undefined) {
    await state.setProfile(io($), me, { role, area }, pack)
    done.push([role ? `Role set to ${role}.` : '', area ? `Area set to ${area}.` : ''].filter(Boolean).join(' '))
  }
  if (typeof input.track === 'string' && input.track.trim().toLowerCase() === 'none') {
    done.push(untrackText(await state.untrack(io($), me)))
  } else if (typeof input.track === 'string' && input.track.trim() !== '') {
    const slug = input.track.trim()
    if (!(await state.track(io($), root, slug))) return `No intent named "${slug}" in docs/intent.`
    done.push(`This session now tracks intent ${slug}.`)
  }
  return done.join(' ') || 'Nothing to change: pass role, area or track.'
}

/** @param {Engine} $ */
async function statusText($) {
  const { root, me, pack } = await laneOf($)
  const slug = await state.readPinned(io($))
  const intent = slug ? await readIntent($, slug) : undefined
  const { role, area } = await state.readProfile(io($), me, pack)
  const evidence = await state.readEvidence(io($), await state.evidenceScope(io($)), pack)
  const away = await state.readAway(io($))
  const tz = await state.readTz(io($))
  const prs = await state.readPrStates(io($))
  return JSON.stringify(
    {
      me,
      role,
      area,
      tracked: intent
        ? { slug: intent.slug, status: intent.status, stage: STAGE_LABELS[currentStage(intent, evidence, role || 'engineer', prs, pack)], checklist: `${intent.acceptanceDone}/${intent.acceptanceTotal}`, prs: prStatusList(intent, prs), directorCalls: directorCalls(intent).map(one => `${one.id}: ${one.title}`) }
        : null,
      evidence,
      ...(pack.lockFile ? { editorLock: pack.parseLock(await io($).read(`${root}/${pack.lockFile}`), localMinutes(Date.now(), tz)).raw } : {}),
      ...(pack.id === 'unreal' ? {} : { pack: pack.id, gates: pack.gates.map(gate => `${gate.command}: ${gate.proofs.join(', ')}`), mergePolicy: pack.mergePolicy }),
      peers: (await peers($)).map(lane => `${lane.intent ?? 'no intent'} on ${lane.branch}`),
      away: { phase: away.phase, until: away.phase === 'off' ? '' : windowEndText(away, tz), ledger: away.ledgerPath, parked: away.parked.map(one => `${one.id}: ${one.command}`) },
      recurringGotchas: (await state.readRecurring(io($), pack)).map(one => `${one.title} (${one.count} sessions)`),
      caught: await state.readScore(io($)),
    },
    null,
    1,
  )
}

/** @param {Engine} $ @param {import('./packs/index.mjs').Pack} pack */
async function registerTools($, pack) {
  await $.tool.register({
    name: 'status',
    description: `Ather Automata: read the live state of ${pack.statusWhat} as JSON: tracked intent, its stage (Plan, Build, Prove, Ship), director calls, evidence read from tool output, ${pack.lockFile ? 'Editor owner lock' : 'the gates the profile names'}, peer lanes, autonomy window, recurring traps. Read-only.`,
    inputSchema: { type: 'object', properties: {} },
  })
  await $.tool.register({
    name: 'away',
    description:
      'Ather Automata: open, end or close an autonomy window. Open one (action "start") only when the user has said in their own words that they are going away and granting autonomy, for example "I am going to sleep for 8 hours, you have full autonomy". While it runs, questions to the user are written to a decision ledger instead of asked, and held actions are refused and parked for the user\'s review. "end" finishes it early; "close" closes the review.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'end', 'close'] },
        hours: { type: 'number', description: 'Window length in hours (0.25 to 16). Default 8. Ignored with untilDone.' },
        untilDone: { type: 'boolean', description: 'No fixed end: the window runs until the goal is done (call this tool with action "end" then), capped at 24 hours.' },
        goal: { type: 'string', description: 'What to pursue while the user is away, in their words.' },
        held: { type: 'array', items: { type: 'string', enum: heldKindsOf(pack) }, description: `Actions to refuse and park. Default: ${pack.held.defaults.join(', ')}.` },
      },
      required: ['action'],
    },
  })
  await $.tool.register({
    name: 'profile',
    description: "Ather Automata: record the user's role and area when they state them, and which intent this session tracks when they choose one, for example during the Ather tour. The role shapes the next step Ather suggests and what Prove asks for; the area orders the intents Ather offers.",
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: [...pack.roles] },
        ...(pack.areas.length > 0 ? { area: { type: 'string', enum: [...pack.areas] } } : { area: { type: 'string' } }),
        track: { type: 'string', description: 'The folder name of an intent under docs/intent for this session to track, or "none" to stop tracking.' },
      },
    },
  })
}

// ---------------------------------------------------------------- shell and MCP calls

/** @param {Engine} $ @param {string} command @param {any} e @param {any} next */
async function shell($, command, e, next) {
  const away = await state.readAway(io($)).catch(() => offAway())
  const { pack } = isHolding(away) ? await laneOf($) : { pack: null }
  const kind = pack ? heldShell(command, away.held, await branchesFor($, command), pack, { isProven: await isMergeProven($, pack) }) : null
  if (kind) {
    const denied = await hold($, kind, command).catch(() => null)
    if (denied) return { deny: denied }
  }
  const ran = await next(e)
  try {
    const context = await afterShell($, command, ran)
    return context.length > 0 && ran.deny === undefined ? { ...ran, context: [...(ran.context ?? []), ...context] } : ran
  } catch {
    return ran
  }
}

// With-proof merges (D2): every rung the profile requires passed in tool output in this session.
/** @param {Engine} $ @param {import('./packs/index.mjs').Pack} pack */
async function isMergeProven($, pack) {
  if (pack.mergePolicy !== 'with-proof') return false
  const evidence = await state.readEvidence(io($), await scopeOf($), pack)
  const rungs = pack.mergeRungs ?? []
  const seen = /** @type {Record<string, { state: string, at?: number }>} */ (evidence)
  return rungs.length > 0 && rungs.every(rung => seen[rung]?.state === 'pass' && (seen[rung]?.at ?? 0) >= sessionStartedAt)
}

/** @param {Engine} $ @param {string} command @param {{ text?: string, deny?: string, isError?: boolean }} ran */
async function afterShell($, command, ran) {
  const context = []
  const text = ran.text ?? ''
  const { pack } = await laneOf($)
  if (!isSearchCommand(command)) await noteTraps($, text, pack)
  const guard = explainGuard(command)
  if (guard !== null && (ran.deny !== undefined || ran.isError === true)) $.ui.toast(`Ather guard: ${guard}`, { timeoutMs: 12000 })
  const reading = pack.readShell(command, text, ran)
  for (const one of reading.rungs) await state.setRung(io($), await scopeOf($), one.rung, one.value)
  context.push(...reading.context)
  for (const toast of reading.toasts) $.ui.toast(toast.text, toast.timeoutMs === undefined ? undefined : { timeoutMs: toast.timeoutMs })
  for (const key of reading.bumps) void state.bump(io($), key).catch(() => undefined)
  if (isMergeCommand(command) && ran.deny === undefined && ran.isError !== true) {
    const lost = await auditMerge($).catch(() => [])
    if (lost.length > 0) {
      await state.flagLost(io($), lost)
      void state.bump(io($), 'lostWorkFlags').catch(() => undefined)
      $.ui.toast(`Ather: the merge kept the other side of ${lost.length} binary asset(s); this branch's edits to them are gone.`, { timeoutMs: 15000 })
      context.push(`Ather Automata merge audit: these binary assets are byte-identical to the merged-in side, so every edit this branch made to them is gone: ${lost.join(', ')}. Tell the user now, itemised, and mark each as a lost optimisation or a broken feature.`)
    }
  }
  return context
}

/** @param {Engine} $ @param {string} text @param {import('./packs/index.mjs').Pack} pack */
async function noteTraps($, text, pack) {
  const fresh = matchGotchas(text, pack).filter(rule => !seenTraps.has(rule.id))
  if (fresh.length === 0) return
  for (const rule of fresh) {
    seenTraps.add(rule.id)
    $.ui.toast(`Ather gotcha: ${rule.title}. ${rule.fix}`, { timeoutMs: 10000 })
  }
  await state.countTraps(io($), fresh)
}

/** @param {Engine} $ @param {string} tool @param {string} input @param {{ text?: string, isError?: boolean }} ran */
async function noteMcp($, tool, input, ran) {
  const { pack } = await laneOf($)
  const kind = pack.mcpKind(input)
  if (kind) await state.noteMcp(io($), await scopeOf($), kind, mcpServer(tool), ran.isError !== true)
  await noteTraps($, ran.text ?? '', pack)
}

// After a merge: binary assets byte-identical to the merged-in side lost this branch's edits.
/** @param {Engine} $ */
async function auditMerge($) {
  const { root, pack } = await laneOf($)
  const binary = pack.binaryAssets
  if (!binary) return []
  const git = (/** @type {string[]} */ args) => $.process.run(['git', '-C', root, ...args], { env: { GIT_OPTIONAL_LOCKS: '0' }, timeoutMs: 30000 })
  const [, ours = '', theirs = ''] = (await git(['rev-list', '--parents', '-n', '1', 'HEAD'])).stdout.trim().split(/\s+/)
  if (theirs === '') return []
  const base = (await git(['merge-base', ours, theirs])).stdout.trim()
  if (base === '') return []
  const touched = (await git(['diff', '--name-only', base, ours])).stdout.split(/\r?\n/).filter(path => binary.test(path)).slice(0, 300)
  if (touched.length === 0) return []
  const blobs = async (/** @type {string} */ rev) => {
    const map = new Map()
    for (let i = 0; i < touched.length; i += 50) {
      for (const line of (await git(['ls-tree', rev, '--', ...touched.slice(i, i + 50)])).stdout.split(/\r?\n/)) {
        const match = /^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/.exec(line)
        if (match?.[1] && match[2]) map.set(match[2], match[1])
      }
    }
    return map
  }
  const [merged, mine, other] = await Promise.all([blobs('HEAD'), blobs(ours), blobs(theirs)])
  return touched.filter(path => merged.get(path) !== undefined && merged.get(path) === other.get(path) && merged.get(path) !== mine.get(path))
}
