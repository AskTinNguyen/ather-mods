// @ts-check
// Ather Automata, the visible half: what needs me, and what is next.
//
// Terminal: a one-line hint above the prompt, only when something needs you;
// /ather opens one pane. Desktop (no drawing surface): /ather asks one question,
// never a loop. Either way, picking something hands it to the session, which
// asks its own questions. Shared state changes only through state.mjs.
//
// The host reads on(...) and $.noun.method(...) from source, so they are
// spelled literally, and helpers that take $ are top-level functions.

import { ALLOWED_TEXT, AWAY_PRESETS, isStopWord, parseAwayArgs, windowEndText } from './away.mjs'
import { CREATE_SHOWN, skillFolder, askPrompt, batchPrompt, buildHome, parseWeek } from './home.mjs'
import { issuePrompt, parseIssues } from './issues.mjs'
import { parsePrState, prsToRead } from './prs.mjs'
import { clockText, closestWord, localMinutes, parseIntent, searchIntents, sessionTitle } from './model.mjs'
import { unreal } from './packs/unreal.mjs'
import * as state from './state.mjs'
import { KINDS, PROP_WORDS, STATE_COLOURS, STATE_GLYPHS, avatarSvg, classifyWorker, modelWord, propSvg, trailWords, workerState } from './squad.mjs'
import { recordEnd, workerOf } from './workers.mjs'
import { changeGlyph } from './changes.mjs'

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {ReturnType<typeof buildHome>} Home */
/** @typedef {import('./home.mjs').Item} Item */
/** @typedef {import('./home.mjs').Next} Next */
/** @typedef {import('./home.mjs').Work} Work */

const PANE_ID = 'ather'
// Queued work goes out after the command hook returns: a hook holds the turn,
// and the engine refuses a prompt queued from inside it.
const AFTER_HOOK_MS = 50
// The drawn view is rebuilt when shared state changes, and at least this often for the lock file and workers.
const VIEW_TTL_MS = 15000
// GitHub is read in the background at this pace; a prompt never waits on it.
const ISSUES_EVERY_MS = 15 * 60 * 1000

let cwd = ''
let me = ''
// The person's home folder, where the week-calendar plugin keeps ~/.calendar/latest.json.
/** @type {string | null} */
let userHome = null
/** @type {import('./model.mjs').Intent[]} */
let intents = []
// Items handed to the session in this session, shown as sent instead of offered twice.
const sent = new Set()
let paneMode = /** @type {'home' | 'pick' | 'away' | 'skills' | 'issue' | 'intent' | 'create'} */ ('home')
// Create groups opened past their first three.
/** @type {Set<string>} */
const createOpen = new Set()
// Intent changes after this were not seen yet: they make the band's notice.
let intentSeenAt = 0
// The issue whose card is open (paneMode 'issue'), and the view to go back to.
let issueShown = 0
let issueBack = /** @type {'home' | 'pick'} */ ('home')
/** @type {{ name: string, description: string }[]} */
let skills = []
// The band's ✕: hidden until it has something new to say.
let closedHint = /** @type {string | null} */ (null)
let isIssuesWarned = false
let isWhoWarned = false
let issueRetries = 0
// A PR read is running: the minute's refresh does not start a second.
let isPrsReading = false
// The ↻ button: true while a refresh it started is running.
let isIssuesRefreshing = false
/** @type {Promise<void> | null} */
let isAwake = null
/** @type {{ version: number, at: number, model: Home | null }} */
let view = { version: -1, at: 0, model: null }
// The pack this checkout's lane chose (packs/index.mjs), for the drawing; set whenever the view is rebuilt.
/** @type {import('./packs/index.mjs').Pack} */
let pack = unreal

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

/** @param {import('claude-code').On} on */
export function register(on) {
  // The desktop app runs sessions the way the SDK does: not interactive at start, no surface yet.
  // So the commands are registered in every session, and the work behind the console (reading
  // intents and issues on timers) starts the first time someone draws or uses it, never in a
  // scripted run nobody watches.
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const result = await next(e)
    await openConsole($, e.cwd)
    await wake($)
    return result
  })

  on('session.start', { isInteractive: false }, async ($, e, next) => {
    const result = await next(e)
    await openConsole($, e.cwd)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId && (await laneOf($)).isS2) await refresh($).catch(() => undefined)
    if (e.agentId) $.ui.invalidate('ui.render')
    return result
  })

  on('command.run', { command: 'ather' }, async ($, e) => {
    if (!(await laneOf($)).isS2) return { text: (await laneOf($)).pack.notHere }
    await wake($)
    await refresh($).catch(() => undefined)
    return { text: await atherCommand($, e.args.trim()) }
  })

  on('command.run', { command: 'away' }, async ($, e) => {
    if (!(await laneOf($)).isS2) return { text: (await laneOf($)).pack.notHere }
    await wake($)
    return { text: await awayCommand($, e.args.trim()) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await laneOf($)).isS2) return next(e)
    void wake($)
    const model = await home($)
    const fresh = model.header.stage === 'Away' || model.open.some(one => one.kind === 'review') ? [] : await unseenChanges($)
    const hint = fresh.length > 0 ? `◆ Intent: ${fresh.slice(0, 2).map(one => one.text.split(' · ')[0].replace(/^./, first => first.toLowerCase())).join(' · ')}${fresh.length > 2 ? ` · +${fresh.length - 2}` : ''}` : bandHint(model)
    // Closed with ✕: stays away until there is something new to say.
    if (closedHint !== null && (hint === '' || hint === closedHint)) return next(e)
    closedHint = null
    const { Box, Text, Button } = $.ui.resolve(e)
    const isAway = model.header.stage === 'Away'
    return Box({
      flexDirection: 'row',
      gap: 2,
      children: [
        Box({ key: 'ather-band-words', flexGrow: 1, children: [Text({ color: hint ? 'cyan' : undefined, dimColor: hint ? undefined : true, wrap: 'truncate', children: hint || '◆ Ather Automata' })] }),
        ...(fresh.length > 0 ? [Button({ key: 'ather-intent-see', label: 'See', plain: true, onPress: () => void seeIntent($) })] : []),
        Button({ key: 'ather-away', label: '☾', plain: true, dimColor: isAway ? undefined : true, onPress: () => void openPane($, 'away') }),
        Button({ key: 'ather-open', label: '⤢', plain: true, dimColor: true, onPress: () => void openPane($, 'home') }),
        Button({ key: 'ather-close', label: '✕', plain: true, dimColor: true, role: 'dismiss', onPress: () => {
          closedHint = hint
          intentSeenAt = Date.now()
          $.ui.invalidate('ui.render')
          $.ui.toast('Ather hidden until something needs you. /ather brings it back.')
        } }),
      ],
    })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => (e.requestId === PANE_ID ? (void wake($), (intentToday = await todayChanges($)), paneView($.ui.resolve(e), $, await home($), e.props.bodyColumns ?? 80, e.surface, await crewOf($))) : next(e)))

  on('ui.close', ($, e, next) => {
    if (e.id === PANE_ID) paneMode = 'home'
    return next(e)
  })
}

// ---------------------------------------------------------------- starting

// Every session: fresh module state and the two commands.
/** @param {Engine} $ @param {string} folder */
async function openConsole($, folder) {
  sent.clear()
  paneMode = 'home'
  isIssuesWarned = false
  isWhoWarned = false
  issueRetries = 0
  userHome = null
  sessionNames.clear()
  isAwake = null
  view = { version: -1, at: 0, model: null }
  closedHint = null
  intentSeenAt = Date.now()
  createOpen.clear()
  cwd = folder
  for (const command of [
    { name: 'ather', description: 'Ather Automata: what needs you, and what is next', argumentHint: '[pick | issues | issue <number> | tour | skip | role <role> | checked | intent <name>]' },
    { name: 'away', description: 'Ather Automata: going away? hand over with full autonomy, decisions recorded', argumentHint: '[tonight | 8h | 30m | until 9am | until done] [goal] | stop' },
  ]) {
    // One refused command must not take the other, or anything after, with it.
    await $.command.register(command).catch(error => $.ui.log(`Ather console: /${command.name} not registered: ${String(error)}`, { to: 'debug' }))
  }
}

// Once someone is there (a REPL start, the first draw, the first command): read intents and
// issues, keep them fresh, and tell a newcomer about the tour. Runs once per session.
/** @param {Engine} $ @returns {Promise<void>} */
function wake($) {
  if (!isAwake) isAwake = startConsoleWork($).catch(error => $.ui.log(`Ather console: start failed: ${String(error)}`, { to: 'debug' }))
  return isAwake
}

/** @param {Engine} $ */
async function startConsoleWork($) {
  const lane = await laneOf($)
  if (lane.me !== '') me = lane.me
  pack = lane.pack
  if (!lane.isS2) return
  await refresh($)
  $.clock.every(60000, () => void refresh($).catch(() => undefined))
  // watch.mjs may pick up last night's window just after this; show it.
  $.clock.after(1500, () => void refresh($).catch(() => undefined))
  void refreshIssues($).catch(() => undefined)
  $.clock.every(ISSUES_EVERY_MS, () => void refreshIssues($).catch(() => undefined))
  if ((await home($)).isNewcomer && !(await state.readProfile(io($), me)).isNudged) {
    $.ui.toast(lane.pack.prompts.tourToast, { timeoutMs: 12000 })
    await state.setProfile(io($), me, { isNudged: true })
  }
}

// ---------------------------------------------------------------- the view model

// Re-reads the intents; the rest comes from shared state when the view is rebuilt.
/** @param {Engine} $ */
async function refresh($) {
  const { root, me: who, pack: chosen } = await laneOf($)
  if (who !== me) stale()
  me = who
  pack = chosen
  const files = io($)
  const pinned = await state.readPinned(files)
  const read = []
  for (const entry of await $.fs.list(`${root}/docs/intent`).catch(() => [])) {
    if (entry.kind !== 'dir') continue
    const dir = `${root}/docs/intent/${entry.name}`
    const prompt = await files.read(`${dir}/prompt.md`)
    if (prompt === null) continue
    const isOpen = !/^\s*-\s*Status:\s*completed/im.test(prompt)
    const isPinned = entry.name === pinned
    const stats = await Promise.all(['prompt.md', 'progress.md', 'log.md'].map(name => $.fs.stat(`${dir}/${name}`).then(s => s.mtimeMs).catch(() => 0)))
    read.push(
      parseIntent({
        slug: entry.name,
        prompt,
        findings: isOpen ? ((await files.read(`${dir}/findings.md`)) ?? '') : '',
        // Every open intent's (and the tracked one's): its Acceptance table says how much is met, its header names the PRs.
        progress: isOpen || isPinned ? ((await files.read(`${dir}/progress.md`)) ?? '') : '',
        files: isPinned ? (await $.fs.list(dir).catch(() => [])).map(one => one.name) : [],
        hasDebrief: isPinned && (await files.exists(`${root}/${chosen.debriefPath(entry.name)}`)),
        mtimeMs: Math.max(...stats),
      }, chosen),
    )
  }
  intents = read.sort((a, b) => b.mtimeMs - a.mtimeMs)
  // The listed skills that exist here, each with the first sentence of its own description.
  const found = []
  for (const name of new Set([...chosen.skillGroups.flatMap(one => one.names), ...chosen.createGroups.flatMap(one => one.items.filter(item => !item.isGlobal).map(item => item.name))])) {
    const text = await files.read(`${root}/${skillFolder(name)}/SKILL.md`)
    if (text === null) continue
    const description = (/^description:\s*(.+)$/m.exec(text)?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
    found.push({ name, description: /^(.+?[.!?])(\s|$)/.exec(description)?.[1] ?? description })
  }
  skills = found
  stale()
  $.ui.invalidate('ui.render')
  void refreshPrs($).catch(() => undefined)
}

// Whether the PRs of intents with every item met are merged, read with gh in the background.
// Each PR is asked about at most once per PR_EVERY_MS, a merged one never again. Never writes to GitHub.
/** @param {Engine} $ */
async function refreshPrs($) {
  if (isPrsReading) return
  isPrsReading = true
  try {
    const { root } = await laneOf($)
    /** @type {Record<string, import('./model.mjs').PrState>} */
    const read = {}
    for (const number of prsToRead(intents, await state.readPrRecords(io($)), Date.now())) {
      const run = await $.process.run(['gh', 'pr', 'view', String(number), '--json', 'state,mergedAt'], { cwd: root, timeoutMs: 30000 }).catch(() => undefined)
      read[number] = (run && run.exitCode === 0 ? parsePrState(run.stdout) : null) ?? 'UNREAD'
    }
    await state.setPrStates(io($), read, Date.now())
  } finally {
    isPrsReading = false
  }
}

function stale() {
  view = { ...view, version: -1 }
}

// The GitHub issues assigned to the person, read with gh. Without gh, or signed out, there are
// simply none: one line in the debug log, never an error on screen. Never writes to GitHub.
/** @param {Engine} $ @returns {Promise<string>} why the read failed, or '' when it worked */
async function refreshIssues($) {
  const { root } = await laneOf($)
  const run = await $.process.run(['gh', 'issue', 'list', '--assignee', '@me', '--state', 'open', '--limit', '30', '--json', 'number,title,url,labels,updatedAt'], { cwd: root, timeoutMs: 30000 }).catch(() => undefined)
  if (!run || run.exitCode !== 0) {
    // Signed out: the last list may be stale, so none is shown.
    if (/auth login|not logged in|authentication/i.test(run?.stderr ?? '')) await state.setIssues(io($), me, [])
    if (!isIssuesWarned) $.ui.log(`Ather: could not read your GitHub issues (is gh installed and signed in?) ${run?.stderr?.slice(0, 200) ?? ''}`, { to: 'debug' })
    isIssuesWarned = true
    // A slow first start or a network blip is tried again in a minute, three times at most:
    // without gh at all, the 15-minute refresh is enough.
    if (issueRetries < 3) {
      issueRetries += 1
      $.clock.after(60000, () => void refreshIssues($).catch(() => undefined))
    }
    return (run?.stderr || (run ? `gh exited with ${run.exitCode}` : 'gh could not be started (is it installed and on PATH?)')).trim().slice(0, 300)
  }
  issueRetries = 0
  await state.setIssues(io($), me, parseIssues(run.stdout))
  return ''
}

/** @param {Engine} $ @returns {Promise<Home>} */
async function home($) {
  const version = state.stateVersion()
  if (view.model && view.version === version && Date.now() - view.at < VIEW_TTL_MS) return view.model
  const files = io($)
  const { root, me: who, pack: chosen } = await laneOf($)
  pack = chosen
  if (who !== '') me = who
  else if (!isWhoWarned && (isWhoWarned = true)) $.ui.log('Ather: git user.name could not be read; the pane treats nobody as you until it is.', { to: 'debug' })
  const tz = await state.readTz(files)
  const now = Date.now()
  const away = await state.readAway(files)
  const profile = await state.readProfile(files, me, chosen)
  if (userHome === null) {
    try { userHome = ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/') } catch { userHome = '' }
  }
  const model = buildHome({
    intents,
    pinned: await state.readPinned(files),
    me,
    ...profile,
    evidence: await state.readEvidence(files, await state.evidenceScope(files), chosen),
    away,
    ledger: away.phase === 'off' ? '' : ((await files.read(away.ledgerPath)) ?? ''),
    lost: await state.readLost(files),
    lock: await namedLock($, root, chosen.parseLock(chosen.lockFile ? await files.read(`${root}/${chosen.lockFile}`) : null, localMinutes(now, tz))),
    recurring: await state.readRecurring(files, chosen),
    issues: await state.readIssues(files, me),
    prs: await state.readPrStates(files),
    week: userHome ? parseWeek(await files.read(`${userHome}/.calendar/latest.json`), now) : null,
    last: await state.readLast(files, me),
    sent: [...sent],
    skills,
    workers: (await $.agent.list().catch(() => [])).filter(agent => agent.status === 'running' && agent.parentId === undefined).length,
    now,
    tz,
    pack: chosen,
  })
  view = { version, at: now, model }
  return model
}

// A held lock that names a Claude session shows that session's name, as its tab shows it.
/** @param {Engine} $ @param {string} root @param {import('./model.mjs').EditorLock} lock */
async function namedLock($, root, lock) {
  if (lock.state !== 'held' || !lock.session) return lock
  const name = await sessionName($, root, lock.session).catch(() => '')
  return { ...lock, holder: name ? `"${name}"` : `session ${lock.session}` }
}

/** @type {Map<string, { name: string, at: number }>} */
const sessionNames = new Map()
const SESSION_NAME_TTL_MS = 5 * 60 * 1000

// Claude Code keeps each session's record as <config>/projects/<checkout path, dashed>/<session id>.jsonl;
// its titles are lines in it. Read with grep (or PowerShell where there is none), never whole: records run to many MB.
/** @param {Engine} $ @param {string} root @param {string} prefix the first 8 hex of the session id */
async function sessionName($, root, prefix) {
  const hit = sessionNames.get(prefix)
  if (hit && Date.now() - hit.at < SESSION_NAME_TTL_MS) return hit.name
  if (!userHome) return ''
  let config = `${userHome}/.claude`
  try { config = ((await $.env.get('CLAUDE_CONFIG_DIR')) || config).replace(/\\/g, '/') } catch { /* the default */ }
  const dir = `${config}/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}`
  const file = (await $.fs.list(dir).catch(() => [])).find(entry => entry.kind === 'file' && entry.name.startsWith(prefix) && entry.name.endsWith('.jsonl'))
  const name = file ? sessionTitle(await titleLines($, `${dir}/${file.name}`)) : ''
  sessionNames.set(prefix, { name, at: Date.now() })
  return name
}

/** @param {Engine} $ @param {string} path */
async function titleLines($, path) {
  const pattern = '"(customTitle|aiTitle)":"[^"]*"'
  const grep = await $.process.run(['grep', '-oE', pattern, path], { timeoutMs: 15000 }).catch(() => undefined)
  if (grep && (grep.exitCode === 0 || grep.exitCode === 1)) return grep.stdout
  const ps = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', `Select-String -LiteralPath '${path.replace(/'/g, "''")}' -Pattern '${pattern}' -AllMatches | ForEach-Object { $_.Matches.Value }`], { timeoutMs: 20000 }).catch(() => undefined)
  return ps?.exitCode === 0 ? ps.stdout : ''
}

/** @param {Home} model */
function bandHint(model) {
  const { header } = model
  if (header.stage === 'Away') return `🌙 Away ${header.progress} · ${header.sentence} · /ather`
  if (model.open.some(one => one.kind === 'review')) return '☀ Welcome back · review the away window · /ather'
  if (model.isNewcomer) return '◆ New here? Take the tour'
  if (model.open.length > 0) return `◆ ${header.title} · ${model.open.length} need${model.open.length === 1 ? 's' : ''} you · /ather`
  return ''
}

// ---------------------------------------------------------------- handing things to the session

// Resolves once the session has the prompt; never awaited from a command hook. If another
// plugin refuses the timer it never settles: the item only looks sent in this session, and
// nothing persistent changes, because settling waits for delivery.
/** @param {Engine} $ @param {string} text @returns {Promise<void>} */
function deliver($, text) {
  return new Promise((resolve, reject) => {
    $.clock.after(AFTER_HOOK_MS, () => {
      $.prompt.submit({ text }).then(() => resolve(), reject)
    })
  })
}

/** @param {Engine} $ @param {string} text */
function fill($, text) {
  $.clock.after(AFTER_HOOK_MS, () => {
    void $.prompt.fill({ text }).catch(error => $.ui.toast(`Ather: could not fill the prompt box: ${String(error)}`))
  })
}

// The one way things go to the session: shown as sent at once, `onDelivered` once the
// session has the prompt, offered again if delivery fails.
/** @param {Engine} $ @param {readonly string[]} ids @param {string} text @param {() => Promise<unknown>} [onDelivered] @param {() => Promise<unknown>} [onFailed] */
function handOff($, ids, text, onDelivered, onFailed) {
  for (const id of ids) sent.add(id)
  stale()
  void deliver($, text).then(
    () => onDelivered?.(),
    error => {
      for (const id of ids) sent.delete(id)
      void onFailed?.()
      stale()
      $.ui.invalidate('ui.render')
      $.ui.toast(`Ather: could not send to the session: ${String(error)}`)
    },
  )
}

/** @param {Engine} $ @param {Item} one */
async function act($, one) {
  if (one.kind === 'away-end') return comeBack($)
  if (one.kind === 'review') {
    // The review is the person walking through the window: holds end as it is handed over, so the
    // session's questions reach them. The prompt carries every decision and held action.
    const saved = await state.readAway(io($))
    await state.closeAway(io($))
    handOff($, [one.id], one.prompt, undefined, () => state.restoreAway(io($), saved))
    return 'Sent to the session.'
  }
  handOff($, [one.id], one.prompt, () => state.settleItem(io($), one))
  return 'Sent to the session.'
}

// "I'm back": ends the window and hands its review to the session in one step.
/** @param {Engine} $ */
async function comeBack($) {
  await state.endAway(io($))
  stale()
  const review = (await home($)).open.find(one => one.kind === 'review')
  return review ? act($, review) : 'No away window is running.'
}

/** @param {Engine} $ @param {readonly Item[]} items */
async function actAll($, items) {
  handOff($, items.map(one => one.id), batchPrompt(items), async () => {
    for (const one of items) await state.settleItem(io($), one)
  })
  return `Sent ${items.length} things to the session; it takes you through them one at a time.`
}

/** @param {Engine} $ @param {Next} next */
async function doNext($, next) {
  if (next.isTour) return startTour($)
  if (next.work) return startWork($, next.work)
  if (next.action === 'checked') return atherCommand($, 'checked')
  if (next.isDraft) {
    fill($, next.prompt)
    return 'It is in the prompt box: finish it and press Enter.'
  }
  handOff($, [next.id], next.prompt)
  return 'Sent to the session.'
}

/** @param {Engine} $ */
async function startTour($) {
  handOff($, ['next:tour'], pack.prompts.tour, () => state.setProfile(io($), me, { tourDone: true }))
  return 'Starting the Ather tour.'
}

/** @param {Engine} $ @param {Work} work */
async function startWork($, work) {
  if (work.kind === 'intent') return track($, work.slug)
  handOff($, [work.id], work.prompt)
  return `Sent issue #${work.issue.number} to the session: it checks for overlapping work first, then drafts the intent with you.`
}

// An issue by number, from the assigned list or not.
/** @param {Engine} $ @param {number} number @param {boolean} [isInQuestion] */
async function startIssue($, number, isInQuestion = false) {
  const assigned = (await state.readIssues(io($), me)).find(one => one.number === number)
  if (assigned) {
    handOff($, [`issue:${number}`], issuePrompt(assigned, me))
    return `Sent issue #${number} to the session: it checks for overlapping work first, then drafts the intent with you.`
  }
  const issue = { number, title: '', name: '', url: '', labels: [], updatedAt: 0, area: 'Unsorted', isUrgent: false }
  const go = async () => {
    handOff($, [`issue:${number}`], issuePrompt(issue, me))
    return `Sent issue #${number} to the session: it checks for overlapping work first, then drafts the intent with you.`
  }
  // Already inside a question: the session confirms instead of a third dialog.
  if (isInQuestion) {
    handOff($, [`issue:${number}`], `Issue #${number} is not assigned to me. Ask me to confirm before starting it; then: ${issuePrompt(issue, me)}`)
    return `Sent issue #${number} to the session; it confirms with you first, since it is not assigned to you.`
  }
  return ask($, {
    header: 'Issue',
    question: `Issue #${number} is not one of your assigned issues. Start an intent from it anyway?`,
    choices: [{ label: `Start issue #${number}`, description: 'The session checks for overlapping work first.', run: go }],
    fallback: 'Not started.',
    onTyped: text => typed($, text),
  })
}

// Tracks an intent by its folder name, or by the one intent a few words match.
/** @param {Engine} $ @param {string} text */
async function track($, text) {
  const { root } = await laneOf($)
  const matches = searchIntents(intents, text)
  const slug = intents.some(one => one.slug === text) ? text : matches.length === 1 && matches[0] ? matches[0].slug : null
  if (slug === null) return matches.length > 1 ? `${matches.length} intents match "${text}": ${matches.slice(0, 8).map(one => one.slug).join(', ')}.` : `No open intent matches "${text}".`
  if (!(await state.track(io($), root, slug, { me }))) return `No intent named "${slug}" in docs/intent.`
  await refresh($)
  return `Now tracking ${slug}.`
}

/** @param {Engine} $ @param {import('./away.mjs').WindowChoice} choice */
async function startAway($, choice) {
  const tz = await state.readTz(io($))
  const away = await state.startAway(io($), choice, { root: (await laneOf($)).root, me, tz, now: Date.now(), pack })
  if (away === null) return 'An away window is already running or waiting for your review: /ather shows it.'
  const { root } = await laneOf($)
  const ledger = away.ledgerPath.startsWith(root) ? away.ledgerPath.slice(root.length + 1) : away.ledgerPath
  handOff($, ['away-start'], `I am away ${windowEndText(away, tz)}. Goal: ${choice.goal || 'continue the active work'}. Work through it without waiting for me and record every decision you take for me in ${ledger}.`)
  return `Away ${windowEndText(away, tz)}${choice.goal ? ` (goal: ${choice.goal})` : ''}. ${pack.mandate.away}`
}

// Text typed instead of picking: an intent, a question for the session, or nothing.
/** @param {Engine} $ @param {string} text @param {boolean} [isInQuestion] typed under Other, so no further question */
async function typed($, text, isInQuestion = true) {
  if (/^tours?$/i.test(text.trim())) return startTour($)
  const number = /^#(\d+)$|^(\d{3,7})$/.exec(text.trim())
  if (number) return startIssue($, Number(number[1] ?? number[2]), isInQuestion)
  if (searchIntents(intents, text).length > 0) return track($, text)
  const question = /^(help|\?)$/i.test(text.trim()) ? 'What can Ather do for me?' : text
  void deliver($, askPrompt(question, pack)).catch(error => $.ui.toast(`Ather: could not send to the session: ${String(error)}`))
  return 'Sent your question to the session.'
}

// ---------------------------------------------------------------- commands

/** @param {Engine} $ */
async function hasPane($) {
  const surfaces = /** @type {readonly string[]} */ (await $.session.surfaces().catch(() => []))
  return surfaces.includes('terminal') || surfaces.includes('desktop')
}

/** @param {Engine} $ */
async function skipTour($) {
  await state.setProfile(io($), me, { tourDone: true })
  return ask($, {
    header: 'Your role',
    question: 'Tour skipped (/ather tour brings it back). What kind of work do you do? It decides what proof Ather asks for.',
    choices: pack.roles.map(role => ({ label: pack.roleLabels[role] ?? role, description: pack.roleDescriptions[role] ?? '', run: () => atherCommand($, `role ${role}`) })),
    fallback: pack.roleFallback,
    onTyped: text => atherCommand($, `role ${text}`),
  })
}

// What /ather understands after its name; a typo of one of these ("tuor", "isue") is read as it.
const COMMAND_WORDS = ['tour', 'skip', 'pick', 'issues', 'issue', 'intent', 'role', 'checked']

/** @param {Engine} $ @param {string} args */
async function atherCommand($, args) {
  const word = args.split(/\s+/)[0]?.toLowerCase() ?? ''
  const rest = args.slice(word.length).trim()
  if (word === 'tour' || word === 'tours') return startTour($)
  if (word === 'skip') return skipTour($)
  if ((word === 'intent' || word === 'pick') && rest) return track($, rest)
  if ((word === 'issue' || word === 'issues') && /^#?\d+$/.test(rest)) return startIssue($, Number(rest.replace('#', '')))
  if (word === 'role') {
    const role = pack.parseRole(rest)
    if (!role) return pack.roleHelp
    await state.setProfile(io($), me, { role }, pack)
    return `Your role is ${pack.roleLabels[role] ?? role}. It shapes the next step and what Prove asks for.`
  }
  if (word === 'checked') {
    const own = pack.ownCheck
    if (!own) return 'Nothing to record by hand here: Ather reads every proof from tool output.'
    await state.setRung(io($), await state.evidenceScope(io($)), own.rung, { state: 'pass', detail: own.detail })
    return own.reply
  }
  if (word === 'issues') {
    // Read them now: a list that never showed up is explained here instead of staying empty.
    const failure = await refreshIssues($).catch(error => String(error))
    if (failure) return `Could not read your GitHub issues: ${failure}`
    if ((await state.readIssues(io($), me)).length === 0) return 'No open GitHub issues are assigned to you.'
    return (await hasPane($)) ? openPane($, 'pick') : workQuestion($)
  }
  if (word === 'pick') return (await hasPane($)) ? openPane($, 'pick') : workQuestion($)
  // "/ather tuor": a typo of a command word is pointed out, never run ("ship" is one letter from "skip").
  const meant = rest === '' ? closestWord(word, COMMAND_WORDS) : null
  if (meant && searchIntents(intents, word).length === 0) return `Did you mean /ather ${meant}?`
  if (word !== '') return typed($, args, false)
  // /ather also brings back a band closed with ✕.
  closedHint = null
  return (await hasPane($)) ? openPane($, 'home') : menuQuestion($)
}

/** @param {Engine} $ @param {string} args */
async function awayCommand($, args) {
  const away = await state.readAway(io($))
  if (isStopWord(args)) {
    if (await state.endAway(io($))) return 'Away window ended; held actions stay held until you review it. Type /ather.'
    return away.phase === 'review' ? 'The away window has ended; type /ather to review it.' : 'No away window is running.'
  }
  if (away.phase === 'running') return `An away window is running ${windowEndText(away, await state.readTz(io($)))}. /away end ends it.`
  if (away.phase === 'review') return 'The last away window waits for your review: type /ather.'
  const parsed = parseAwayArgs(args, localMinutes(Date.now(), await state.readTz(io($))))
  return parsed ? startAway($, parsed) : presetQuestion($, args)
}

// ---------------------------------------------------------------- one question (desktop, and /away anywhere)

/** @typedef {{ label: string, description: string, run: () => Promise<string> }} Choice */

// The dialog reports a dismissal or an unanswered question as bracketed text, not as an error.
const DISMISSED = /^\[.*\]$|^(not now|close|skip|cancel|dismiss(ed)?|no preference)[.!]?$/i

/** @param {unknown} value */
function asAnswer(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text === '' || DISMISSED.test(text) ? null : text
}

// One question; runs the chosen answer, hands typed text to onTyped, or returns the fallback when dismissed.
/** @param {Engine} $ @param {{ header: string, question: string, choices: readonly Choice[], fallback: string, onTyped: (text: string) => Promise<string> }} spec */
async function ask($, spec) {
  const options = spec.choices.slice(0, 4).map(choice => ({ label: choice.label, description: choice.description }))
  if (options.length === 1) options.push({ label: 'Close', description: 'Close this without choosing.' })
  /** @type {import('claude-code').ToolCallResult | undefined} */
  let ran
  try {
    ran = await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: spec.question, header: spec.header.slice(0, 12), options, multiSelect: false }] })
  } catch {
    return spec.fallback
  }
  if (ran.deny !== undefined || ran.isError === true) return spec.fallback
  const result = /** @type {{ answers?: Record<string, unknown>, response?: unknown, afkTimeoutMs?: unknown } | undefined} */ (ran.result)
  // Resolved by itself while the person was away from the keyboard: nobody chose anything.
  const answer = result?.afkTimeoutMs !== undefined ? null : (asAnswer(result?.answers?.[spec.question]) ?? asAnswer(result?.response))
  if (answer === null) return spec.fallback
  const picked = /^\d$/.test(answer) ? spec.choices[Number(answer) - 1] : undefined
  const chosen = picked ?? spec.choices.find(choice => choice.label === answer || choice.label.replace(/ \(Recommended\)$/, '') === answer)
  return chosen ? chosen.run() : spec.onTyped(answer)
}

/** @param {string} text @param {number} max */
function cut(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

// `/ather` without a drawing surface: where things stand is the question, the few things worth doing are the answers.
/** @param {Engine} $ */
async function menuQuestion($) {
  const model = await home($)
  /** @type {Choice[]} */
  const choices = []
  const next = model.next
  if (next?.isTour) {
    choices.push({ label: 'Take the tour (Recommended)', description: next.hint, run: () => doNext($, next) })
    const [mine] = model.work.filter(one => one.isMine)
    if (mine) choices.push({ label: cut(mine.kind === 'issue' ? `Start #${mine.issue.number} ${mine.issue.name}` : `Pick up ${mine.slug}`, 40), description: mine.hint, run: () => startWork($, mine) })
    choices.push({ label: 'Skip the tour', description: 'You know your way around; Ather asks your role instead.', run: () => skipTour($) })
  }
  // What happened while the person was away is reviewed on its own, before anything else.
  const review = model.open.find(one => one.kind === 'review' || one.kind === 'away-end')
  if (review) choices.push({ label: review.label, description: review.question, run: () => act($, review) })
  const rest = model.open.filter(one => one !== review)
  const [only] = rest
  if (rest.length === 1 && only) choices.push({ label: only.label, description: only.question, run: () => act($, only) })
  else if (rest.length > 1) choices.push({ label: `Go through ${rest.length} things`, description: cut(rest.map(one => one.question).join(' · '), 200), run: () => actAll($, rest) })
  if (next && !next.isTour && !sent.has(next.id)) choices.push({ label: cut(next.work?.kind === 'intent' || next.action ? next.label : `Next: ${next.label}`, 40), description: next.hint, run: () => doNext($, next) })
  if (model.offerAway) choices.push({ label: 'Heading off?', description: 'Hand over until done, for 8 or 4 hours.', run: () => presetQuestion($, '') })
  choices.push({ label: model.header.title === 'Ather' ? 'Pick something to work on' : 'Switch to other work', description: 'Your intents and GitHub issues first.', run: () => workQuestion($) })
  const { header } = model
  const where = [header.stage, header.progress].filter(Boolean).join(', ')
  const lead =
    header.stage === 'Away'
      ? `Away ${header.progress}: ${header.sentence}.`
      : review
        ? `Welcome back. ${review.question}.`
        : model.isNewcomer
          ? `${me ? `Hi ${me.split(/\s+/)[0]}, new` : 'New'} to Ather? Start with the tour.`
          : header.title === 'Ather'
            ? model.work.some(one => one.kind === 'intent' && one.isMine)
              ? 'Nothing tracked in this session.'
              : 'Not working on an intent yet.'
            : `${header.title}: ${where.charAt(0).toLowerCase() + where.slice(1) || 'no checklist yet'}.`
  const waiting = rest.length > 0 ? ` Waiting on you: ${rest.map(one => (one.kind === 'call' ? one.question.split(':')[0] : one.label.charAt(0).toLowerCase() + one.label.slice(1))).join(', ')}.` : ''
  const status = [header.title, header.stage, header.progress, model.open.length > 0 ? `${model.open.length} need${model.open.length === 1 ? 's' : ''} you` : header.sentence].filter(Boolean).join(' · ')
  return ask($, { header: 'Ather', question: `${lead}${waiting} What now?`, choices: choices.slice(0, 4), fallback: status, onTyped: text => typed($, text) })
}

/** @param {Engine} $ */
async function workQuestion($) {
  const work = (await home($)).work.slice(0, 4)
  if (work.length === 0) return 'Nothing open yet: start an intent with /intent and what you want.'
  return ask($, {
    header: 'Work',
    question: 'What should this session work on? Your intents and your GitHub issues come first. Or type a name, or an issue #number.',
    choices: work.map(one => ({ label: cut(one.label, 40), description: one.hint, run: () => startWork($, one) })),
    fallback: 'Nothing chosen.',
    onTyped: text => typed($, text),
  })
}

/** @param {Engine} $ @param {string} goal */
async function presetQuestion($, goal) {
  const tz = await state.readTz(io($))
  const end = (/** @type {number} */ hours) => `until ${clockText(Date.now() + hours * 3600000, tz)}`
  return ask($, {
    header: 'Away',
    question: `Heading off?${goal ? ` Goal: "${goal}".` : ''} While you are away the session may push branches and open PRs; nothing merges until you are back, and every decision it makes is written down for you.`,
    choices: AWAY_PRESETS.map((preset, index) => ({
      label: index === 0 ? `${preset.label} (Recommended)` : preset.label,
      description: preset.choice.untilDone ? 'Ends when the work is done, or after 24 hours at the latest.' : `${end(preset.choice.hours)}.`,
      run: () => startAway($, { ...preset.choice, goal }),
    })),
    fallback: 'Not started.',
    onTyped: async text => {
      const parsed = parseAwayArgs(text, localMinutes(Date.now(), tz))
      return parsed ? startAway($, { ...parsed, goal: parsed.goal || goal }) : 'Not started. Try "8h", "until 9am" or "until done".'
    },
  })
}

// ---------------------------------------------------------------- the pane (terminal)

/** @param {Engine} $ @param {'home' | 'pick' | 'away' | 'skills' | 'issue' | 'intent' | 'create'} mode */
async function openPane($, mode) {
  paneMode = mode
  await $.ui.open({ id: PANE_ID, title: 'ATHER AUTOMATA', focus: true, closeOnEscape: true, rows: 22 })
  $.ui.invalidate('ui.render')
  return mode === 'pick' ? 'Everything open: ↑↓ move · Enter choose · Esc close.' : 'Ather: ↑↓ move · Enter choose · Esc close.'
}

/** @param {Engine} $ @param {() => Promise<string>} run @param {boolean} keepOpen */
function press($, run, keepOpen) {
  return () =>
    void run()
      .then(async text => {
        if (!keepOpen) await $.ui.close({ id: PANE_ID }).catch(() => undefined)
        $.ui.toast(`Ather: ${text}`)
      })
      .catch(error => $.ui.toast(`Ather: ${String(error)}`))
}

// Reads the assigned issues again now, and says what came back.
/** @param {any} el @param {Engine} $ */
function refreshIssuesButton(el, $) {
  const onPress = () => {
    if (isIssuesRefreshing) return
    isIssuesRefreshing = true
    $.ui.invalidate('ui.render')
    void refreshIssues($)
      .catch(error => String(error))
      .then(async failure => {
        const count = failure ? 0 : (await state.readIssues(io($), me)).length
        $.ui.toast(failure ? `Ather: could not read your GitHub issues: ${failure}` : `Ather: ${count === 0 ? 'no open GitHub issues are assigned to you' : `${count} open GitHub issue${count === 1 ? '' : 's'} assigned to you`}.`)
      })
      .finally(() => {
        isIssuesRefreshing = false
        stale()
        $.ui.invalidate('ui.render')
      })
  }
  return el.Box({ key: 'issues-refresh-row', marginTop: 1, children: [el.Button({ key: 'issues-refresh', label: isIssuesRefreshing ? '↻ Refreshing…' : '↻ Refresh GitHub issues', hotkey: hotkeyFor('r'), plain: true, dimColor: true, onPress })] })
}

/** @param {Engine} $ @param {'home' | 'pick' | 'away' | 'skills' | 'issue' | 'intent' | 'create'} mode */
function show($, mode) {
  return () => {
    paneMode = mode
    $.ui.invalidate('ui.render')
  }
}

// One row for a piece of work: an intent's own line, or an issue's number, title and age.
/** @param {Work} one */
function workRow(one) {
  return one.kind === 'intent' ? one.hint : `${one.label} · ${one.hint}`
}

/** @param {string} text @param {number} width */
function fit(text, width) {
  const clean = text.replace(/[\r\n\t]+/g, ' ')
  return clean.length <= width ? clean : `${clean.slice(0, Math.max(1, width - 1))}…`
}

// ---------------------------------------------------------------- the pane

// Ather's look: near-black, one lime accent, quiet grey for everything secondary.
const LIME = '#DDFF00'
const QUIET = '#8E918A'

// The Ather mark: the A, its lime I, and the 5 raised as a power.
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><polygon points="6,98 40,14 60,14 94,98 76,98 50,36 24,98" fill="#C9CCCC"/><rect x="47.5" y="56" width="5" height="28" fill="#DDFF00"/><text x="86" y="40" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="40" fill="#DDFF00">5</text></svg>'

// A section label, spaced out as the studio's are ("N E E D S   Y O U"), plain when too wide.
/** @param {any} el @param {string} key @param {string} text @param {number} width */
function label(el, key, text, width) {
  const spaced = text.toUpperCase().split('').join(' ')
  return el.Text({ key, color: LIME, bold: true, children: spaced.length <= width ? spaced : fit(text.toUpperCase(), width) })
}

// On the desktop the pane is clicked, and its keys reach it only once it is clicked into (opened from
// the band it never takes the keyboard): letters there promise what they cannot do, so none are drawn.
let isClicked = false
/** @param {string | undefined} hotkey */
const hotkeyFor = hotkey => (isClicked ? undefined : hotkey)

// One choice: its key and what it does, then one quiet line of detail beneath.
/**
 * @param {any} el
 * @param {{ key: string, hotkey?: string, title: string, detail?: string, isSent?: boolean, isQuiet?: boolean, autoFocus?: boolean, aside?: string, lead?: string, mark?: string, marginTop?: number, width: number, onPress: () => void }} row
 */
function choice(el, row) {
  const title = `${row.isSent ? '✓ sent · ' : ''}${row.title}`
  // A right-hand column (a teammate's name) takes its width from the title, never the other way.
  const aside = row.aside ? fit(row.aside, 24) : ''
  const button = el.Button({ key: row.key, label: fit(title, row.width - 3 - (aside ? aside.length + 2 : 0) - (row.mark ? 2 : 0)), hotkey: hotkeyFor(row.hotkey), plain: true, dimColor: row.isSent || row.isQuiet ? true : undefined, autoFocus: row.autoFocus ? true : undefined, onPress: row.onPress })
  const body = [
    aside ? el.Box({ key: `${row.key}-line`, flexDirection: 'row', justifyContent: 'space-between', gap: 2, width: '100%', children: [el.Box({ key: `${row.key}-main`, flexGrow: 1, flexShrink: 1, children: [button] }), el.Text({ key: `${row.key}-aside`, color: QUIET, children: aside })] }) : button,
    // The whole name, wrapped, where a button's one line would cut it (the desktop).
    ...(row.lead ? [el.Box({ key: `${row.key}-lead`, paddingLeft: isClicked ? 1 : 3, children: [el.Text({ wrap: 'wrap', children: row.lead })] })] : []),
    // The desktop wraps the detail whole; the terminal keeps it to three lines.
    ...(row.detail ? [el.Box({ key: `${row.key}-detail`, paddingLeft: isClicked ? 1 : 3, children: [el.Text({ color: QUIET, wrap: 'wrap', children: isClicked ? row.detail : fit(row.detail, 3 * Math.max(20, row.width - 4)) })] })] : []),
  ]
  // A marked row (something that needs you) hangs its text beside the mark.
  if (row.mark) return el.Box({ key: `row-${row.key}`, flexDirection: 'row', width: '100%', marginTop: row.marginTop, children: [el.Text({ key: `${row.key}-mark`, color: row.isSent ? QUIET : LIME, children: `${row.mark} ` }), el.Box({ key: `${row.key}-body`, flexDirection: 'column', flexGrow: 1, flexShrink: 1, children: body })] })
  return el.Box({ key: `row-${row.key}`, flexDirection: 'column', width: '100%', marginTop: row.marginTop, children: body })
}

// An issue's address, when it is one a Link may carry (https, printable ASCII); else none.
/** @param {string} url */
function linkOf(url) {
  try {
    const href = new URL(url).href
    return href.startsWith('https://') && /^[\x21-\x7e]+$/.test(href) && href.length <= 2048 ? href : ''
  } catch {
    return ''
  }
}

/** @param {Engine} $ @param {number} number @param {string} link */
function openIssue($, number, link) {
  return () =>
    void laneOf($)
      .then(({ root }) => $.process.run(['gh', 'issue', 'view', String(number), '--web'], { cwd: root, timeoutMs: 20000 }))
      .then(run => $.ui.toast(run.exitCode === 0 ? `Ather: opened issue #${number} in your browser.` : `Ather: could not open the browser; the link is ${link}`))
      .catch(() => $.ui.toast(`Ather: could not open the browser; the link is ${link}`))
}

// Open on GitHub: a link the desktop opens on a click; in the terminal, a button.
/** @param {any} el @param {Engine} $ @param {import('./issues.mjs').Issue} issue @param {string} link @param {{ key: string, label: string, hotkey?: string, isQuiet?: boolean }} look */
function openControl(el, $, issue, link, look) {
  return isClicked ? el.Link({ key: look.key, href: link, label: look.label }) : el.Button({ key: look.key, label: look.label, plain: true, hotkey: look.hotkey, dimColor: look.isQuiet ? true : undefined, onPress: openIssue($, issue.number, link) })
}

/** @param {Engine} $ @param {string} link */
function copyLink($, link) {
  return (/** @type {{ surface?: string }} */ pressed) =>
    void $.ui
      .copy({ text: link, surface: /** @type {any} */ (pressed)?.surface })
      .then(result => $.ui.toast(result.isCopied ? 'Ather: issue link copied.' : `Ather: could not copy the link (${result.reason}).`))
      .catch(error => $.ui.toast(`Ather: could not copy the link: ${String(error)}`))
}

/** @param {Engine} $ @param {number} number @param {'home' | 'pick'} back */
function showIssue($, number, back) {
  return () => {
    issueShown = number
    issueBack = back
    paneMode = 'issue'
    $.ui.invalidate('ui.render')
  }
}

// A choice with an issue's open and copy icons: beside it on the desktop, beneath it in the terminal.
/** @param {any} el @param {Engine} $ @param {import('./issues.mjs').Issue | null} issue @param {any} row */
function withIssueIcons(el, $, issue, row) {
  const link = issue ? linkOf(issue.url) : ''
  if (!link) return [row]
  const icons = el.Box({ key: 'next-icons', flexDirection: 'row', gap: 2, children: [el.Link({ key: 'next-open', href: link, label: '↗' }), el.Button({ key: 'next-copy', label: '⧉', plain: true, dimColor: true, onPress: copyLink($, link) })] })
  return isClicked ? [el.Box({ key: 'next-with-icons', flexDirection: 'row', width: '100%', children: [el.Box({ key: 'next-main', flexGrow: 1, children: [row] }), icons] })] : [row, el.Box({ key: 'next-icons-row', paddingLeft: 3, children: [el.Box({ key: 'next-icons-words', flexDirection: 'row', gap: 2, children: [openControl(el, $, /** @type {import('./issues.mjs').Issue} */ (issue), link, { key: 'next-open', label: '↗ Open on GitHub', hotkey: 'o', isQuiet: true }), el.Button({ key: 'next-copy', label: '⧉ Copy link', plain: true, hotkey: 'y', dimColor: true, onPress: copyLink($, link) })] })] })]
}

/** @param {any} el @param {string} key @param {any[]} children */
function section(el, key, children) {
  return el.Box({ key, flexDirection: 'column', width: '100%', marginTop: 1, children })
}

// Plan ✓ ─ Build ● ─ Prove ○ ─ Ship ○, lit up to where the work is.
/** @param {any} el @param {Home['header']['stages']} stages */
function stageRow(el, stages) {
  return el.Box({
    key: 'stages',
    flexDirection: 'row',
    children: stages.flatMap((one, index) => [
      ...(index > 0 ? [el.Text({ key: `stage-gap-${index}`, color: QUIET, children: ' ─ ' })] : []),
      el.Text({ key: `stage-${index}`, color: one.state === 'todo' ? QUIET : LIME, bold: one.state === 'now', children: `${one.label} ${one.state === 'done' ? '✓' : one.state === 'now' ? '●' : '○'}` }),
    ]),
  })
}

/** @param {any} el @param {any[]} lines @param {string | undefined} surface */
function masthead(el, lines, surface) {
  const words = el.Box({ key: 'head-words', flexDirection: 'column', children: lines })
  return surface === 'desktop' && el.Svg ? el.Box({ key: 'head', flexDirection: 'row', gap: 2, alignItems: 'center', children: [el.Svg({ source: MARK, alt: 'Ather', width: 48, height: 40 }), words] }) : words
}

/** @param {Work} one */
const workTitle = one => (one.kind === 'intent' ? one.slug : one.label)
/** @param {Work} one */
const workDetail = one => (one.kind === 'intent' ? one.hint.replace(`${one.slug} · `, '') : one.hint)
// A teammate's intent: their name moves out of the detail into the right-hand column.
/** @param {Work} one @returns {{ detail: string, aside?: string }} */
const asideOf = one => (one.kind === 'intent' && !one.isMine && one.owner ? { detail: workDetail(one).replace(` · ${one.owner}`, ''), aside: one.owner } : { detail: workDetail(one) })
// A work row's text. On the desktop an issue's button says its number and its whole title wraps beneath.
/** @param {Work} one */
const workRowProps = one => ({ title: one.kind === 'issue' && isClicked ? `#${one.issue.number}` : workTitle(one), ...(one.kind === 'issue' && isClicked ? { lead: one.issue.name } : {}), ...asideOf(one) })

// ---------------------------------------------------------------- what the intent recorded

/** @type {{ kind: 'done' | 'yours' | 'changed', text: string, time: string }[]} */
let intentToday = []

// The tracked intent's lines since the start of the person's day, newest first, with their time.
/** @param {Engine} $ */
async function todayChanges($) {
  const files = io($)
  const slug = await state.readPinned(files)
  if (!slug) return []
  const tz = await state.readTz(files)
  const now = Date.now()
  const lines = await state.readChanges(files, slug, now - localMinutes(now, tz) * 60000)
  return lines.map(one => ({ kind: one.kind, text: one.text, time: clockText(one.at, tz) }))
}

// The tracked intent's lines this session has not shown yet: the band's notice.
/** @param {Engine} $ */
async function unseenChanges($) {
  const files = io($)
  const slug = await state.readPinned(files)
  return slug ? state.readChanges(files, slug, intentSeenAt + 1) : []
}

/** @param {Engine} $ */
async function seeIntent($) {
  intentSeenAt = Date.now()
  await openPane($, 'intent')
}

// ---------------------------------------------------------------- workers

/**
 * @typedef {{ id: string, title: string, kind: import('./squad.mjs').Kind, model: string, state: import('./squad.mjs').WorkerState,
 *   prop: import('./squad.mjs').Prop | null, trail: import('./squad.mjs').Prop[], elapsed: number, tools: number }} Crew
 */

const IDLE_MS = 90000
const DONE_SHOWN = 3

// The session's own workers, newest first: what Claude Code says of each (status), and what the
// watch half saw (kind, model, tool calls). A worker started before Ather loaded has no trail.
/** @param {Engine} $ @returns {Promise<Crew[]>} */
async function crewOf($) {
  const now = Date.now()
  const agents = (await $.agent.list().catch(() => [])).filter(agent => agent.parentId === undefined)
  /** @type {Crew[]} */
  const crew = []
  for (const agent of agents) {
    const seen = workerOf(agent.id)
    const state = workerState(agent.status)
    if (state === 'done' || state === 'failed') recordEnd(agent.id, now)
    const started = seen?.startedAt ?? now
    const isIdle = state === 'running' && seen !== undefined && now - seen.lastAt > IDLE_MS
    crew.push({
      id: agent.id,
      title: seen?.title ?? agent.description,
      kind: seen?.kind ?? classifyWorker({ subagentType: agent.type, prompt: '', description: agent.description }),
      model: modelWord(seen?.model ?? ''),
      state,
      prop: isIdle ? 'idle' : state === 'running' ? (seen?.prop ?? null) : (seen?.trail.at(-1) ?? null),
      trail: seen?.trail ?? [],
      elapsed: (workerOf(agent.id)?.endedAt ?? now) - started,
      tools: seen?.tools ?? 0,
    })
  }
  return crew.reverse()
}

/** @param {number} ms */
const clock = ms => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}h` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// Running workers, then the last few done: avatar, title, kind and model, and how it went.
/** @param {any} el @param {Engine} $ @param {Crew[]} crew @param {number} width */
function crewSections(el, $, crew, width) {
  const running = crew.filter(one => one.state === 'running' || one.state === 'waiting')
  const done = crew.filter(one => one.state === 'done' || one.state === 'failed').slice(0, DONE_SHOWN)
  const sections = []
  if (running.length > 0) sections.push(section(el, 'workers', [label(el, 'workers-label', `Workers · running ${running.length}`, width), ...running.map(one => crewRow(el, $, one, width))]))
  if (done.length > 0) sections.push(section(el, 'workers-done', [label(el, 'workers-done-label', `Done ${done.length}`, width), ...done.map(one => crewRow(el, $, one, width))]))
  return sections
}

/** @param {any} el @param {Engine} $ @param {Crew} one @param {number} width */
function crewRow(el, $, one, width) {
  const look = KINDS[one.kind]
  const isLive = one.state === 'running' || one.state === 'waiting'
  const doing = isLive ? (one.prop ? PROP_WORDS[one.prop] : 'starting') : one.state === 'done' ? 'finished' : 'stopped'
  const kindLine = el.Box({ key: `${one.id}-kind`, flexDirection: 'row', children: [el.Text({ color: look.fill, bold: true, children: look.word }), el.Text({ color: QUIET, children: ` · ${[one.model, doing].filter(Boolean).join(' · ')}` })] })
  const tools = `${one.tools} tool call${one.tools === 1 ? '' : 's'}`
  const how = isLive
    ? el.Text({ key: `${one.id}-how`, color: QUIET, children: `running ${clock(one.elapsed)} · ${tools}` })
    : el.Box({
        key: `${one.id}-how`,
        flexDirection: 'row',
        children: [
          ...(isClicked && one.trail.length > 0
            ? one.trail.flatMap((prop, index) => [...(index > 0 ? [el.Text({ color: QUIET, children: ' → ' })] : []), el.Svg({ source: propSvg(prop), alt: PROP_WORDS[prop], width: 22, height: 22 })])
            : one.trail.length > 0 ? [el.Text({ color: QUIET, children: trailWords(one.trail) })] : []),
          el.Text({ color: STATE_COLOURS[one.state], children: `${one.trail.length > 0 ? ' ' : ''}${STATE_GLYPHS[one.state]}` }),
          el.Text({ color: QUIET, children: ` · ${one.state === 'done' ? 'took' : 'stopped at'} ${clock(one.elapsed)} · ${tools}` }),
        ],
      })
  const words = el.Box({
    key: `${one.id}-words`,
    flexDirection: 'column',
    flexGrow: 1,
    children: [el.Button({ key: `worker-${one.id}`, label: fit(one.title, width - 8), plain: true, onPress: press($, async () => { handOff($, [], `Give me a five-line status of the background worker "${one.title}" (agent ${one.id}): what it has done, what it is doing now, what is left, and any blocker. Do not stop or redirect it.`); return `asked the session about ${one.title}` }, false) }), kindLine, how],
  })
  const glyph = el.Text({ key: `${one.id}-glyph`, color: STATE_COLOURS[one.state], children: STATE_GLYPHS[one.state] })
  // The desktop draws the worker's avatar; the terminal leads with its state glyph.
  return isClicked
    ? el.Box({ key: `crew-${one.id}`, flexDirection: 'row', gap: 2, width: '100%', alignItems: 'center', marginTop: 1, children: [el.Svg({ source: avatarSvg(one.kind, one.prop, one.state), alt: `${look.word}, ${one.state}`, width: 40, height: 40, isInteractive: one.state === 'running' ? true : undefined }), words, glyph] })
    : el.Box({ key: `crew-${one.id}`, flexDirection: 'row', gap: 1, children: [glyph, words] })
}

// ---------------------------------------------------------------- the summary strip

// Ten segments, lit in lime as far as the checklist is done.
/** @param {any} el @param {string} key @param {number} done @param {number} total */
function bar(el, key, done, total) {
  const lit = total > 0 ? Math.round((done / total) * 10) : 0
  return el.Box({ key, flexDirection: 'row', children: [el.Text({ color: LIME, children: '━'.repeat(lit) }), el.Text({ color: '#3a3c36', children: '━'.repeat(10 - lit) })] })
}

// How it is going, before anything is read: the checklist, workers running, decisions waiting on you.
/** @param {any} el @param {Home} model @param {Crew[]} crew @param {number} width */
function summaryStrip(el, model, crew, width) {
  const { header } = model
  const running = crew.filter(one => one.state === 'running').length
  // The same count as the Needs you section beneath: a rule to make waits on you as much as a decision.
  const decisions = model.open.length
  const first = header.total > 0 ? { key: 'Checklist', value: `${header.done}/${header.total}`, extra: bar(el, 'strip-bar', header.done, header.total) } : { key: 'Yours', value: String(model.work.filter(one => one.isMine).length), extra: el.Text({ color: QUIET, children: 'intents and issues' }) }
  const cards = [
    { ...first, isHot: false },
    { key: 'Workers', value: String(running), extra: el.Text({ color: QUIET, children: 'running' }), isHot: false },
    { key: 'Needs you', value: String(decisions), extra: el.Text({ color: decisions > 0 ? LIME : QUIET, children: decisions === 1 ? 'thing waiting' : 'things waiting' }), isHot: decisions > 0 },
  ]
  if (isClicked) {
    return el.Box({
      key: 'strip',
      flexDirection: 'row',
      gap: 1,
      width: '100%',
      marginTop: 1,
      children: cards.map(card => el.Box({ key: `strip-${card.key}`, flexDirection: 'column', flexGrow: 1, borderStyle: 'round', borderColor: card.isHot ? LIME : '#3a3c36', paddingX: 1, children: [el.Text({ color: QUIET, children: card.key }), el.Text({ bold: true, color: card.isHot ? LIME : undefined, children: card.value }), card.extra] })),
    })
  }
  // The terminal: one line.
  return el.Box({
    key: 'strip',
    flexDirection: 'row',
    marginTop: 1,
    children: [
      el.Text({ color: QUIET, children: `${first.key} ` }),
      el.Text({ bold: true, children: first.value }),
      ...(header.total > 0 ? [el.Text({ children: ' ' }), bar(el, 'strip-bar', header.done, header.total)] : []),
      el.Text({ color: QUIET, children: ` · Workers ` }),
      el.Text({ bold: true, children: String(running) }),
      el.Text({ color: QUIET, children: ' · Needs you ' }),
      el.Text({ bold: true, color: decisions > 0 ? LIME : undefined, children: String(decisions) }),
    ],
  })
}

// Role, proof, the Editor lock and this week's figures; each proof is green when it passed and red when it failed.
/** @param {any} el @param {Home['header']} header */
function metaRow(el, header) {
  const parts = [
    ...(header.role ? [el.Text({ color: QUIET, children: header.role })] : []),
    ...(header.proof ? header.proof.split(' · ').map(piece => el.Text({ color: piece.endsWith('✗') ? '#ff5a45' : piece.endsWith('✓') ? '#3ccf7a' : QUIET, children: piece })) : []),
    ...(header.lock ? [el.Text({ color: QUIET, children: header.lock })] : []),
    ...(header.week ? [el.Text({ color: QUIET, children: header.week })] : []),
  ]
  return el.Box({ key: 'meta', flexDirection: 'row', flexWrap: 'wrap', children: parts.flatMap((part, index) => (index > 0 ? [el.Text({ color: QUIET, children: ' · ' }), part] : [part])) })
}

/** @param {any} el @param {Engine} $ @param {Home} model @param {number} columns @param {string} [surface] @param {Crew[]} [crew] */
function paneView(el, $, model, columns, surface, crew = []) {
  const { Box, Text, Button } = el
  isClicked = surface === 'desktop'
  const width = isClicked ? 1000 : Math.max(30, columns - 4)
  const { header } = model
  const rows = []
  const foot = isClicked ? [] : [section(el, 'foot', [Text({ key: 'foot', color: QUIET, children: 'Enter chooses · Esc closes' })])]

  if (paneMode === 'pick') {
    rows.push(masthead(el, [label(el, 'brand', 'Ather Automata', width), Text({ key: 'title', bold: true, children: 'Everything open' }), Text({ key: 'status', color: QUIET, children: 'Yours first' })], surface))
    /** @type {Map<string, Work[]>} */
    const groups = new Map()
    for (const one of model.work) {
      const group = one.kind === 'issue' ? 'Your GitHub issues' : one.area
      groups.set(group, [...(groups.get(group) ?? []), one])
    }
    let index = 0
    for (const group of [...new Set(['Your GitHub issues', ...pack.areas, 'Unsorted', ...groups.keys()])].filter(name => groups.has(name))) {
      const list = (groups.get(group) ?? []).map(one => {
        index += 1
        return choice(el, { key: `pick-${one.id}`, ...workRowProps(one), hotkey: index < 10 ? String(index) : undefined, autoFocus: index === 1, width, onPress: one.kind === 'issue' ? showIssue($, one.issue.number, 'pick') : press($, () => startWork($, one), false) })
      })
      rows.push(section(el, `group-${group}`, [label(el, `group-${group}-label`, group, width), ...list, ...(group === 'Your GitHub issues' ? [refreshIssuesButton(el, $)] : [])]))
    }
    if (!groups.has('Your GitHub issues')) rows.push(section(el, 'group-issues-none', [label(el, 'group-issues-none-label', 'Your GitHub issues', width), Text({ key: 'issues-none', color: QUIET, children: 'None assigned to you right now.' }), refreshIssuesButton(el, $)]))
    rows.push(section(el, 'back', [Button({ key: 'pick-back', label: 'Back', hotkey: hotkeyFor('0'), plain: true, dimColor: true, onPress: show($, 'home') })]))
    return Box({ flexDirection: 'column', children: rows })
  }

  if (header.stage === 'Away') {
    // Nothing is focused: one stray Enter must not end the window and lift its holds.
    const [end] = model.items
    rows.push(masthead(el, [label(el, 'brand', 'Away', width), Text({ key: 'title', bold: true, children: fit(header.title === 'Ather' ? 'The session is working' : header.title, width) }), Text({ key: 'status', children: fit(`🌙 ${header.progress}`, width) }), Text({ key: 'meta', color: QUIET, wrap: 'wrap', children: `So far: ${header.sentence}.` })], surface))
    if (end) rows.push(section(el, 'end', [choice(el, { key: 'end', title: end.title, hotkey: 'e', width, onPress: press($, () => act($, end), false) })]))
    if (!isClicked) rows.push(section(el, 'foot', [Text({ key: 'foot', color: QUIET, children: 'Esc closes' })]))
    return Box({ flexDirection: 'column', children: rows })
  }

  if (paneMode === 'issue') {
    const one = model.work.find(work => work.kind === 'issue' && work.issue.number === issueShown)
    if (one?.kind === 'issue') {
      const { issue } = one
      rows.push(masthead(el, [label(el, 'brand', `Issue #${issue.number}`, width), Text({ key: 'title', bold: true, wrap: 'wrap', children: issue.name }), Text({ key: 'meta', color: QUIET, wrap: 'wrap', children: one.hint })], surface))
      const link = linkOf(issue.url)
      rows.push(
        section(el, 'issue-actions', [
          Box({
            key: 'issue-buttons',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 3,
            children: [
              Button({ key: 'issue-start', label: '＋ Start an intent', variant: 'primary', hotkey: hotkeyFor('1'), autoFocus: true, onPress: press($, () => startWork($, one), false) }),
              ...(link ? [openControl(el, $, issue, link, { key: 'issue-open', label: '↗ Open on GitHub', hotkey: '2' }), Button({ key: 'issue-copy', label: '⧉ Copy link', plain: true, hotkey: hotkeyFor('3'), onPress: copyLink($, link) })] : []),
            ],
          }),
          Text({ key: 'issue-note', color: QUIET, wrap: 'wrap', children: 'Start an intent: the session checks for overlapping work first, then drafts an intent linked to this issue and shows you the plan. Nothing is written to GitHub.' }),
        ]),
      )
      rows.push(section(el, 'issue-back', [Button({ key: 'issue-back', label: 'Back', hotkey: hotkeyFor('0'), plain: true, dimColor: true, onPress: show($, issueBack) })]))
      rows.push(...foot)
      return Box({ flexDirection: 'column', children: rows })
    }
    paneMode = 'home'
  }

  if (paneMode === 'intent') {
    const slug = header.title
    const intent = intents.find(one => one.slug === slug)
    if (intent) {
      intentSeenAt = Date.now()
      rows.push(masthead(el, [label(el, 'brand', 'Intent', width), Text({ key: 'title', bold: true, children: fit(slug, width) }), ...(intent.goal ? [Text({ key: 'goal', wrap: 'wrap', children: intent.goal })] : [])], surface))
      const today = intentToday.slice(0, 5)
      rows.push(
        section(el, 'intent-today', [
          label(el, 'intent-today-label', 'Today', width),
          ...(today.length === 0
            ? [Text({ key: 'intent-none', color: QUIET, children: 'Nothing recorded yet today.' })]
            : today.map((one, index) =>
                Box({
                  key: `change-${index}`,
                  flexDirection: 'row',
                  gap: 1,
                  width: '100%',
                  children: [
                    Text({ color: one.kind === 'done' ? '#3ccf7a' : one.kind === 'yours' ? LIME : '#8fb8ff', children: changeGlyph(one.kind) }),
                    Box({ key: `change-${index}-words`, flexGrow: 1, children: [Button({ key: `change-${index}-press`, label: fit(one.text, width - 10), plain: true, onPress: press($, async () => { handOff($, [], `In intent ${slug}, explain in at most four lines what "${one.text}" (${one.time}) changed: what it means, the proof if there is any, and why. Quote what I said if it came from me.`); return 'asked the session about that change' }, false) })] }),
                    Text({ color: QUIET, children: one.time }),
                  ],
                }),
              )),
        ]),
      )
      if (model.next) rows.push(section(el, 'intent-next', [label(el, 'intent-next-label', 'Next', width), Box({ key: 'intent-next-card', width: '100%', borderStyle: 'round', borderColor: LIME, paddingX: 1, children: [Text({ children: fit(model.next.label, width - 4) })] })]))
      rows.push(section(el, 'intent-back', [Button({ key: 'intent-back', label: 'Back', hotkey: hotkeyFor('0'), plain: true, dimColor: true, onPress: show($, 'home') })]))
      rows.push(...foot)
      return Box({ flexDirection: 'column', children: rows })
    }
    paneMode = 'home'
  }

  if (paneMode === 'create') {
    const { editor } = model
    const editorLine = pack.createMeta(editor)
    rows.push(masthead(el, [label(el, 'brand', 'Create', width), Text({ key: 'title', bold: true, children: pack.createTitle }), Text({ key: 'meta', color: editor.isHeld ? '#f2a516' : QUIET, wrap: 'wrap', children: editorLine })], surface))
    let index = 0
    for (const { group, items } of model.create) {
      const isOpen = createOpen.has(group)
      const shown = isOpen ? items : items.slice(0, CREATE_SHOWN)
      const more = items.length - shown.length
      rows.push(
        section(el, `create-${group}`, [
          label(el, `create-${group}-label`, group, width),
          ...shown.map(one => {
            index += 1
            return choice(el, { key: one.id, title: one.verb, detail: one.description, hotkey: index < 10 ? String(index) : undefined, autoFocus: index === 1, width, onPress: press($, async () => { handOff($, [], one.prompt); return `sent to the session: ${one.verb}` }, false) })
          }),
          ...(more > 0
            ? [Button({ key: `create-${group}-more`, label: `More… (${more})`, plain: true, dimColor: true, onPress: () => { createOpen.add(group); $.ui.invalidate('ui.render') } })]
            : []),
        ]),
      )
    }
    rows.push(section(el, 'create-back', [Button({ key: 'create-back', label: 'Back', hotkey: hotkeyFor('0'), plain: true, dimColor: true, onPress: show($, 'home') })]))
    rows.push(...foot)
    return Box({ flexDirection: 'column', children: rows })
  }

  if (paneMode === 'skills') {
    rows.push(masthead(el, [label(el, 'brand', 'Skills', width), Text({ key: 'title', bold: true, children: 'Run a skill' }), Text({ key: 'meta', color: QUIET, children: header.title === 'Ather' ? 'The session reads it, says what it will do, then follows it.' : `For ${header.title}: the session reads it, says what it will do, then follows it.` })], surface))
    let index = 0
    for (const { group } of pack.skillGroups) {
      const list = model.skills.filter(one => one.group === group)
      if (list.length === 0) continue
      rows.push(
        section(el, `skills-${group}`, [
          label(el, `skills-${group}-label`, group, width),
          ...list.map(one => {
            index += 1
            return choice(el, { key: one.id, title: one.name, detail: one.description, hotkey: index < 10 ? String(index) : undefined, autoFocus: index === 1, width, onPress: press($, async () => { handOff($, [one.id], one.prompt); return `sent to the session: ${one.name}` }, false) })
          }),
        ]),
      )
    }
    rows.push(section(el, 'skills-back', [Button({ key: 'skills-back', label: 'Back', hotkey: hotkeyFor('0'), plain: true, dimColor: true, onPress: show($, 'home') })]))
    rows.push(...foot)
    return Box({ flexDirection: 'column', children: rows })
  }

  if (paneMode === 'away') {
    rows.push(masthead(el, [label(el, 'brand', 'Away', width), Text({ key: 'title', bold: true, children: 'Heading off?' }), Text({ key: 'meta', color: QUIET, wrap: 'wrap', children: pack.mandate.pane })], surface))
    rows.push(
      section(el, 'away-choices', [
        ...AWAY_PRESETS.map((preset, index) => choice(el, { key: `away-${preset.hotkey}`, title: preset.label, detail: preset.choice.untilDone ? 'Ends when the work is done, 24 hours at most.' : `Ends in ${preset.label}.`, hotkey: String(index + 1), autoFocus: index === 0, width, onPress: press($, () => startAway($, { ...preset.choice, goal: '' }), false) })),
      ]),
    )
    rows.push(section(el, 'away-back', [Button({ key: 'away-back', label: 'Back', hotkey: hotkeyFor('0'), plain: true, dimColor: true, onPress: show($, 'home') })]))
    rows.push(...foot)
    return Box({ flexDirection: 'column', children: rows })
  }

  const isUntracked = header.title === 'Ather'
  const title = isUntracked ? (model.isNewcomer ? 'Welcome' : 'What next?') : header.title
  const status = [header.stage, header.progress, header.sentence === 'waiting on you' ? '' : header.sentence].filter(Boolean).join(' · ')
  const meta = [header.role, header.proof, header.lock, header.week].filter(Boolean).join(' · ')
  rows.push(
    masthead(
      el,
      [
        label(el, 'brand', 'Ather Automata', width),
        isUntracked ? Text({ key: 'title', bold: true, children: fit(title, width) }) : Button({ key: 'title', label: fit(`${title} ›`, width), plain: true, onPress: show($, 'intent') }),
        ...(status ? [Text({ key: 'status', children: fit(status, width) })] : []),
        ...(header.stages.length > 0 ? [stageRow(el, header.stages)] : []),
        ...(meta ? [metaRow(el, header)] : []),
      ],
      surface,
    ),
  )
  rows.push(summaryStrip(el, model, crew, width))
  if (model.actions.length > 0) {
    // Start something new, or run the skill that fits now: one press each.
    rows.push(Box({ key: 'actions', flexDirection: 'row', gap: 2, marginTop: 1, children: model.actions.map(one => Button({ key: one.id, label: one.label, variant: one.isPrimary ? 'primary' : undefined, onPress: one.opens ? show($, one.opens) : press($, async () => { handOff($, [one.id], one.prompt ?? ''); return `sent to the session: ${one.label.replace(/^\S+ /, '')}` }, false) })) }))
  }

  if (model.items.length > 0) {
    rows.push(
      section(el, 'needs', [
        label(el, 'needs-label', model.open.length > 0 ? `Needs you · ${model.open.length}` : 'Needs you', width),
        // Each its own block: a lime mark, what to do, then what it is about, a blank line apart.
        ...model.items.slice(0, 9).map((one, index) => choice(el, { key: `item-${one.id}`, title: one.label, detail: one.detail ?? (one.title === one.label ? '' : one.title), mark: '◆', marginTop: index === 0 ? undefined : 1, hotkey: String(index + 1), isSent: !model.open.includes(one), autoFocus: one === model.open[0], width, onPress: press($, () => act($, one), false) })),
      ]),
    )
  }

  const next = model.next
  if (next) {
    // The one thing to do now, set apart in a lime frame.
    const card = Box({
      key: 'next-card',
      flexDirection: 'column',
      width: '100%',
      borderStyle: 'round',
      borderColor: LIME,
      paddingX: 1,
      children: withIssueIcons(el, $, next.work?.kind === 'issue' ? next.work.issue : null, choice(el, { key: 'next', title: next.label, detail: next.work?.kind === 'intent' ? workDetail(next.work) : next.hint, hotkey: 'n', isSent: sent.has(next.id), autoFocus: model.open.length === 0 && !next.action, width: width - 4, onPress: press($, () => doNext($, next), next.work?.kind === 'intent') })),
    })
    rows.push(section(el, 'next-section', [label(el, 'next-label', 'Next', width), card]))
  }

  rows.push(...crewSections(el, $, crew, width))

  if (isUntracked) {
    const mine = model.picks.filter(one => one.isMine)
    const theirs = model.picks.filter(one => !one.isMine)
    let index = 0
    /** @param {Work} one */
    const pick = one => choice(el, { key: `work-${one.id}`, ...workRowProps(one), hotkey: String.fromCharCode(97 + index++), width, onPress: one.kind === 'issue' ? showIssue($, one.issue.number, 'home') : press($, () => startWork($, one), one.kind === 'intent') })
    if (mine.length > 0) rows.push(section(el, 'picks-mine', [label(el, 'picks-mine-label', model.isNewcomer ? 'Or pick your own' : 'Also yours', width), ...mine.map(pick)]))
    // Without a name to compare, nobody's work is called a teammate's.
    if (theirs.length > 0) rows.push(section(el, 'picks-theirs', [label(el, 'picks-theirs-label', me ? 'Follow a teammate' : 'Open intents', width), ...(me ? [Text({ key: 'picks-theirs-note', color: QUIET, children: 'Read-only: their decisions stay theirs.' })] : []), ...theirs.map(pick)]))
    rows.push(Box({ key: 'all-row', marginTop: mine.length + theirs.length > 0 ? 0 : 1, children: [Button({ key: 'all', label: 'Everything open…', hotkey: hotkeyFor('i'), plain: isClicked ? undefined : true, dimColor: isClicked ? undefined : true, onPress: show($, 'pick') })] }))
  }

  if (model.offerAway) {
    const presets = AWAY_PRESETS.map(preset => Button({ key: `away-${preset.hotkey}`, label: preset.label, hotkey: hotkeyFor(preset.hotkey === 'u' ? 'u' : undefined), plain: isClicked ? undefined : true, onPress: press($, () => startAway($, { ...preset.choice, goal: '' }), false) }))
    rows.push(section(el, 'away', [label(el, 'away-label', 'Heading off?', width), Text({ key: 'away-pitch', children: 'Let AI work while you zZz' }), Box({ key: 'away-presets', flexDirection: 'row', gap: 3, children: presets })]))
  }

  rows.push(...foot)
  return Box({ flexDirection: 'column', children: rows })
}
