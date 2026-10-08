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
import { CREATE_SHOWN, skillFolder, askPrompt, batchPrompt, buildHome, heldByLine, intentStands, parseWeek, proofLine, trackConsequence, untrackText, dimColour, filterWork, personColours } from './home.mjs'
import { issuePrompt, parseIssues } from './issues.mjs'
import { parsePrState, prsToRead } from './prs.mjs'
import { STAGE_LABELS, aboutIntentPrompt, clockText, closestWord, currentStage, localMinutes, nextStep, parseIntent, searchIntents } from './model.mjs'
import { unreal } from './packs/unreal.mjs'
import * as state from './state.mjs'
import { crewOf } from './crew.mjs'
import { KINDS, PROP_WORDS, STATE_COLOURS, STATE_GLYPHS, avatarSvg, crewWords, propSvg, trailWords } from './squad.mjs'
import { homeDir, resetTranscripts, sessionName } from './transcripts.mjs'
import { recordEnd } from './workers.mjs'
import { changeGlyph } from './changes.mjs'
import { EMPTY_CACHE, GIT_ENV, NO_SYNC, canFetchNow, fetchMain, isFetchDue, readTeam, syncText } from './team.mjs'
import { SORT_LABELS, nextSort } from './worklist.mjs'
import { AMBER, INK, LIME, QUIET, choiceRow, fit, homePreview, label, needsRows, section, statusLine, workGroups } from './rows.mjs'

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
// The intent whose view is open (paneMode 'intent'; '' is the tracked one), and the view to go back to.
let intentShown = ''
let intentBack = /** @type {'home' | 'pick'} */ ('home')
// The "Everything open" list: the words searched, its sort, and the folded groups.
let pickQuery = ''
let pickSort = /** @type {import('./worklist.mjs').Sort} */ ('recent')
/** @type {Set<string>} */
const pickFolded = new Set()
// Needs you's intents opened to show each of their decisions.
/** @type {Set<string>} */
const callsOpen = new Set()
// What the last read of the team's intents learned (team.mjs reads each part again only when it moved),
// and where the background fetch stands. Both, and `intents`, change together, in readIntents.
let teamCache = EMPTY_CACHE
let sync = NO_SYNC
// A fetch that ended (the `count`th), for the first read that began after it to apply with what it brought in.
/** @type {{ count: number, sync: Partial<import('./team.mjs').Sync> } | null} */
let fetched = null
let fetchesEnded = 0
// The read running now, and whether another was asked for while it ran.
/** @type {Promise<void> | null} */
let reading = null
let isRereadAsked = false
// The pane has been drawn: from then on the fetch runs on its own, at most every ten minutes.
let isDrawn = false
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
    origin: () => readOrigin($),
    repo: async () => (await laneOf($)).repo,
  }
}

// The checkout's origin URL ('' without one), or null when git could not say: the lane asks again.
/** @param {Engine} $ @returns {Promise<string | null>} */
async function readOrigin($) {
  const run = await $.process.run(['git', 'config', '--get', 'remote.origin.url'], { cwd: cwd || (await $.session.root()), env: GIT_ENV, timeoutMs: 10000 }).catch(() => undefined)
  // Exit 1: no such key.
  return run?.exitCode === 0 ? (run.stdout ?? '').trim() : run?.exitCode === 1 ? '' : null
}

// Git and the checkout's files for team.mjs: git runs in `root` with GIT_ENV.
/** @param {Engine} $ @param {string} root @returns {import('./team.mjs').Repo} */
function repo($, root) {
  return {
    git: (args, { stdin, timeoutMs = 120000 } = {}) =>
      $.process.run(['git', '-C', root, ...args], { cwd: root, env: GIT_ENV, timeoutMs, ...(stdin === undefined ? {} : { stdin }) }).catch(error => ({ exitCode: -1, stdout: '', stderr: String(error) })),
    read: path => $.fs.read(path).then(text => (typeof text === 'string' ? text : null), () => null),
    list: path => $.fs.list(path),
    mtime: path => $.fs.stat(path).then(stat => stat.mtimeMs, () => 0),
  }
}

// What transcripts.mjs and crew.mjs need of the engine.
/** @param {Engine} $ @returns {import('./transcripts.mjs').Host} */
function host($) {
  return {
    home: async () => (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '',
    configDir: async () => (await $.env.get('CLAUDE_CONFIG_DIR')) || '',
    list: path => $.fs.list(path),
    read: path => $.fs.read(path).then(text => (typeof text === 'string' ? text : null), () => null),
    exists: path => $.fs.exists(path).catch(() => false),
    run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }).catch(() => undefined),
    agents: () => $.agent.list().catch(() => []),
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
    // Read again in the background: the turn's end never waits on git.
    if (!e.agentId && (await laneOf($)).isS2) void refresh($).catch(() => undefined)
    // A worker's turn ended: it finished now, not when the pane is next drawn.
    if (e.agentId) recordEnd(e.agentId, Date.now())
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

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    void wake($)
    isDrawn = true
    void syncMain($)
    if (paneMode === 'intent') await readIntentView($)
    return paneView($.ui.resolve(e), $, await home($), e.props.bodyColumns ?? 80, e.surface, await crewOf(host($), (await laneOf($)).root, await state.sessionId(io($))))
  })

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
  resetTranscripts()
  isAwake = null
  view = { version: -1, at: 0, model: null }
  closedHint = null
  intentSeenAt = Date.now()
  intentShown = ''
  intentBack = 'home'
  pickQuery = ''
  pickSort = 'recent'
  pickFolded.clear()
  callsOpen.clear()
  teamCache = EMPTY_CACHE
  sync = NO_SYNC
  fetched = null
  fetchesEnded = 0
  isDrawn = false
  createOpen.clear()
  cwd = folder
  for (const command of [
    { name: 'ather', description: 'Ather Automata: what needs you, and what is next', argumentHint: '[pick | find <words> | issues | issue <number> | tour | skip | role <role> | checked | intent <name> | untrack]' },
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
  $.clock.every(60000, () => void refresh($).then(() => (isDrawn ? syncMain($) : undefined)).catch(() => undefined))
  // A running worker's clock: redrawn every five seconds while one runs, never otherwise.
  $.clock.every(5000, () => {
    void $.agent.list().then(agents => agents.some(agent => agent.status === 'running') && $.ui.invalidate('ui.render')).catch(() => undefined)
  })
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

// Re-reads the intents (origin/main's and this checkout's, team.mjs), one read at a time: a call while
// one runs asks for one more after it and waits for that, so the last read to land is the newest.
// The rest comes from shared state when the view is rebuilt.
/** @param {Engine} $ @returns {Promise<void>} */
function refresh($) {
  if (reading) {
    isRereadAsked = true
    return reading
  }
  reading = (async () => {
    try {
      do {
        isRereadAsked = false
        await readIntents($)
      } while (isRereadAsked)
    } finally {
      reading = null
    }
  })()
  return reading
}

/** @param {Engine} $ */
async function readIntents($) {
  // Only a fetch that ended before this read began is applied with what this read finds.
  const seen = fetchesEnded
  const { root, me: who, pack: chosen } = await laneOf($)
  if (who !== me) stale()
  me = who
  pack = chosen
  const files = io($)
  const pinned = await state.readPinned(files)
  const team = await readTeam(repo($, root), root, { cache: teamCache, pinned })
  const read = []
  for (const one of team.intents) read.push(parseIntent({ ...one, hasDebrief: one.slug === pinned && (await files.exists(`${root}/${chosen.debriefPath(one.slug)}`)) }, chosen))
  const ended = fetched && fetched.count <= seen ? fetched : null
  if (ended) fetched = null
  teamCache = team.cache
  intents = read.sort((a, b) => b.updatedAt - a.updatedAt)
  sync = { ...sync, ...ended?.sync, isRepo: team.isRepo, hasMain: team.cache.main !== null }
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

// Fetches origin's main in the background (D2): once the pane is drawn, then at most every ten minutes,
// or at once from ↻ (after a git lock, only at the next due time); one at a time. The sync line says
// synced once the read after the fetch has landed; a failure keeps the last list and says so.
/** @param {Engine} $ @param {boolean} [isAsked] */
async function syncMain($, isAsked = false) {
  if (!(isAsked ? canFetchNow : isFetchDue)(sync, Date.now())) return
  sync = { ...sync, isFetching: true, triedAt: Date.now() }
  $.ui.invalidate('ui.render')
  const { error, lock, moved } = await fetchMain(repo($, (await laneOf($)).root))
  $.ui.log(error ? `Ather: git fetch failed: ${error}` : `Ather: origin/main ${moved ? 'moved' : 'is up to date'}.`, { to: 'debug' })
  fetchesEnded += 1
  fetched = { count: fetchesEnded, sync: { isFetching: false, error, lock, ...(error ? { failedAt: Date.now() } : { fetchedAt: Date.now() }) } }
  await refresh($).catch(() => undefined)
  // The reads failed: the fetch's outcome is still said.
  if (fetched) {
    sync = { ...sync, ...fetched.sync }
    fetched = null
    $.ui.invalidate('ui.render')
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
  // The week-calendar plugin keeps this week's figures in ~/.calendar/latest.json.
  const userHome = await homeDir(host($))
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
    workers: (await $.agent.list().catch(() => [])).filter(agent => agent.status === 'running').length,
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
  const name = await sessionName(host($), root, lock.session).catch(() => '')
  return { ...lock, holder: name ? `"${name}"` : `session ${lock.session}` }
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
  if (work.kind === 'intent') return trackSlug($, work.slug)
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

// Tracks an intent by its folder name: the deliberate act (Work on this here, Next, /ather intent <name>).
/** @param {Engine} $ @param {string} slug */
async function trackSlug($, slug) {
  const { root } = await laneOf($)
  // An intent read from origin/main that this checkout does not have yet cannot be worked on here.
  if (!(await state.track(io($), root, slug, { me }))) return intents.some(one => one.slug === slug) ? `${slug} is on origin/main but not in this checkout yet: pull main to work on it here, or use Ask about it in its view to hear where it stands.` : `No intent named "${slug}" in docs/intent.`
  await refresh($)
  return `Now tracking ${slug}.`
}

// /ather intent <name> and /ather pick <name>: an exact folder name tracks it; words show the one intent they match.
/** @param {Engine} $ @param {string} text */
async function pickIntent($, text) {
  return intents.some(one => one.slug === text) ? trackSlug($, text) : lookUp($, text)
}

// Words that match one intent show it and never track it; several are listed; none is said.
/** @param {Engine} $ @param {string} text */
async function lookUp($, text) {
  const matches = searchIntents(intents, text)
  const [only] = matches
  if (matches.length === 1 && only) return showIntent($, only.slug)
  return matches.length > 1 ? `${matches.length} intents match "${text}": ${matches.slice(0, 8).map(one => one.slug).join(', ')}.` : `No open intent matches "${text}".`
}

// Looking at an intent: its view in the pane, where Work on this here tracks it. Without a pane,
// where it stands and the command that tracks it.
/** @param {Engine} $ @param {string} slug */
async function showIntent($, slug) {
  if (await hasPane($)) {
    intentShown = slug
    intentBack = 'home'
    return openPane($, 'intent')
  }
  return whereText($, slug)
}

// Without a pane or a dialog: where an intent stands, and the command that works on it here.
/** @param {Engine} $ @param {string} slug */
async function whereText($, slug) {
  const pinned = await state.readPinned(io($))
  const one = (await home($)).work.find(work => work.kind === 'intent' && work.slug === slug)
  const where = one ? one.hint : slug
  return slug === pinned ? `${where}. This session tracks it.` : `${where}. To work on it in this session: /ather intent ${slug}`
}

// A row's press: the intent's view, never tracking it.
/** @param {Engine} $ @param {string} slug @param {'home' | 'pick'} back */
function viewIntent($, slug, back) {
  return () => {
    intentShown = slug
    intentBack = back
    paneMode = 'intent'
    $.ui.invalidate('ui.render')
  }
}

// Stops tracking the session's intent: /ather untrack, and Stop tracking in the Intent view.
/** @param {Engine} $ */
async function untrackHere($) {
  const outcome = await state.untrack(io($), me)
  if (outcome.result === 'untracked') await refresh($)
  return untrackText(outcome)
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
  if (searchIntents(intents, text).length > 0) return lookUp($, text)
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
const COMMAND_WORDS = ['tour', 'skip', 'pick', 'find', 'issues', 'issue', 'intent', 'role', 'checked', 'untrack']

/** @param {Engine} $ @param {string} args */
async function atherCommand($, args) {
  const word = args.split(/\s+/)[0]?.toLowerCase() ?? ''
  const rest = args.slice(word.length).trim()
  if (word === 'tour' || word === 'tours') return startTour($)
  if (word === 'skip') return skipTour($)
  if (word === 'untrack' && rest === '') return untrackHere($)
  if (word === 'find') {
    if (rest) setSearch($, rest)
    if (await hasPane($)) return openPane($, 'pick')
    return rest ? findText($) : searchQuestion($)
  }
  if ((word === 'intent' || word === 'pick') && rest) return pickIntent($, rest)
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
    // The question is the verb: a choice works on it at once, and says so (D5).
    choices: work.map(one => ({ label: cut(one.label, 40), description: workChoiceText(one), run: () => startWork($, one) })),
    fallback: 'Nothing chosen.',
    onTyped: text => typedWork($, text),
  })
}

// A Work-question choice's line: where it stands, then what choosing it does.
/** @param {Work} one */
function workChoiceText(one) {
  return one.kind === 'intent' ? `${ended(workDetail(one))} ${trackConsequence(pack)}` : `${ended(one.hint)} Drafts an intent with you first.`
}

// A line ended as a sentence, unless it was cut short ("…").
/** @param {string} text */
const ended = text => (/[.…]$/.test(text) ? text : `${text}.`)

// Typed in the Work question: a name never tracks at once (D5). One match asks what to do with it
// (the phone's Intent view); a few become the choices; more are listed; anything else is read as in any dialog.
/** @param {Engine} $ @param {string} text */
async function typedWork($, text) {
  const words = text.trim()
  // The tour and an issue number mean what they mean anywhere.
  if (/^tours?$/i.test(words) || /^#?\d+$/.test(words)) return typed($, text)
  const matches = intents.some(one => one.slug === words) ? intents.filter(one => one.slug === words) : searchIntents(intents, words)
  const [only] = matches
  if (matches.length === 1 && only) return intentQuestion($, only.slug)
  if (matches.length > 1 && matches.length <= 4) {
    const work = (await home($)).work
    return ask($, {
      header: 'Work',
      question: `${matches.length} intents match "${words}". Which one should this session work on?`,
      choices: matches.map(one => {
        const row = work.find(item => item.kind === 'intent' && item.slug === one.slug)
        return { label: cut(one.slug, 40), description: `${row ? `${ended(workDetail(row))} ` : ''}${trackConsequence(pack)}`, run: () => trackSlug($, one.slug) }
      }),
      fallback: await lookUp($, words),
      onTyped: more => typed($, more),
    })
  }
  return typed($, text)
}

// One intent named in the Work question, without a pane: where it stands, what working on it here
// means, and three ways on. Where no dialog can be asked, the reply says how to work on it instead.
/** @param {Engine} $ @param {string} slug */
async function intentQuestion($, slug) {
  const intent = intents.find(one => one.slug === slug)
  if (!intent) return lookUp($, slug)
  const files = io($)
  const { root, pack: chosen } = await laneOf($)
  const { role } = await state.readProfile(files, me, chosen)
  const evidence = await state.readEvidence(files, await state.intentScope(files, slug), chosen)
  const prs = await state.readPrStates(files)
  const stands = intentStands(intent, STAGE_LABELS[currentStage(intent, evidence, role, prs, chosen)], me, heldByLine(await state.readPeers(files, root, chosen.localDir), slug, Date.now()))
  const look = async () => {
    const step = nextStep(role, intent, evidence, 0, me, prs, chosen)
    return `${stands}${step ? ` Its next step: ${step.label}.` : ''} Not tracked here; /ather intent ${slug} works on it in this session.`
  }
  return ask($, {
    header: slug,
    question: `${stands} Work on it here? ${trackConsequence(chosen)}`,
    choices: [
      { label: 'Work on it here', description: 'Tracks it in this session now.', run: () => trackSlug($, slug) },
      { label: 'Just look', description: 'Says where it stands and its next step; tracks nothing.', run: look },
      { label: 'Pick something else', description: 'Back to what this session could work on.', run: () => workQuestion($) },
    ],
    fallback: await whereText($, slug),
    onTyped: more => typed($, more),
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

// ---------------------------------------------------------------- the work list's search and filters

// Narrows "Everything open" to the words (title, number, area or owner); '' shows everything.
/** @param {Engine} $ @param {string} text */
function setSearch($, text) {
  pickQuery = text.trim()
  $.ui.invalidate('ui.render')
  return pickQuery ? `Searching for "${pickQuery}".` : 'Showing everything.'
}

/** @param {Engine} $ */
function cycleSort($) {
  pickSort = nextSort(pickSort)
  $.ui.invalidate('ui.render')
}

// Folds or unfolds a group of Everything open, or opens or closes an intent's decisions in Needs you.
/** @param {Engine} $ @param {Set<string>} opened @param {string} key */
function toggleIn($, opened, key) {
  if (!opened.delete(key)) opened.add(key)
  $.ui.invalidate('ui.render')
}

// Without a pane: what the search found, in a line.
/** @param {Engine} $ */
async function findText($) {
  const found = filterWork((await home($)).work, pickQuery)
  return found.length === 0 ? `Nothing matches "${pickQuery}".` : `${found.length} match "${pickQuery}": ${found.slice(0, 8).map(one => one.label).join(', ')}${found.length > 8 ? ', …' : ''}.`
}

// The pane has no text box: one question, and what is typed under Other is the search.
/** @param {Engine} $ */
async function searchQuestion($) {
  return ask($, {
    header: 'Search',
    question: `Search everything open by title, issue number, area or owner. Type the words under Other.${pickQuery ? ` Searching for "${pickQuery}" now.` : ''}`,
    choices: [{ label: 'Show everything', description: 'Clear the search.', run: async () => setSearch($, '') }],
    fallback: pickQuery ? `Still searching for "${pickQuery}".` : 'Nothing searched.',
    onTyped: async text => setSearch($, text),
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

// ---------------------------------------------------------------- the pane

// The palette is rows.mjs's: lime only for what needs the person. Each teammate has a colour (set when
// the pane is drawn, from everyone in the list).
/** @type {Record<string, string>} */
let peopleColours = {}

// The Ather mark: the A, its lime I, and the 5 raised as a power.
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><polygon points="6,98 40,14 60,14 94,98 76,98 50,36 24,98" fill="#C9CCCC"/><rect x="47.5" y="56" width="5" height="28" fill="#DDFF00"/><text x="86" y="40" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="40" fill="#DDFF00">5</text></svg>'

// On the desktop the pane is clicked, and its keys reach it only once it is clicked into (opened from
// the band it never takes the keyboard): letters there promise what they cannot do, so none are drawn.
let isClicked = false
/** @param {string | undefined} hotkey */
const hotkeyFor = hotkey => (isClicked ? undefined : hotkey)

/** @param {any} el @param {import('./rows.mjs').Choice} row */
const choice = (el, row) => choiceRow(el, row, isClicked)

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

// Plan ✓ ─ Build ● ─ Prove ○ ─ Ship ○, lit up to where the work is.
/** @param {any} el @param {Home['header']['stages']} stages */
function stageRow(el, stages) {
  return el.Box({
    key: 'stages',
    flexDirection: 'row',
    children: stages.flatMap((one, index) => [
      ...(index > 0 ? [el.Text({ key: `stage-gap-${index}`, color: QUIET, children: ' ─ ' })] : []),
      el.Text({ key: `stage-${index}`, color: one.state === 'todo' ? QUIET : INK, bold: one.state === 'now', children: `${one.label} ${one.state === 'done' ? '✓' : one.state === 'now' ? '●' : '○'}` }),
    ]),
  })
}

/** @param {any} el @param {any[]} lines @param {string | undefined} surface */
function masthead(el, lines, surface) {
  const words = el.Box({ key: 'head-words', flexDirection: 'column', children: lines })
  return surface === 'desktop' && el.Svg ? el.Box({ key: 'head', flexDirection: 'row', gap: 2, alignItems: 'center', children: [el.Svg({ source: MARK, alt: 'Ather', width: 48, height: 40 }), words] }) : words
}

/** @param {Work} one */
const workDetail = one => (one.kind === 'intent' ? one.hint.replace(`${one.slug} · `, '') : one.hint)

/** @typedef {import('./worklist.mjs').RowCells} RowCells */

// How this pane draws work rows (rows.mjs): its surface and width, teammates' colours dimmed, and a
// press that shows the intent (or the issue's card), never tracking it.
/** @param {Engine} $ @param {number} width @param {'home' | 'pick'} back @returns {import('./rows.mjs').Look} */
function lookOf($, width, back) {
  return { isClicked, width, now: Date.now(), isTagged: sync.hasMain, ownerColour: name => dimColour(peopleColours[name] ?? QUIET, 0.3), onRow: one => (one.kind === 'issue' ? showIssue($, one.issue.number, back) : viewIntent($, one.slug, back)) }
}

// The header's status line, with how fresh the team's list is at its right: ↻ (f) fetches now.
/** @param {any} el @param {Engine} $ @param {string} text @param {number} width */
function headerLine(el, $, text, width) {
  return statusLine(el, { text, fresh: syncText(sync, Date.now()), width, hotkey: hotkeyFor('f'), onPress: () => void syncMain($, true) })
}

// ---------------------------------------------------------------- what the intent recorded

/** @type {{ kind: 'done' | 'yours' | 'changed', text: string, time: string }[]} */
let intentToday = []

// What the Intent view shows beside the intent's files: whether this session tracks it, its proof
// (each record another session wrote named by it), the other live sessions tracking it.
/** @type {{ slug: string, isHere: boolean, inCheckout: boolean, proof: string, heldBy: string }} */
let intentView = { slug: '', isHere: false, inCheckout: true, proof: '', heldBy: '' }

// The shown intent (the tracked one unless a row or words chose another): its lines since the start
// of the person's day, newest first, with their time; and the rest of what its view shows.
/** @param {Engine} $ */
async function readIntentView($) {
  const files = io($)
  const { root, pack: chosen } = await laneOf($)
  const pinned = await state.readPinned(files)
  const slug = intentShown || pinned || ''
  const tz = await state.readTz(files)
  const now = Date.now()
  const lines = slug ? await state.readChanges(files, slug, now - localMinutes(now, tz) * 60000) : []
  intentToday = lines.map(one => ({ kind: one.kind, text: one.text, time: clockText(one.at, tz) }))
  const mine = state.shortSession(await state.sessionId(files))
  const evidence = await state.readEvidence(files, slug ? await state.intentScope(files, slug) : mine, chosen)
  const others = [...new Set(Object.values(evidence).map(rung => rung?.by ?? '').filter(by => by !== '' && by !== mine))]
  const names = Object.fromEntries(await Promise.all(others.map(async by => [by, await sessionName(host($), root, by).catch(() => '')])))
  // Working on it here needs its folder in this checkout; asking about it does not.
  const inCheckout = slug === '' || (await state.hasIntentFolder(files, root, slug))
  intentView = { slug, isHere: slug !== '' && slug === pinned, inCheckout, proof: slug ? proofLine(evidence, chosen, mine, names) : '', heldBy: heldByLine(await state.readPeers(files, root, chosen.localDir), slug, now) }
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
  intentShown = ''
  intentBack = 'home'
  await openPane($, 'intent')
}

// ---------------------------------------------------------------- workers

/** @typedef {import('./crew.mjs').Crew} Crew */

const DONE_SHOWN = 3

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
  const { doing, line } = crewWords(one)
  const kindLine = el.Box({ key: `${one.id}-kind`, flexDirection: 'row', children: [el.Text({ color: look.fill, bold: true, children: look.word }), el.Text({ color: QUIET, children: ` · ${[one.model, doing].filter(Boolean).join(' · ')}` })] })
  const how = isLive
    ? el.Text({ key: `${one.id}-how`, color: QUIET, wrap: 'wrap', children: line })
    : el.Box({
        key: `${one.id}-how`,
        flexDirection: 'row',
        children: [
          ...(isClicked && one.trail.length > 0
            ? one.trail.flatMap((prop, index) => [...(index > 0 ? [el.Text({ color: QUIET, children: ' → ' })] : []), el.Svg({ source: propSvg(prop), alt: PROP_WORDS[prop], width: 22, height: 22 })])
            : one.trail.length > 0 ? [el.Text({ color: QUIET, children: trailWords(one.trail) })] : []),
          el.Text({ color: STATE_COLOURS[one.state], children: `${one.trail.length > 0 ? ' ' : ''}${STATE_GLYPHS[one.state]}` }),
          ...(line ? [el.Text({ color: QUIET, children: ` · ${line}` })] : []),
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
  return el.Box({ key, flexDirection: 'row', children: [el.Text({ color: INK, children: '━'.repeat(lit) }), el.Text({ color: '#3a3c36', children: '━'.repeat(10 - lit) })] })
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
  peopleColours = personColours(model.work.flatMap(one => (one.kind === 'intent' && !one.isMine && one.who ? [one.who] : [])))
  const { Box, Text, Button } = el
  isClicked = surface === 'desktop'
  const width = isClicked ? 1000 : Math.max(30, columns - 4)
  const { header } = model
  const rows = []
  const foot = isClicked ? [] : [section(el, 'foot', [Text({ key: 'foot', color: QUIET, children: 'Enter chooses · Esc closes' })])]

  if (paneMode === 'pick') {
    const shown = filterWork(model.work, pickQuery)
    rows.push(masthead(el, [Text({ key: 'title', bold: true, children: 'Everything open' }), headerLine(el, $, pickQuery ? `${shown.length} of ${model.work.length}` : `${model.work.length} open · yours first`, width)].filter(Boolean), surface))
    // The pane has no text box: Search asks one question and takes the words typed under Other. Sort cycles Recent, Ready to close, Oldest.
    const search = Button({ key: 'pick-search', label: pickQuery ? `Search: ${fit(pickQuery, 24)}` : 'Search…', hotkey: hotkeyFor('s'), plain: true, onPress: press($, () => searchQuestion($), true) })
    const clear = pickQuery ? [Button({ key: 'pick-search-clear', label: '✕ Clear', plain: true, dimColor: true, onPress: () => setSearch($, '') })] : []
    const sort = Button({ key: 'pick-sort', label: `Sort: ${SORT_LABELS[pickSort]}`, hotkey: hotkeyFor('o'), plain: true, onPress: () => cycleSort($) })
    rows.push(Box({ key: 'pick-search-row', flexDirection: 'row', gap: 3, marginTop: 1, children: [search, ...clear, sort] }))
    rows.push(...workGroups(el, lookOf($, width, 'pick'), { work: model.work, shown, query: pickQuery, sort: pickSort, folded: pickFolded, me, onFold: key => () => toggleIn($, pickFolded, key), issuesFoot: [refreshIssuesButton(el, $)] }))
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
    const { slug, isHere } = intentView
    const intent = intents.find(one => one.slug === slug)
    if (intent) {
      // Seeing the tracked intent's view settles the band's notice; another intent's view does not.
      if (isHere) intentSeenAt = Date.now()
      rows.push(
        masthead(
          el,
          [
            label(el, 'brand', 'Intent', width),
            Text({ key: 'title', bold: true, children: fit(slug, width) }),
            ...(intent.goal ? [Text({ key: 'goal', wrap: 'wrap', children: intent.goal })] : []),
            ...(intentView.proof ? [Text({ key: 'proof', color: QUIET, wrap: 'wrap', children: `Proof: ${intentView.proof}` })] : []),
            ...(intentView.heldBy ? [Text({ key: 'held-by', color: AMBER, wrap: 'wrap', children: intentView.heldBy })] : []),
          ],
          surface,
        ),
      )
      // Looking never tracks: working on it here is its own press, and needs its folder in this
      // checkout. Asking about it never needs one: the session reads it from origin/main if it must.
      const askButton = Button({ key: 'intent-ask', label: 'Ask about it', variant: intentView.inCheckout ? undefined : 'primary', hotkey: hotkeyFor('a'), onPress: press($, async () => { handOff($, [], aboutIntentPrompt(slug, intent.source === 'main')); return `asked the session about ${slug}` }, false) })
      const work = intentView.inCheckout ? [Button({ key: 'intent-work', label: 'Work on this here', variant: 'primary', hotkey: hotkeyFor('w'), onPress: press($, () => trackSlug($, slug), true) })] : []
      if (!isHere) rows.push(Box({ key: 'intent-actions', flexDirection: 'row', gap: 2, marginTop: 1, children: [...work, askButton] }))
      if (!isHere && !intentView.inCheckout) rows.push(Text({ key: 'intent-not-here', color: QUIET, wrap: 'wrap', children: 'Not in this checkout yet: pull main to work on it here.' }))
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
      if (isHere && model.next) rows.push(section(el, 'intent-next', [label(el, 'intent-next-label', 'Next', width, LIME), Box({ key: 'intent-next-card', width: '100%', borderStyle: 'round', borderColor: LIME, paddingX: 1, children: [Text({ children: fit(model.next.label, width - 4) })] })]))
      const back = Button({ key: 'intent-back', label: 'Back', hotkey: hotkeyFor('0'), plain: true, dimColor: true, onPress: show($, intentBack) })
      // Stop tracking keeps the view on this intent, which then offers Work on this here again.
      const stop = Button({ key: 'intent-untrack', label: 'Stop tracking', hotkey: hotkeyFor('s'), plain: true, dimColor: true, onPress: press($, () => ((intentShown = slug), untrackHere($)), true) })
      rows.push(section(el, 'intent-back', isHere ? [Box({ key: 'intent-back-row', flexDirection: 'row', gap: 3, children: [stop, back] })] : [back]))
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
        // The pane's title bar names Ather: no brand line repeats it (D7).
        isUntracked ? Text({ key: 'title', bold: true, children: fit(title, width) }) : Button({ key: 'title', label: fit(`${title} ›`, width), plain: true, onPress: viewIntent($, header.title, 'home') }),
        headerLine(el, $, status, width),
        ...(header.stages.length > 0 ? [stageRow(el, header.stages)] : []),
        ...(meta ? [metaRow(el, header)] : []),
      ].filter(Boolean),
      surface,
    ),
  )
  rows.push(summaryStrip(el, model, crew, width))
  // Needs you and Needs attention share the digit keys.
  let digits = 0
  const digit = () => (digits < 9 ? String(++digits) : undefined)
  if (model.actions.length > 0) {
    // Start something new, or run the skill that fits now: one press each.
    rows.push(Box({ key: 'actions', flexDirection: 'row', gap: 2, marginTop: 1, children: model.actions.map(one => Button({ key: one.id, label: one.label, variant: one.isPrimary ? 'primary' : undefined, onPress: one.opens ? show($, one.opens) : press($, async () => { handOff($, [one.id], one.prompt ?? ''); return `sent to the session: ${one.label.replace(/^\S+ /, '')}` }, false) })) }))
  }

  if (model.items.length > 0) {
    rows.push(
      section(el, 'needs', [
        label(el, 'needs-label', model.open.length > 0 ? `Needs you · ${model.open.length}` : 'Needs you', width, LIME),
        ...needsRows(el, isClicked, { items: model.items, open: model.open, opened: callsOpen, width, key: digit, onAct: one => press($, () => act($, one), false), onToggle: slug => () => toggleIn($, callsOpen, slug) }),
      ]),
    )
  }

  if (model.attention.length > 0) {
    // The person's own intents that want a press; each opens its intent, nothing is done for them.
    rows.push(section(el, 'attention', [label(el, 'attention-label', `Needs attention · ${model.attention.length}`, width, LIME), ...model.attention.map(one => choice(el, { key: one.id, title: `${one.title} · ${one.ask}`, mark: one.kind === 'close' ? '✓' : '‖', hotkey: digit(), width, onPress: viewIntent($, one.slug, 'home') }))]))
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
    rows.push(section(el, 'next-section', [label(el, 'next-label', 'Next', width, LIME), card]))
  }

  rows.push(...crewSections(el, $, crew, width))

  rows.push(...homePreview(el, lookOf($, width, 'home'), { own: model.own, team: model.teamPreview, isNewcomer: model.isNewcomer, me, onAll: show($, 'pick') }))

  if (model.offerAway) {
    const presets = AWAY_PRESETS.map(preset => Button({ key: `away-${preset.hotkey}`, label: preset.label, hotkey: hotkeyFor(preset.hotkey === 'u' ? 'u' : undefined), plain: isClicked ? undefined : true, onPress: press($, () => startAway($, { ...preset.choice, goal: '' }), false) }))
    rows.push(section(el, 'away', [label(el, 'away-label', 'Heading off?', width), Text({ key: 'away-pitch', children: 'Let AI work while you zZz' }), Box({ key: 'away-presets', flexDirection: 'row', gap: 3, children: presets })]))
  }

  rows.push(...foot)
  return Box({ flexDirection: 'column', children: rows })
}
