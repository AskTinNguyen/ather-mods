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
import { issueId, issueLink, issueOrder, issuePrompt, parseIssues } from './issues.mjs'
import { parsePrState, prsToRead } from './prs.mjs'
import { STAGE_LABELS, aboutIntentPrompt, clockText, closestWord, currentStage, cutWords, directorCalls, localMinutes, nextStep, otherRoot, parseIntent, searchIntents } from './model.mjs'
import { unreal } from './packs/unreal.mjs'
import * as state from './state.mjs'
import { crewOf } from './crew.mjs'
import { crewSections } from './crew-rows.mjs'
import { homeDir, resetTranscripts, sessionName } from './transcripts.mjs'
import { recordEnd } from './workers.mjs'
import { endLoop } from './inflight.mjs'
import { changeGlyph } from './changes.mjs'
import { EMPTY_CACHE, GIT_ENV, NO_SYNC, canFetchNow, fetchMain, isFetchDue, readTeam, syncSummary, syncText } from './team.mjs'
import { checkoutNames, checkoutOf, normalFolder } from './workspace.mjs'
import { withFolders } from './shell.mjs'
import { GROUP_LABELS, SORT_LABELS, nextGroup, nextSort } from './worklist.mjs'
import { AMBER, LIME, QUIET, choiceRow, findingRows, fit, homePreview, label, masthead, metaRow, needsRows, section, stageRow, statusLine, summaryStrip, workGroups } from './rows.mjs'
import { DECIDED_SHOWN_MS, FRESH_ANSWERS, callId, needsView, pruneDecided, withDecided } from './decide.mjs'

/** @typedef {import('claude-code').EngineInterface} Engine */
/** @typedef {'home' | 'pick' | 'away' | 'skills' | 'issue' | 'intent' | 'create' | 'finding'} Mode */
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
let paneMode = /** @type {Mode} */ ('home')
// Create groups opened past their first three.
/** @type {Set<string>} */
const createOpen = new Set()
// Intent changes after this were not seen yet: they make the band's notice.
let intentSeenAt = 0
// The issue whose card is open (paneMode 'issue'), and the view to go back to.
let issueShown = ''
let issueBack = /** @type {'home' | 'pick'} */ ('home')
// The intent whose view is open (paneMode 'intent'; its key, '' for the tracked one), and the view to go back to.
let intentShown = ''
let intentBack = /** @type {'home' | 'pick'} */ ('home')
// The "Everything open" list: the words searched, its sort, how the teammates' intents are grouped
// (read from the person's stored choice once a session), and the heads pressed to fold or unfold.
let pickQuery = ''
let pickSort = /** @type {import('./worklist.mjs').Sort} */ ('recent')
let pickGroup = /** @type {import('./worklist.mjs').GroupBy} */ ('person')
let isGroupRead = false
// Presses of Group: a stored choice read back after a press does not undo it.
let groupPresses = 0
/** @type {Set<string>} */
const pickFolded = new Set()
// Needs you's intents opened to show each of their decisions.
/** @type {Set<string>} */
const callsOpen = new Set()
// Answering in place (0.2.0, decide.mjs AnswerState): kept in this session only; this session's answers
// stay until the files read them resolved. Then two view fields: the finding Open findings shows, and
// whether Search's field is open.
/** @type {import('./decide.mjs').AnswerState} */
let answerState = { ...FRESH_ANSWERS }
let findingShown = ''
let isSearchOpen = false
// Per checkout root: what the last read of its team's intents learned (team.mjs reads each part again
// only when it moved), and where its background fetch stands. Both, and `intents`, change together, in readIntents.
/** @type {Map<string, import('./team.mjs').TeamCache>} */
const teamCaches = new Map()
/** @type {Map<string, import('./team.mjs').Sync>} */
const syncs = new Map()
// Per checkout root, a fetch that ended (the `count`th), for the first read that began after it to apply with what it brought in.
/** @type {Map<string, { count: number, sync: Partial<import('./team.mjs').Sync> }>} */
const fetched = new Map()
let fetchesEnded = 0
// A fetch is running: one at a time over every checkout.
let isSyncing = false
// The pane's checkouts, as last read (paneLanes): the workspace checkouts that have intents.
/** @type {import('./state.mjs').Checkout[]} */
let checkouts = []
// The workspace checkouts other than the session's own, read once per session.
/** @type {Promise<string[]> | null} */
let otherRoots = null
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
// The `repos` option: more checkouts this session works with.
let repos = ''
/** @type {{ version: number, at: number, model: Home | null }} */
let view = { version: -1, at: 0, model: null }
// The pack whose words the pane uses (packs/index.mjs, wordsLane); set whenever the view is rebuilt.
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
    gitUser: async root => ((await $.process.run(['git', 'config', 'user.name'], { cwd: root || cwd || (await $.session.root()), timeoutMs: 10000 })).stdout ?? '').trim(),
    redraw: () => $.ui.invalidate('ui.render'),
    list: path => $.fs.list(path),
    origin: root => readOrigin($, root),
    repo: async () => (await laneOf($)).repo,
  }
}

// The origin URL of the checkout at `root` ('' without one), or null when git could not say: the lane asks again.
/** @param {Engine} $ @param {string} root @returns {Promise<string | null>} */
async function readOrigin($, root) {
  const run = await $.process.run(['git', 'config', '--get', 'remote.origin.url'], { cwd: root, env: GIT_ENV, timeoutMs: 10000 }).catch(() => undefined)
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

// The pane's checkouts: the workspace checkouts that have intents, in workspace order, the session's own
// (its lane) first. A session opened in a parent folder has none of its own.
/** @param {Engine} $ @returns {Promise<import('./state.mjs').Checkout[]>} */
async function paneLanes($) {
  const session = await laneOf($)
  if (!otherRoots) otherRoots = readOtherRoots($, session.root)
  const others = []
  for (const root of await otherRoots) {
    const lane = await state.laneAt(io($), root)
    if (lane.isS2) others.push(lane)
  }
  return session.isS2 ? [session, ...others] : others
}

/** @param {Engine} $ @param {string} root the session lane's root */
async function readOtherRoots($, root) {
  const files = io($)
  const own = new Set([normalFolder(root), normalFolder((await checkoutOf(files, root)) ?? root)])
  return (await state.workspace(files, cwd || root, repos, line => $.ui.log(line, { to: 'debug' }))).filter(one => !own.has(normalFolder(one)))
}

// The lane an intent's checkout has in the pane (the session's for its own).
/** @param {Engine} $ @param {string} root */
async function laneFor($, root) {
  return checkouts.find(one => normalFolder(one.root) === normalFolder(root)) ?? (await laneOf($))
}

// The lane of the checkout a worker's shell command runs in: its last segment's, as its proof is read (watch.mjs afterShell).
/** @param {Engine} $ @param {string} command */
async function commandLane($, command) {
  return (await state.folderLane(io($), await laneOf($), withFolders(command).at(-1)?.folder ?? null)).lane
}

// The lane whose pack gives the pane its words (Next, Create, Prove, the role): the tracked intent's
// checkout, else the session's own when it has intents, else the first pane checkout.
/** @param {Engine} $ */
async function wordsLane($) {
  const tracked = await state.trackedLane(io($), cwd)
  const session = await laneOf($)
  return tracked ? tracked.lane : session.isS2 ? session : (checkouts[0] ?? session)
}

// Whether a pane checkout is the session's own (the session lane is read again until git's answers are sure,
// so it is matched by root, not by object).
/** @param {import('./state.mjs').Checkout} session @param {import('./state.mjs').Checkout} lane */
function isOwnLane(session, lane) {
  return session.isS2 && normalFolder(lane.root) === normalFolder(session.root)
}

// An intent's key in the pane: its slug in the session's own checkout, `<its checkout's short name>/<slug>` in another.
/** @param {string} name @param {boolean} isOwn @param {string} slug */
function keyOf(name, isOwn, slug) {
  return isOwn ? slug : `${name}/${slug}`
}

// The short name of each checkout the pane works with, by its folder: the workspace's checkouts in order, then
// the tracked intent's when it is outside them. Each is different (checkoutNames), so keys and lookups by name agree;
// the workspace's never change in a session, whatever is tracked, so a key built earlier still names its intent.
/** @param {Engine} $ @returns {Promise<Map<string, string>>} */
async function laneNames($) {
  const session = await laneOf($)
  const listed = await issueLanes($)
  // A session folder with intents that is no checkout is in the pane, though no issues are read there.
  const lanes = session.isS2 && !listed.some(one => normalFolder(one.root) === normalFolder(session.root)) ? [session, ...listed] : [...listed]
  const tracked = await state.trackedLane(io($), cwd)
  const outside = tracked && !lanes.some(one => normalFolder(one.root) === normalFolder(tracked.lane.root)) ? [tracked.lane] : []
  const names = checkoutNames(lanes, outside)
  return new Map([...lanes, ...outside].map((lane, at) => [normalFolder(lane.root), names[at] ?? '']))
}

/** @param {Engine} $ @param {import('./state.mjs').Checkout} lane */
async function shortName($, lane) {
  return (await laneNames($)).get(normalFolder(lane.root)) ?? ''
}

// The tracked intent's key, '' when nothing is tracked.
/** @param {Engine} $ */
async function trackedKey($) {
  const tracked = await state.trackedLane(io($), cwd)
  if (!tracked) return ''
  return tracked.isOwn ? tracked.slug : keyOf(await shortName($, tracked.lane), false, tracked.slug)
}

/** @param {Engine} $ */
async function hasIntents($) {
  return (await paneLanes($)).length > 0
}

/** @param {import('claude-code').On} on @param {import('claude-code').PluginOptions} [options] */
export function register(on, options) {
  repos = String(options?.repos ?? '')
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
    if (!e.agentId && (await hasIntents($))) void refresh($).catch(() => undefined)
    // A worker's turn ended: it finished now, not when the pane is next drawn.
    if (e.agentId) recordEnd(e.agentId, Date.now())
    // Its turn is over: nothing in its loop is in flight, whatever did not settle.
    if (e.agentId) endLoop(e.agentId)
    if (e.agentId) $.ui.invalidate('ui.render')
    return result
  })

  on('command.run', { command: 'ather' }, async ($, e) => {
    if (!(await hasIntents($))) return { text: (await laneOf($)).pack.notHere }
    await wake($)
    await refresh($).catch(() => undefined)
    return { text: await atherCommand($, e.args.trim()) }
  })

  on('command.run', { command: 'away' }, async ($, e) => {
    if (!(await hasIntents($))) return { text: (await laneOf($)).pack.notHere }
    await wake($)
    return { text: await awayCommand($, e.args.trim()) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await hasIntents($))) return next(e)
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
    if (paneMode === 'pick' && !isGroupRead) await readGroup($)
    return paneView($.ui.resolve(e), $, await home($), e.props.bodyColumns ?? 80, e.surface, await crewOf(host($), (await laneOf($)).root, await state.sessionId(io($)), (await laneOf($)).pack, command => commandLane($, command)))
  })

  on('ui.close', ($, e, next) => {
    if (e.id === PANE_ID) {
      // Only the view resets: this session's answers stay.
      paneMode = 'home'
      isSearchOpen = false
      answerState = { ...answerState, typing: '' }
    }
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
  pickGroup = 'person'
  isGroupRead = false
  callsOpen.clear()
  answerState = { ...FRESH_ANSWERS }
  findingShown = ''
  isSearchOpen = false
  teamCaches.clear()
  syncs.clear()
  fetched.clear()
  isSyncing = false
  checkouts = []
  otherRoots = null
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
  await state.workspace(io($), cwd || lane.root, repos, line => $.ui.log(line, { to: 'debug' }))
  if (lane.me !== '') me = lane.me
  pack = lane.pack
  if (!(await hasIntents($))) return
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
    $.ui.toast(pack.prompts.tourToast, { timeoutMs: 12000 })
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
  const session = await laneOf($)
  if (session.me !== me) stale()
  me = session.me
  const files = io($)
  const lanes = await paneLanes($)
  const tracked = await state.readTracked(files)
  const names = await laneNames($)
  const read = []
  for (const lane of lanes) {
    const { root, pack: its } = lane
    const isOwn = isOwnLane(session, lane)
    const name = names.get(normalFolder(root)) ?? ''
    // Its intents: one tracked in another checkout is not one of them.
    const pinned = tracked && normalFolder(tracked.root) === normalFolder(root) ? tracked.slug : null
    const team = await readTeam(repo($, root), root, { cache: teamCaches.get(root) ?? EMPTY_CACHE, pinned })
    const tag = { root, repo: lane.repo, repoName: name }
    for (const one of team.intents) read.push(parseIntent({ ...one, ...tag, key: keyOf(name, isOwn, one.slug), hasDebrief: one.slug === pinned && (await files.exists(`${root}/${its.debriefPath(one.slug)}`)) }, its))
    const ended = fetched.get(root)
    const isApplied = ended !== undefined && ended.count <= seen
    if (isApplied) fetched.delete(root)
    teamCaches.set(root, team.cache)
    syncs.set(root, { ...(syncs.get(root) ?? NO_SYNC), ...(isApplied ? ended.sync : {}), isRepo: team.isRepo, hasMain: team.cache.main !== null })
  }
  checkouts = lanes
  intents = read.sort((a, b) => b.updatedAt - a.updatedAt)
  // This session's answers to decisions are kept until the files read them resolved; an answer to
  // anything else (a rule) has no file to settle it, so it stays for the session.
  const waiting = new Set(intents.flatMap(one => directorCalls(one).map(finding => callId(one.key, finding.id))))
  answerState = { ...answerState, decided: pruneDecided(answerState.decided, id => waiting.has(id) || !id.startsWith('call:'), Date.now()) }
  const { root, pack: chosen } = await wordsLane($)
  pack = chosen
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
    // Each checkout's intents: their PRs are its repository's, read with gh there.
    for (const { root, repo: scope } of await paneLanes($)) {
      const its = intents.filter(one => normalFolder(one.root) === normalFolder(root))
      /** @type {Record<string, import('./model.mjs').PrState>} */
      const read = {}
      for (const number of prsToRead(its, await state.readPrRecords(io($), scope), Date.now())) {
        const run = await $.process.run(['gh', 'pr', 'view', String(number), '--json', 'state,mergedAt'], { cwd: root, timeoutMs: 30000 }).catch(() => undefined)
        read[number] = (run && run.exitCode === 0 ? parsePrState(run.stdout) : null) ?? 'UNREAD'
      }
      await state.setPrStates(io($), read, Date.now(), scope)
    }
  } finally {
    isPrsReading = false
  }
}

// Fetches each pane checkout's origin main in the background (D2): once the pane is drawn, then at most
// every ten minutes, or at once from ↻ (after a git lock, only at the next due time); one fetch at a time
// over every checkout. The sync line says synced once the read after the fetch has landed; a failure keeps
// the last list and says so.
/** @param {Engine} $ @param {boolean} [isAsked] */
async function syncMain($, isAsked = false) {
  if (isSyncing) return
  isSyncing = true
  try {
    for (const { root } of await paneLanes($)) {
      const before = syncs.get(root) ?? NO_SYNC
      if (!(isAsked ? canFetchNow : isFetchDue)(before, Date.now())) continue
      syncs.set(root, { ...before, isFetching: true, triedAt: Date.now() })
      $.ui.invalidate('ui.render')
      const { error, lock, moved } = await fetchMain(repo($, root))
      const where = checkouts.length > 1 ? ` (${root})` : ''
      $.ui.log(error ? `Ather: git fetch failed${where}: ${error}` : `Ather: origin/main${where} ${moved ? 'moved' : 'is up to date'}.`, { to: 'debug' })
      fetchesEnded += 1
      fetched.set(root, { count: fetchesEnded, sync: { isFetching: false, error, lock, ...(error ? { failedAt: Date.now() } : { fetchedAt: Date.now() }) } })
      await refresh($).catch(() => undefined)
      // The reads failed: the fetch's outcome is still said.
      const ended = fetched.get(root)
      if (ended) {
        syncs.set(root, { ...(syncs.get(root) ?? NO_SYNC), ...ended.sync })
        fetched.delete(root)
        $.ui.invalidate('ui.render')
      }
    }
  } finally {
    isSyncing = false
  }
}

// Where the pane's checkouts' fetches stand, as one: the sync line's.
function syncShown() {
  return syncSummary(checkouts.map(({ root }) => syncs.get(root) ?? NO_SYNC))
}

function stale() {
  view = { ...view, version: -1 }
}

// The GitHub issues assigned to the person, read with gh. Without gh, or signed out, there are
// simply none: one line in the debug log, never an error on screen. Never writes to GitHub.
// Each workspace repository is read in turn, in its first checkout, and its list kept under it.
/** @param {Engine} $ @returns {Promise<string>} why a read failed, or '' when every one worked */
async function refreshIssues($) {
  const lanes = oncePerRepo(await issueLanes($))
  const failures = []
  for (const { root, repo: scope } of lanes) {
    const run = await $.process.run(['gh', 'issue', 'list', '--assignee', '@me', '--state', 'open', '--limit', '30', '--json', 'number,title,url,labels,updatedAt'], { cwd: root, timeoutMs: 30000 }).catch(() => undefined)
    if (run && run.exitCode === 0) {
      await state.setIssues(io($), me, parseIssues(run.stdout), scope)
      continue
    }
    // Signed out: the last list may be stale, so none is shown.
    if (/auth login|not logged in|authentication/i.test(run?.stderr ?? '')) await state.setIssues(io($), me, [], scope)
    if (!isIssuesWarned) $.ui.log(`Ather: could not read your GitHub issues (is gh installed and signed in?) ${run?.stderr?.slice(0, 200) ?? ''}`, { to: 'debug' })
    isIssuesWarned = true
    const failure = (run?.stderr || (run ? `gh exited with ${run.exitCode}` : 'gh could not be started (is it installed and on PATH?)')).trim().slice(0, 300)
    failures.push(lanes.length > 1 ? `${root}: ${failure}` : failure)
  }
  if (failures.length === 0) {
    issueRetries = 0
    return ''
  }
  // A slow first start or a network blip is tried again in a minute, three times at most:
  // without gh at all, the 15-minute refresh is enough.
  if (issueRetries < 3) {
    issueRetries += 1
    $.clock.after(60000, () => void refreshIssues($).catch(() => undefined))
  }
  return failures.join('; ')
}

// The checkouts whose issues are read: every workspace checkout, intents or not, the session's own first.
// A session folder in no checkout (a parent folder) has no issues of its own, unless it is all there is.
/** @param {Engine} $ */
async function issueLanes($) {
  const session = await laneOf($)
  if (!otherRoots) otherRoots = readOtherRoots($, session.root)
  const others = []
  for (const root of await otherRoots) others.push(await state.laneAt(io($), root))
  const isCheckout = session.isS2 || (await checkoutOf(io($), session.root)) !== null
  return isCheckout || others.length === 0 ? [session, ...others] : others
}

// One checkout for each repository: the first in order, so the session's own when it is one of them. A
// repository's issues are the same in every checkout of it.
/** @param {import('./state.mjs').Checkout[]} lanes */
function oncePerRepo(lanes) {
  return lanes.filter((lane, at) => lanes.findIndex(one => one.repo === lane.repo) === at)
}

// An issue as a checkout lists it: its key is its number in the session's own checkout and `<short name>#<number>` in another.
/** @param {import('./issues.mjs').Issue} issue @param {import('./state.mjs').Checkout} lane @param {string} name @param {boolean} isOwn @returns {import('./issues.mjs').Issue} */
function issueAt(issue, lane, name, isOwn) {
  return { ...issue, root: lane.root, repo: lane.repo, repoName: name, key: isOwn ? String(issue.number) : `${name}#${issue.number}` }
}

// The assigned issues of every workspace repository, in workspace order, each tagged with the checkout that lists it.
/** @param {Engine} $ @returns {Promise<import('./issues.mjs').Issue[]>} */
async function paneIssues($) {
  const session = await laneOf($)
  const names = await laneNames($)
  const read = []
  for (const lane of oncePerRepo(await issueLanes($))) {
    const isOwn = normalFolder(lane.root) === normalFolder(session.root)
    for (const issue of await state.readIssues(io($), me, lane.repo)) read.push(issueAt(issue, lane, names.get(normalFolder(lane.root)) ?? '', isOwn))
  }
  return read
}

// Every pane checkout's PR states in one map: the session's own by number, another's by `<root>#<number>` (prKey).
/** @param {Engine} $ @returns {Promise<import('./model.mjs').PrStates>} */
async function panePrs($) {
  const session = await laneOf($)
  /** @type {Record<string, import('./model.mjs').PrState>} */
  const all = {}
  for (const lane of await paneLanes($)) {
    const isOwn = normalFolder(lane.root) === normalFolder(session.root)
    for (const [number, value] of Object.entries(await state.readPrStates(io($), lane.repo))) all[isOwn ? number : `${lane.root}#${number}`] = value
  }
  return all
}

/** @param {Engine} $ @returns {Promise<Home>} */
async function home($) {
  const version = state.stateVersion()
  if (view.model && view.version === version && Date.now() - view.at < VIEW_TTL_MS) return view.model
  const files = io($)
  const { me: who } = await laneOf($)
  // The tracked intent's checkout gives the stage its pack, the role and the Editor lock.
  const { root, pack: chosen } = await wordsLane($)
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
    pinned: (await trackedKey($)) || null,
    me,
    ...profile,
    evidence: await state.readEvidence(files, await state.evidenceScope(files), chosen),
    away,
    ledger: away.phase === 'off' ? '' : ((await files.read(away.ledgerPath)) ?? ''),
    lost: await state.readLost(files),
    lock: await namedLock($, root, chosen.parseLock(chosen.lockFile ? await files.read(`${root}/${chosen.lockFile}`) : null, localMinutes(now, tz))),
    recurring: await state.readRecurring(files, chosen),
    issues: (await paneIssues($)).sort(issueOrder),
    prs: await panePrs($),
    week: userHome ? parseWeek(await files.read(`${userHome}/.calendar/latest.json`), now) : null,
    last: await lastKey($),
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

// The intent the person last worked on, by key: the "Continue …" kept in each pane checkout's repository,
// the session's own first. With one checkout, its slug as kept.
/** @param {Engine} $ */
async function lastKey($) {
  const session = await laneOf($)
  if (checkouts.length <= 1 && session.isS2) return state.readLast(io($), me)
  for (const lane of checkouts) {
    const isOwn = isOwnLane(session, lane)
    const slug = await state.readLast(io($), me, isOwn ? undefined : lane.root)
    if (slug && intents.some(one => one.slug === slug && normalFolder(one.root) === normalFolder(lane.root))) return keyOf(await shortName($, lane), isOwn, slug)
  }
  return null
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

// An answer given in place: the row shows "✓ Decided" for a while, then folds. The session gets
// `prompt` ('' gives it nothing: the press only closes the item); the item settles after the row has shown.
/** @param {Engine} $ @param {Item} one @param {string} answer @param {string} prompt */
async function answerItem($, one, answer, prompt) {
  // A double click or a second Enter before the redraw: one answer, one prompt, one timer.
  if (sent.has(one.id)) return `already answered: ${answer}`
  answerState = { ...answerState, opened: '', typing: '', decided: withDecided(answerState.decided, { id: one.id, answer, at: Date.now() }) }
  $.clock.after(DECIDED_SHOWN_MS + 100, () => $.ui.invalidate('ui.render'))
  const settle = () => new Promise(resolve => $.clock.after(DECIDED_SHOWN_MS, () => resolve(state.settleItem(io($), one))))
  const unanswer = async () => void (answerState = { ...answerState, decided: answerState.decided.filter(each => each.id !== one.id) })
  if (prompt) handOff($, [one.id], prompt, settle, unanswer)
  else {
    sent.add(one.id)
    stale()
    void settle()
  }
  $.ui.invalidate('ui.render')
  return prompt ? `sent your answer to the session: ${answer}` : `closed: ${answer}`
}

// A typed answer, from the field or the dialog's Other: the person's words are the choice.
/** @param {Engine} $ @param {Item} one @param {import('./decide.mjs').Answers} answers @param {string} words */
async function answerTyped($, one, answers, words) {
  const text = words.trim()
  return text === '' ? 'Nothing answered.' : answerItem($, one, text, answers.typed(text))
}

// Type an answer: a field under the row where the surface has one, else the question dialog's Other.
/** @param {Engine} $ @param {Item} one @param {import('./decide.mjs').Answers} answers @param {boolean} hasInput */
async function typeAnswer($, one, answers, hasInput) {
  if (hasInput) {
    answerState = { ...answerState, typing: one.id }
    $.ui.invalidate('ui.render')
    return 'type your answer and press Enter.'
  }
  /** @type {Choice[]} */
  const choices = answers.options.slice(0, 4).map(option => ({ label: cutWords(`${option.letter}: ${option.label}${option.isRecommended ? ' (Recommended)' : ''}`, 60), description: cutWords(option.text, 200), run: () => answerItem($, one, option.letter, option.prompt) }))
  if (choices.length === 0) choices.push({ label: 'Explain it first', description: 'The session explains it; nothing is decided.', run: async () => (handOff($, [], answers.explain), 'asked the session to explain it.') })
  return ask($, { header: 'Answer', question: `${one.question}. Pick one, or type your own answer under Other.`, choices, fallback: 'Nothing answered.', onTyped: words => answerTyped($, one, answers, words) })
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
  if (work.kind === 'intent') return trackKey($, work.key)
  handOff($, [work.id], work.prompt)
  return `Sent issue #${work.issue.number} to the session: it checks for overlapping work first, then drafts the intent with you.`
}

// An issue by number, from the assigned list or not: `7` or `#7` the session checkout's issue 7, else the first
// pane checkout's; `web#7` the one in the checkout named web, which starts it there even when another checkout
// of its repository lists it.
/** @param {Engine} $ @param {string} ref @param {boolean} [isInQuestion] */
async function startIssue($, ref, isInQuestion = false) {
  const [, name, digits] = /^(?:([\w.-]+)#|#)?(\d+)$/.exec(ref.trim()) ?? []
  const number = Number(digits)
  const session = await laneOf($)
  const names = await laneNames($)
  const lane = name ? (await issueLanes($)).find(one => names.get(normalFolder(one.root)) === name) : undefined
  if (name && !lane) return `No checkout here is named ${name}.`
  const isOwn = lane !== undefined && normalFolder(lane.root) === normalFolder(session.root)
  const listed = (await paneIssues($)).filter(one => one.number === number)
  const found = lane ? listed.find(one => one.repo === lane.repo) : (listed.find(one => one.key === String(number)) ?? listed[0])
  const assigned = found && lane ? issueAt(found, lane, name ?? '', isOwn) : found
  if (assigned) {
    handOff($, [issueId(assigned)], issuePrompt(assigned, me))
    return `Sent issue #${number} to the session: it checks for overlapping work first, then drafts the intent with you.`
  }
  /** @type {import('./issues.mjs').Issue} */
  let issue = { number, title: '', name: '', url: '', labels: [], updatedAt: 0, area: 'Unsorted', isUrgent: false }
  if (lane && !isOwn) issue = issueAt(issue, lane, name ?? '', false)
  const go = async () => {
    handOff($, [issueId(issue)], issuePrompt(issue, me))
    return `Sent issue #${number} to the session: it checks for overlapping work first, then drafts the intent with you.`
  }
  // Already inside a question: the session confirms instead of a third dialog.
  if (isInQuestion) {
    handOff($, [issueId(issue)], `Issue #${number} is not assigned to me. Ask me to confirm before starting it; then: ${issuePrompt(issue, me)}`)
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
// `at`: another workspace checkout holding it.
/** @param {Engine} $ @param {string} slug @param {string} [at] */
async function trackSlug($, slug, at) {
  const { root } = await laneOf($)
  // An intent read from origin/main that this checkout does not have yet cannot be worked on here.
  if (!(await state.track(io($), at ?? root, slug, { me }))) return intents.some(one => one.slug === slug) ? `${slug} is on origin/main but not in this checkout yet: pull main to work on it here, or use Ask about it in its view to hear where it stands.` : `No intent named "${slug}" in docs/intent.`
  await refresh($)
  // Its key names the checkout when it is another's: "web/login".
  return `Now tracking ${(await trackedKey($)) || slug}.`
}

// Tracks a listed intent by its key, in its own checkout.
/** @param {Engine} $ @param {string} key */
async function trackKey($, key) {
  const intent = intents.find(one => one.key === key)
  return intent ? trackSlug($, intent.slug, otherRoot(intent) || undefined) : trackSlug($, key)
}

// /ather intent <name> and /ather pick <name>: an exact key or folder name tracks it; words show the one intent
// they match. A name only another workspace checkout has is tracked there (this checkout first, then workspace order).
/** @param {Engine} $ @param {string} text */
async function pickIntent($, text) {
  const { root } = await laneOf($)
  if (intents.some(one => one.key === text)) return trackKey($, text)
  if (intents.some(one => one.slug === text && otherRoot(one) === '') || (await state.hasIntentFolder(io($), root, text))) return trackSlug($, text)
  for (const other of await state.workspace(io($), cwd || root, repos)) {
    if (await state.hasIntentFolder(io($), other, text)) return trackSlug($, text, other)
  }
  // Only on origin/main: tracking says it is not here yet.
  if (intents.some(one => one.slug === text)) return trackSlug($, text)
  return lookUp($, text)
}

// Words that match one intent show it and never track it; several are listed; none is said.
/** @param {Engine} $ @param {string} text */
async function lookUp($, text) {
  const matches = searchIntents(intents, text)
  const [only] = matches
  if (matches.length === 1 && only) return showIntent($, only.key)
  return matches.length > 1 ? `${matches.length} intents match "${text}": ${matches.slice(0, 8).map(one => one.key).join(', ')}.` : `No open intent matches "${text}".`
}

// Looking at an intent: its view in the pane, where Work on this here tracks it. Without a pane,
// where it stands and the command that tracks it.
/** @param {Engine} $ @param {string} key */
async function showIntent($, key) {
  if (await hasPane($)) {
    intentShown = key
    intentBack = 'home'
    return openPane($, 'intent')
  }
  return whereText($, key)
}

// Without a pane or a dialog: where an intent stands, and the command that works on it here.
/** @param {Engine} $ @param {string} key */
async function whereText($, key) {
  const pinned = await trackedKey($)
  const one = (await home($)).work.find(work => work.kind === 'intent' && work.key === key)
  const where = one ? one.hint : key
  return key === pinned ? `${where}. This session tracks it.` : `${where}. To work on it in this session: /ather intent ${key}`
}

// A row's press: the intent's view (by key), never tracking it.
/** @param {Engine} $ @param {string} key @param {'home' | 'pick'} back */
function viewIntent($, key, back) {
  return () => {
    intentShown = key
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
  if (number) return startIssue($, number[1] ?? number[2] ?? '', isInQuestion)
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
  if ((word === 'issue' || word === 'issues') && /^(?:[\w.-]+#|#)?\d+$/.test(rest)) return startIssue($, rest)
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
    if ((await paneIssues($)).length === 0) return 'No open GitHub issues are assigned to you.'
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
    if (mine) choices.push({ label: cutWords(mine.kind === 'issue' ? `Start #${mine.issue.number} ${mine.issue.name}` : `Pick up ${mine.key}`, 40), description: mine.hint, run: () => startWork($, mine) })
    choices.push({ label: 'Skip the tour', description: 'You know your way around; Ather asks your role instead.', run: () => skipTour($) })
  }
  // What happened while the person was away is reviewed on its own, before anything else.
  const review = model.open.find(one => one.kind === 'review' || one.kind === 'away-end')
  if (review) choices.push({ label: review.label, description: review.question, run: () => act($, review) })
  const rest = model.open.filter(one => one !== review)
  const [only] = rest
  if (rest.length === 1 && only) choices.push({ label: only.label, description: only.question, run: () => act($, only) })
  else if (rest.length > 1) choices.push({ label: `Go through ${rest.length} things`, description: cutWords(rest.map(one => one.question).join(' · '), 200), run: () => actAll($, rest) })
  if (next && !next.isTour && !sent.has(next.id)) choices.push({ label: cutWords(next.work?.kind === 'intent' || next.action ? next.label : `Next: ${next.label}`, 40), description: next.hint, run: () => doNext($, next) })
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

// What a piece of work is called in a line or a choice: an intent by its key, since two checkouts may hold one slug.
/** @param {Work} one */
function workName(one) {
  return one.kind === 'intent' ? one.key : one.label
}

/** @param {Engine} $ */
async function workQuestion($) {
  const work = (await home($)).work.slice(0, 4)
  if (work.length === 0) return 'Nothing open yet: start an intent with /intent and what you want.'
  return ask($, {
    header: 'Work',
    question: 'What should this session work on? Your intents and your GitHub issues come first. Or type a name, or an issue #number.',
    // The question is the verb: a choice works on it at once, and says so (D5).
    choices: work.map(one => ({ label: cutWords(workName(one), 40), description: workChoiceText(one), run: () => startWork($, one) })),
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
  const exact = intents.filter(one => one.key === words)
  const named = exact.length > 0 ? exact : intents.filter(one => one.slug === words)
  const matches = named.length > 0 ? named : searchIntents(intents, words)
  const [only] = matches
  if (matches.length === 1 && only) return intentQuestion($, only.key)
  if (matches.length > 1 && matches.length <= 4) {
    const work = (await home($)).work
    return ask($, {
      header: 'Work',
      question: `${matches.length} intents match "${words}". Which one should this session work on?`,
      choices: matches.map(one => {
        const row = work.find(item => item.kind === 'intent' && item.key === one.key)
        return { label: cutWords(one.key, 40), description: `${row ? `${ended(workDetail(row))} ` : ''}${trackConsequence(pack)}`, run: () => trackKey($, one.key) }
      }),
      fallback: await lookUp($, words),
      onTyped: more => typed($, more),
    })
  }
  return typed($, text)
}

// One intent named in the Work question, without a pane: where it stands, what working on it here
// means, and three ways on. Where no dialog can be asked, the reply says how to work on it instead.
/** @param {Engine} $ @param {string} key */
async function intentQuestion($, key) {
  const intent = intents.find(one => one.key === key)
  if (!intent) return lookUp($, key)
  const { slug } = intent
  const files = io($)
  // Read in its own checkout, with that checkout's pack and the person's role there.
  const { root, pack: chosen } = await laneFor($, intent.root)
  const { role } = await state.readProfile(files, me, chosen)
  const evidence = await state.readEvidence(files, await state.intentScope(files, slug, otherRoot(intent) || undefined), chosen)
  const prs = await panePrs($)
  const stands = intentStands(intent, STAGE_LABELS[currentStage(intent, evidence, role, prs, chosen)], me, heldByLine(await state.readPeers(files, root, chosen.localDir), slug, Date.now()))
  const look = async () => {
    const step = nextStep(role, intent, evidence, 0, me, prs, chosen)
    return `${stands}${step ? ` Its next step: ${step.label}.` : ''} Not tracked here; /ather intent ${key} works on it in this session.`
  }
  return ask($, {
    header: key,
    question: `${stands} Work on it here? ${trackConsequence(chosen)}`,
    choices: [
      { label: 'Work on it here', description: 'Tracks it in this session now.', run: () => trackKey($, key) },
      { label: 'Just look', description: 'Says where it stands and its next step; tracks nothing.', run: look },
      { label: 'Pick something else', description: 'Back to what this session could work on.', run: () => workQuestion($) },
    ],
    fallback: await whereText($, key),
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

// Group: Person → Area → Stage → None, remembered for the person (folds are not).
/** @param {Engine} $ */
function cycleGroup($) {
  pickGroup = nextGroup(pickGroup)
  groupPresses += 1
  isGroupRead = true
  $.ui.invalidate('ui.render')
  void state.setGroupBy(io($), me, pickGroup).catch(() => undefined)
}

/** @param {Engine} $ */
async function readGroup($) {
  const pressesBefore = groupPresses
  const stored = await state.readGroupBy(io($), me).catch(() => pickGroup)
  if (groupPresses === pressesBefore) pickGroup = stored
  isGroupRead = true
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
  return found.length === 0 ? `Nothing matches "${pickQuery}".` : `${found.length} match "${pickQuery}": ${found.slice(0, 8).map(workName).join(', ')}${found.length > 8 ? ', …' : ''}.`
}

// Where the surface draws no text field (and for /ather find without words): one question, and what is typed under Other is the search.
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

/** @param {Engine} $ @param {Mode} mode */
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
        const count = failure ? 0 : (await paneIssues($)).length
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

/** @param {Engine} $ @param {Mode} mode */
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

// On the desktop the pane is clicked, and its keys reach it only once it is clicked into (opened from
// the band it never takes the keyboard): letters there promise what they cannot do, so none are drawn.
let isClicked = false
/** @param {string | undefined} hotkey */
const hotkeyFor = hotkey => (isClicked ? undefined : hotkey)

/** @param {any} el @param {import('./rows.mjs').Choice} row */
const choice = (el, row) => choiceRow(el, row, isClicked)

// gh opens it from the checkout it was read in.
/** @param {Engine} $ @param {import('./issues.mjs').Issue} issue @param {string} link */
function openIssue($, { number, root }, link) {
  return () =>
    void (root ? Promise.resolve({ root }) : laneOf($))
      .then(({ root: at }) => $.process.run(['gh', 'issue', 'view', String(number), '--web'], { cwd: at, timeoutMs: 20000 }))
      .then(run => $.ui.toast(run.exitCode === 0 ? `Ather: opened issue #${number} in your browser.` : `Ather: could not open the browser; the link is ${link}`))
      .catch(() => $.ui.toast(`Ather: could not open the browser; the link is ${link}`))
}

// Open on GitHub: a link the desktop opens on a click; in the terminal, a button.
/** @param {any} el @param {Engine} $ @param {import('./issues.mjs').Issue} issue @param {string} link @param {{ key: string, label: string, hotkey?: string, isQuiet?: boolean }} look */
function openControl(el, $, issue, link, look) {
  return isClicked ? el.Link({ key: look.key, href: link, label: look.label }) : el.Button({ key: look.key, label: look.label, plain: true, hotkey: look.hotkey, dimColor: look.isQuiet ? true : undefined, onPress: openIssue($, issue, link) })
}

/** @param {Engine} $ @param {string} link */
function copyLink($, link) {
  return (/** @type {{ surface?: string }} */ pressed) =>
    void $.ui
      .copy({ text: link, surface: /** @type {any} */ (pressed)?.surface })
      .then(result => $.ui.toast(result.isCopied ? 'Ather: issue link copied.' : `Ather: could not copy the link (${result.reason}).`))
      .catch(error => $.ui.toast(`Ather: could not copy the link: ${String(error)}`))
}

/** @param {Engine} $ @param {string} id the issue's work id @param {'home' | 'pick'} back */
function showIssue($, id, back) {
  return () => {
    issueShown = id
    issueBack = back
    paneMode = 'issue'
    $.ui.invalidate('ui.render')
  }
}

// A choice with an issue's open and copy icons: beside it on the desktop, beneath it in the terminal.
/** @param {any} el @param {Engine} $ @param {import('./issues.mjs').Issue | null} issue @param {any} row */
function withIssueIcons(el, $, issue, row) {
  const link = issue ? issueLink(issue.url) : ''
  if (!link) return [row]
  const icons = el.Box({ key: 'next-icons', flexDirection: 'row', gap: 2, children: [el.Link({ key: 'next-open', href: link, label: '↗' }), el.Button({ key: 'next-copy', label: '⧉', plain: true, dimColor: true, onPress: copyLink($, link) })] })
  return isClicked ? [el.Box({ key: 'next-with-icons', flexDirection: 'row', width: '100%', children: [el.Box({ key: 'next-main', flexGrow: 1, children: [row] }), icons] })] : [row, el.Box({ key: 'next-icons-row', paddingLeft: 3, children: [el.Box({ key: 'next-icons-words', flexDirection: 'row', gap: 2, children: [openControl(el, $, /** @type {import('./issues.mjs').Issue} */ (issue), link, { key: 'next-open', label: '↗ Open on GitHub', hotkey: 'o', isQuiet: true }), el.Button({ key: 'next-copy', label: '⧉ Copy link', plain: true, hotkey: 'y', dimColor: true, onPress: copyLink($, link) })] })] })]
}

/** @param {Work} one */
const workDetail = one => (one.kind === 'intent' ? one.hint.replace(`${one.slug} · `, '') : one.hint)

/** @typedef {import('./worklist.mjs').RowCells} RowCells */

// How this pane draws work rows (rows.mjs): its surface and width, teammates' colours dimmed, and a
// press that shows the intent (or the issue's card), never tracking it.
/** @param {Engine} $ @param {number} width @param {'home' | 'pick'} back @returns {import('./rows.mjs').Look} */
function lookOf($, width, back) {
  return { isClicked, width, now: Date.now(), isTagged: one => (one.root ? syncs.get(one.root)?.hasMain : checkouts.some(({ root }) => syncs.get(root)?.hasMain)) === true, ownerColour: name => dimColour(peopleColours[name] ?? QUIET, 0.3), onRow: one => (one.kind === 'issue' ? showIssue($, one.id, back) : viewIntent($, one.key, back)) }
}

// The header's status line, with how fresh the team's list is at its right: ↻ (f) fetches now.
/** @param {any} el @param {Engine} $ @param {string} text @param {number} width */
function headerLine(el, $, text, width) {
  return statusLine(el, { text, fresh: syncText(syncShown(), Date.now()), width, hotkey: hotkeyFor('f'), onPress: () => void syncMain($, true) })
}

// ---------------------------------------------------------------- what the intent recorded

/** @type {{ kind: 'done' | 'yours' | 'changed', text: string, time: string }[]} */
let intentToday = []

// What the Intent view shows beside the intent's files: whether this session tracks it, its proof
// (each record another session wrote named by it), the other live sessions tracking it. `intent`: the
// tracked intent read from its own files when its checkout is not one the pane lists.
/** @type {{ key: string, slug: string, isHere: boolean, inCheckout: boolean, proof: string, heldBy: string, intent: import('./model.mjs').Intent | null }} */
let intentView = { key: '', slug: '', isHere: false, inCheckout: true, proof: '', heldBy: '', intent: null }

// The shown intent (the tracked one unless a row or words chose another): its lines since the start
// of the person's day, newest first, with their time; and the rest of what its view shows, read in
// its own checkout.
/** @param {Engine} $ */
async function readIntentView($) {
  const files = io($)
  const tracked = await state.trackedLane(files, cwd)
  const pinned = await trackedKey($)
  const key = intentShown || pinned
  const shown = intents.find(one => one.key === key)
  const isTracked = tracked !== null && key === pinned
  const slug = isTracked ? tracked.slug : (shown?.slug ?? key)
  const { root, pack: chosen } = isTracked ? tracked.lane : shown ? await laneFor($, shown.root) : await laneOf($)
  const tz = await state.readTz(files)
  const now = Date.now()
  const lines = slug ? await state.readChanges(files, slug, now - localMinutes(now, tz) * 60000, root) : []
  intentToday = lines.map(one => ({ kind: one.kind, text: one.text, time: clockText(one.at, tz) }))
  const mine = state.shortSession(await state.sessionId(files))
  const evidence = await state.readEvidence(files, slug ? await state.intentScope(files, slug, root) : mine, chosen)
  const others = [...new Set(Object.values(evidence).map(rung => rung?.by ?? '').filter(by => by !== '' && by !== mine))]
  const names = Object.fromEntries(await Promise.all(others.map(async by => [by, await sessionName(host($), root, by).catch(() => '')])))
  // Working on it here needs its folder in its checkout; asking about it does not.
  const inCheckout = slug === '' || (await state.hasIntentFolder(files, root, slug))
  const intent = isTracked && !shown ? await readTrackedIntent($, tracked, key) : null
  intentView = { key, slug, isHere: isTracked, inCheckout, proof: slug ? proofLine(evidence, chosen, mine, names) : '', heldBy: heldByLine(await state.readPeers(files, root, chosen.localDir), slug, now), intent }
}

// The tracked intent from its own files, for a checkout outside the pane's (a write into a folder the
// workspace does not name); undefined when its prompt is gone.
/** @param {Engine} $ @param {{ slug: string, lane: import('./state.mjs').Checkout }} tracked @param {string} key */
async function readTrackedIntent($, { slug, lane }, key) {
  const files = io($)
  const dir = `${lane.root}/docs/intent/${slug}`
  const prompt = await files.read(`${dir}/prompt.md`)
  if (prompt === null) return null
  return parseIntent({
    slug,
    key,
    root: lane.root,
    repoName: await shortName($, lane),
    prompt,
    findings: (await files.read(`${dir}/findings.md`)) ?? '',
    progress: (await files.read(`${dir}/progress.md`)) ?? '',
    files: (await $.fs.list(dir).catch(() => [])).map(entry => entry.name),
    hasDebrief: await files.exists(`${lane.root}/${lane.pack.debriefPath(slug)}`),
    updatedAt: 0,
    source: 'local',
    firstAuthor: '',
  }, lane.pack)
}

// The tracked intent's lines this session has not shown yet: the band's notice.
/** @param {Engine} $ */
async function unseenChanges($) {
  const tracked = await state.trackedLane(io($), cwd)
  return tracked ? state.readChanges(io($), tracked.slug, intentSeenAt + 1, tracked.lane.root) : []
}

/** @param {Engine} $ */
async function seeIntent($) {
  intentSeenAt = Date.now()
  intentShown = ''
  intentBack = 'home'
  await openPane($, 'intent')
}

// ---------------------------------------------------------------- workers (drawn in crew-rows.mjs)

/** @typedef {import('./crew.mjs').Crew} Crew */

// A press on a worker: the session gives its status, without stopping or redirecting it.
/** @param {Engine} $ @param {Crew} one */
function askWorker($, one) {
  return press($, async () => { handOff($, [], `Give me a five-line status of the background worker "${one.title}" (agent ${one.id}): what it has done, what it is doing now, what is left, and any blocker. Do not stop or redirect it.`); return `asked the session about ${one.title}` }, false)
}

// How Needs you answers in place (rows.mjs Answering): this session's state, and each press as a closure.
/** @param {Engine} $ @param {Home} model @param {boolean} hasInput @returns {import('./rows.mjs').Answering} */
function answering($, model, hasInput) {
  /** @param {Partial<import('./decide.mjs').AnswerState>} change */
  const change = change => {
    answerState = { ...answerState, ...change }
    $.ui.invalidate('ui.render')
  }
  return {
    view: needsView(model.items, model.open, answerState, callsOpen, Date.now(), hasInput),
    onOpen: id => () => change({ opened: id, typing: '' }),
    onAnswer: (one, option) => press($, () => answerItem($, one, option.letter, option.prompt), true),
    onExplain: (_one, answers) => press($, async () => (handOff($, [], answers.explain), 'asked the session to explain it; nothing is decided.'), true),
    onType: (one, answers) => press($, () => typeAnswer($, one, answers, hasInput), true),
    onTyped: (one, answers) => words => press($, () => answerTyped($, one, answers, words), true)(),
    // Leaving the row's view closes its typed answer: Back does not land in the field again.
    onFindings: one => () => ((findingShown = one.id), (paneMode = 'finding'), change({ typing: '' })),
    onFold: () => change({ isFoldOpen: !answerState.isFoldOpen }),
  }
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
  // The mobile app draws no text field: there a typed answer or a search is the question dialog's Other.
  const hasInput = typeof el.Input === 'function'

  if (paneMode === 'finding') {
    const item = model.items.find(one => one.id === findingShown)
    if (item) return Box({ flexDirection: 'column', children: [...findingRows(el, { item, width, isClicked, onBack: show($, 'home') }), ...foot] })
    paneMode = 'home'
  }

  if (paneMode === 'pick') {
    const shown = filterWork(model.work, pickQuery)
    rows.push(masthead(el, [Text({ key: 'title', bold: true, children: 'Everything open' }), headerLine(el, $, pickQuery ? `${shown.length} of ${model.work.length}` : `${model.work.length} open · yours first`, width)].filter(Boolean), surface))
    // Search opens a field (without one, a question whose Other is the words). Sort cycles Recent, Ready to close, Oldest; Group cycles Person, Area, Stage, None.
    const field = isSearchOpen && hasInput
    const search = field
      ? el.Input({ key: 'pick-search-field', label: 'Search: ', placeholder: 'title, issue number, area or owner', value: pickQuery, submitLabel: 'search', autoFocus: true, onSubmit: (/** @type {string} */ words) => ((isSearchOpen = false), void setSearch($, words)) })
      : Button({ key: 'pick-search', label: pickQuery ? `Search: ${fit(pickQuery, 24)}` : 'Search…', hotkey: hotkeyFor('s'), plain: true, onPress: hasInput ? () => ((isSearchOpen = true), $.ui.invalidate('ui.render')) : press($, () => searchQuestion($), true) })
    const clear = pickQuery ? [Button({ key: 'pick-search-clear', label: '✕ Clear', plain: true, dimColor: true, onPress: () => setSearch($, '') })] : []
    const sort = Button({ key: 'pick-sort', label: `Sort: ${SORT_LABELS[pickSort]}`, hotkey: hotkeyFor('o'), plain: true, onPress: () => cycleSort($) })
    const group = Button({ key: 'pick-group', label: `Group: ${GROUP_LABELS[pickGroup]}`, hotkey: hotkeyFor('g'), plain: true, onPress: () => cycleGroup($) })
    rows.push(Box({ key: 'pick-search-row', flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 1, children: [search, ...clear, sort, group] }))
    rows.push(...workGroups(el, lookOf($, width, 'pick'), { work: model.work, shown, query: pickQuery, sort: pickSort, groupBy: pickGroup, areas: pack.areas, folded: pickFolded, me, isFocusTaken: field, onFold: key => () => toggleIn($, pickFolded, key), issuesFoot: [refreshIssuesButton(el, $)] }))
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
    const one = model.work.find(work => work.kind === 'issue' && work.id === issueShown)
    if (one?.kind === 'issue') {
      const { issue } = one
      rows.push(masthead(el, [label(el, 'brand', `Issue #${issue.number}`, width), Text({ key: 'title', bold: true, wrap: 'wrap', children: issue.name }), Text({ key: 'meta', color: QUIET, wrap: 'wrap', children: one.hint })], surface))
      const link = issueLink(issue.url)
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
    const { key, slug, isHere } = intentView
    const intent = intents.find(one => one.key === key) ?? (intentView.intent?.key === key ? intentView.intent : undefined)
    if (intent) {
      // Seeing the tracked intent's view settles the band's notice; another intent's view does not.
      if (isHere) intentSeenAt = Date.now()
      rows.push(
        masthead(
          el,
          [
            label(el, 'brand', 'Intent', width),
            Text({ key: 'title', bold: true, children: fit(key, width) }),
            ...(intent.goal ? [Text({ key: 'goal', wrap: 'wrap', children: intent.goal })] : []),
            ...(intentView.proof ? [Text({ key: 'proof', color: QUIET, wrap: 'wrap', children: `Proof: ${intentView.proof}` })] : []),
            ...(intentView.heldBy ? [Text({ key: 'held-by', color: AMBER, wrap: 'wrap', children: intentView.heldBy })] : []),
          ],
          surface,
        ),
      )
      // Looking never tracks: working on it here is its own press, and needs its folder in this
      // checkout. Asking about it never needs one: the session reads it from origin/main if it must.
      const askButton = Button({ key: 'intent-ask', label: 'Ask about it', variant: intentView.inCheckout ? undefined : 'primary', hotkey: hotkeyFor('a'), onPress: press($, async () => { handOff($, [], aboutIntentPrompt(slug, intent.source === 'main', otherRoot(intent))); return `asked the session about ${key}` }, false) })
      const work = intentView.inCheckout ? [Button({ key: 'intent-work', label: 'Work on this here', variant: 'primary', hotkey: hotkeyFor('w'), onPress: press($, () => trackKey($, key), true) })] : []
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
                    Box({ key: `change-${index}-words`, flexGrow: 1, children: [Button({ key: `change-${index}-press`, label: fit(one.text, width - 10), plain: true, onPress: press($, async () => { handOff($, [], `In intent ${key}, explain in at most four lines what "${one.text}" (${one.time}) changed: what it means, the proof if there is any, and why. Quote what I said if it came from me.`); return 'asked the session about that change' }, false) })] }),
                    Text({ color: QUIET, children: one.time }),
                  ],
                }),
              )),
        ]),
      )
      if (isHere && model.next) rows.push(section(el, 'intent-next', [label(el, 'intent-next-label', 'Next', width, LIME), Box({ key: 'intent-next-card', width: '100%', borderStyle: 'round', borderColor: LIME, paddingX: 1, children: [Text({ children: fit(model.next.label, width - 4) })] })]))
      const back = Button({ key: 'intent-back', label: 'Back', hotkey: hotkeyFor('0'), plain: true, dimColor: true, onPress: show($, intentBack) })
      // Stop tracking keeps the view on this intent, which then offers Work on this here again.
      const stop = Button({ key: 'intent-untrack', label: 'Stop tracking', hotkey: hotkeyFor('s'), plain: true, dimColor: true, onPress: press($, () => ((intentShown = key), untrackHere($)), true) })
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
  rows.push(summaryStrip(el, model, crew, isClicked))
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
        ...needsRows(el, isClicked, { items: model.items, open: model.open, opened: callsOpen, width, key: digit, onAct: one => press($, () => act($, one), false), onToggle: slug => () => toggleIn($, callsOpen, slug), answer: answering($, model, hasInput) }),
      ]),
    )
  }

  if (model.attention.length > 0) {
    // The person's own intents that want a press; each opens its intent, nothing is done for them.
    rows.push(section(el, 'attention', [label(el, 'attention-label', `Needs attention · ${model.attention.length}`, width, LIME), ...model.attention.map(one => choice(el, { key: one.id, title: `${one.title} · ${one.ask}`, mark: one.kind === 'close' ? '✓' : '‖', hotkey: digit(), width, onPress: viewIntent($, one.key, 'home') }))]))
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

  rows.push(...crewSections(el, { crew, width, isClicked, onWorker: one => askWorker($, one) }))

  rows.push(...homePreview(el, lookOf($, width, 'home'), { own: model.own, team: model.teamPreview, isNewcomer: model.isNewcomer, me, onAll: show($, 'pick') }))

  if (model.offerAway) {
    const presets = AWAY_PRESETS.map(preset => Button({ key: `away-${preset.hotkey}`, label: preset.label, hotkey: hotkeyFor(preset.hotkey === 'u' ? 'u' : undefined), plain: isClicked ? undefined : true, onPress: press($, () => startAway($, { ...preset.choice, goal: '' }), false) }))
    rows.push(section(el, 'away', [label(el, 'away-label', 'Heading off?', width), Text({ key: 'away-pitch', children: 'Let AI work while you zZz' }), Box({ key: 'away-presets', flexDirection: 'row', gap: 3, children: presets })]))
  }

  rows.push(...foot)
  return Box({ flexDirection: 'column', children: rows })
}
