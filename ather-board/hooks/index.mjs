// @ts-check
// Ather Board: the engine half. /board opens the pane (pane.mjs), /board open writes the page
// (page.mjs) and opens it in the browser, /board publish writes it and asks the session to publish
// it through the team's Sites MCP. Read-only: it reads intents with Ather's reader (snapshot.mjs)
// and fetches origin's base branch the way Ather does (team.mjs: no tags, never the index lock).
// The pane opens on For you (D8) with the brief (assist.mjs) above it; every action is a prompt handed
// to the session, which asks before it changes anything (D6).
// Everything here catches its own failures: the board never fails a command or a drawing.

import { ACTION_LABELS, batchPrompt, decisionPrompt } from './act.mjs'
import { ask, askState, briefState, clearAsk, mapState, runBrief, runMapping } from './assist.mjs'
import { modulesFor } from './modules.mjs'
import { answerLook } from './brief.mjs'
import { mergeSuggestions, plainSuggestions } from './focus.mjs'
import { choosePack } from './ather/packs/index.mjs'
import { GIT_ENV, NO_SYNC, baseOf, canFetchNow, fetchMain, isFetchDue, syncError, syncText } from './ather/team.mjs'
import { boardPane } from './pane.mjs'
import { renderPage } from './page.mjs'
import { EMPTY_BOARD_CACHE, readBoard } from './snapshot.mjs'
import { DEFAULT_LOOK, GROUP_KEYS, NO_FILTER, SORT_KEYS, pickLook } from './views.mjs'

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {import('./snapshot.mjs').Board} Board
 * @typedef {import('./snapshot.mjs').BoardCache} BoardCache
 * @typedef {import('./views.mjs').Look} Look
 * @typedef {import('./ather/team.mjs').Repo} Repo
 * @typedef {import('./ather/team.mjs').Sync} Sync
 * @typedef {import('./ather/packs/index.mjs').Pack} Pack
 * @typedef {{ root: string, isRepo: boolean, pack: Pack, base: string, repoName: string, repoUrl: string, me: string, settings: Record<string, any> | null }} Lane
 *   the checkout the board reads; `me`: its git user.name; `settings`: its .ather/board.json (the modules), null for none
 */

const PANE_ID = 'board'
// The board is read again when drawn at most this often, and at once after a fetch moved origin.
const READ_EVERY_MS = 60 * 1000
// A prompt goes out after the command hook returns: the engine refuses one queued from inside a hook.
const AFTER_HOOK_MS = 50
// How long writing the page waits for the brief and the module map.
const MODEL_WAIT_MS = 60 * 1000
// The MCP server the page is published through, as /mcp lists it (README: adding it).
const SITES_SERVER = 'vesper-sites'

/** @type {Look} */
let look = { ...DEFAULT_LOOK, view: 'foryou' }
// The intent opened in place in the pane ('' none).
let opened = ''
/** @type {Promise<Lane> | null} */
let lane = null
/** @type {Board | null} */
let board = null
/** @type {BoardCache} */
let cache = EMPTY_BOARD_CACHE
/** @type {Promise<void> | null} */
let reading = null
// A forced read asked for while one runs: one more read follows it, so it sees what the fetch brought.
let isAgain = false
/** @type {Sync} */
let sync = NO_SYNC
// A line under the tabs: what the last press did (the page written, a publish handed over).
let note = ''

/** @param {Engine} $ @param {string} root @returns {Repo} */
const repoOf = ($, root) => ({
  git: (args, { stdin, timeoutMs = 60000 } = {}) =>
    $.process.run(['git', '-C', root, ...args], { cwd: root, env: GIT_ENV, timeoutMs, ...(stdin === undefined ? {} : { stdin }) }).catch(error => ({ exitCode: -1, stdout: '', stderr: String(error), isAborted: /aborted$/.test(String(error)) })),
  read: path => $.fs.read(path).then(text => (typeof text === 'string' ? text : null), () => null),
  list: path => $.fs.list(path),
  mtime: path => $.fs.stat(path).then(stat => stat.mtimeMs, () => 0),
  real: async folder => (await $.fs.stat(folder, { resolve: true })).realPath ?? folder,
})

// "git@github.com:sipherxyz/s2.git" or "https://github.com/sipherxyz/s2.git" → its web address; '' for another host.
/** @param {string} remote */
export const webOf = remote => {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return match ? `https://github.com/${match[1]}/${match[2]}` : ''
}

// The checkout the session runs in, its pack and the branch its team merges into. Once per module load;
// a lookup that failed is tried again next time.
/** @param {Engine} $ @returns {Promise<Lane>} */
const laneOf = $ =>
  (lane ??= (async () => {
    const start = (await $.session.root()).replace(/\\/g, '/')
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: start, env: GIT_ENV, timeoutMs: 10000 }).catch(() => undefined)
    const isRepo = top?.exitCode === 0
    const root = isRepo ? (top?.stdout ?? '').trim().replace(/\\/g, '/') : start
    const io = { read: (/** @type {string} */ path) => $.fs.read(path).then(text => (typeof text === 'string' ? text : null), () => null), exists: (/** @type {string} */ path) => $.fs.exists(path).catch(() => false), list: (/** @type {string} */ path) => $.fs.list(path), sessionId: () => $.session.id() }
    const chosen = await choosePack(io, root)
    const remote = isRepo ? await $.process.run(['git', 'config', '--get', 'remote.origin.url'], { cwd: root, env: GIT_ENV, timeoutMs: 10000 }).catch(() => undefined) : undefined
    const repoUrl = webOf(remote?.stdout ?? '')
    const user = await $.process.run(['git', 'config', 'user.name'], { cwd: root, env: GIT_ENV, timeoutMs: 10000 }).catch(() => undefined)
    const settings = await io.read(`${root}/.ather/board.json`).then(text => { try { return text ? JSON.parse(text) : null } catch { return null } })
    return { root, isRepo, pack: chosen.pack, base: baseOf(chosen.profile, chosen.defaultBranch), repoName: repoUrl.split('/').pop() || root.split('/').pop() || '', repoUrl, me: (user?.stdout ?? '').trim(), settings }
  })().catch(error => {
    lane = null
    throw error
  }))

/** @param {Engine} $ */
const hasIntents = async $ => (await $.fs.exists(`${(await laneOf($)).root}/docs/intent`).catch(() => false))

// Reads the board again, one read at a time; `force` skips the minute's wait, and while a read runs
// asks for one more after it.
/** @param {Engine} $ @param {boolean} [force] */
const refresh = ($, force = false) => {
  if (reading) {
    isAgain ||= force
    return reading
  }
  if (!force && board && Date.now() - board.readAt < READ_EVERY_MS) return Promise.resolve()
  reading = (async () => {
    try {
      const at = await laneOf($)
      do {
        isAgain = false
        const read = await readBoard(repoOf($, at.root), at.root, { pack: at.pack, base: at.base, cache, now: Date.now() })
        board = read.board
        cache = read.cache
        sync = { ...sync, isRepo: read.board.isRepo, hasMain: read.board.sha !== '', base: at.base }
      } while (isAgain)
    } catch (error) {
      $.ui.log(`Ather Board: reading the intents failed: ${String(error)}`, { to: 'debug' })
    } finally {
      reading = null
      $.ui.invalidate('ui.render')
    }
  })()
  return reading
}

// Fetches origin's base in the background when due (or at once for ↻), then reads the board again.
/** @param {Engine} $ @param {boolean} [now] */
const syncMain = async ($, now = false) => {
  const at = await laneOf($)
  if (!(now ? canFetchNow(sync, Date.now()) : isFetchDue(sync, Date.now()))) return
  sync = { ...sync, isFetching: true, triedAt: Date.now() }
  $.ui.invalidate('ui.render')
  const fetched = await fetchMain(repoOf($, at.root), at.base).catch(error => ({ error: String(error), lock: '', moved: false }))
  const time = Date.now()
  sync = fetched.error ? { ...sync, isFetching: false, failedAt: time, error: fetched.error, lock: fetched.lock } : { ...sync, isFetching: false, fetchedAt: time, error: '', lock: '' }
  if (fetched.moved) await refresh($, true)
  else $.ui.invalidate('ui.render')
}

// The page, written where the pack keeps local files (S2: Saved/AtherAutomata/board/index.html).
/** @param {Engine} $ @returns {Promise<string>} */
const writePage = async $ => {
  const at = await laneOf($)
  await refresh($, true)
  if (!board) throw new Error('the intents could not be read')
  // The page carries the brief and the map: both are waited for, up to a limit (each runs once per read,
  // so usually done); past it the page has what is in, and the next write has the rest.
  const io = assistIo($, at.repoName)
  const set = modulesFor(at.pack.id, at.settings, board.records)
  await Promise.race([Promise.all([runBrief(io, board, at.me), runMapping(io, board, set)]), new Promise(resolve => $.clock.after(MODEL_WAIT_MS, () => resolve(undefined)))])
  const [css, client] = await Promise.all([$.fs.read(`${$.plugin.root}/page/board.css`), $.fs.read(`${$.plugin.root}/page/client.js`)])
  const path = `${at.root}/${at.pack.localDir}/board/index.html`
  await $.fs.write(path, renderPage(board, { now: Date.now(), repoName: at.repoName, repoUrl: at.repoUrl, css: String(css), client: String(client), brief: briefState().value, briefAt: briefState().at, modules: set.modules, mapping: mapState().value.mapping }))
  return path
}

// Opens a file with the system's own handler: `start` on Windows (a drive-letter path), else `open`, then `xdg-open`.
/** @param {Engine} $ @param {string} path */
const openFile = async ($, path) => {
  const tries = /^[A-Za-z]:/.test(path) ? [['cmd', '/c', 'start', '', path.replace(/\//g, '\\')]] : [['open', path], ['xdg-open', path]]
  for (const argv of tries) {
    const ran = await $.process.run(argv, { timeoutMs: 15000 }).catch(() => undefined)
    if (ran?.exitCode === 0) return true
  }
  return false
}

// What the session is asked to do with the written page.
/** @param {string} path @param {string} repoName */
export const publishPrompt = (path, repoName) =>
  `Publish the Ather Board page at ${path} to the team's shared site through the ${SITES_SERVER} MCP server. It is one self-contained HTML file: publish it as it is, without editing it. If a site for "${repoName || 'the'} intents" was published before, update that one in place rather than creating another. If the ${SITES_SERVER} server is not connected, stop and tell me to add it (ather-board's README says how). Reply with the page's address. Change nothing in the repository.`

/** @param {Engine} $ @param {string} text */
const deliver = ($, text) => $.clock.after(AFTER_HOOK_MS, () => void $.prompt.submit({ text }).catch(error => $.ui.toast(`Ather Board: could not hand that to the session: ${String(error)}`)))

/** @param {Engine} $ */
const openPage = async $ => {
  try {
    const path = await writePage($)
    note = (await openFile($, path)) ? `Page written and opened: ${path}` : `Page written: ${path} (open it in a browser)`
  } catch (error) {
    note = `The page could not be written: ${String(error)}`
  }
  $.ui.invalidate('ui.render')
  return note
}

/** @param {Engine} $ */
const publish = async $ => {
  try {
    const path = await writePage($)
    deliver($, publishPrompt(path, (await laneOf($)).repoName))
    note = `Page written: ${path}. The session publishes it through ${SITES_SERVER}.`
  } catch (error) {
    note = `The page could not be written: ${String(error)}`
  }
  $.ui.invalidate('ui.render')
  return note
}

/** @param {Engine} $ */
const openPane = async $ => {
  await $.ui.open({ id: PANE_ID, title: 'ATHER BOARD', focus: true, closeOnEscape: true, rows: 24 })
  $.ui.invalidate('ui.render')
}

/** @template {string} T @param {readonly T[]} keys @param {T} current */
const nextOf = (keys, current) => keys[(keys.indexOf(current) + 1) % keys.length] ?? current

// The model, the redraw and the kept module answers, as the brief, the ask box and the mapping take them
// (assist.mjs). The answers are kept per repository in the mod's store.
/** @param {Engine} $ @param {string} repoName @returns {import('./assist.mjs').Io} */
const assistIo = ($, repoName) => ({
  load: async () => /** @type {import('./modules.mjs').Kept | null} */ ((await $.store.get(`modules:${repoName}`).catch(() => undefined)) ?? null),
  save: kept => $.store.set(`modules:${repoName}`, kept).catch(() => undefined),
  complete: async (request, signal) => {
    const reply = await $.model.complete(request, { signal })
    if (reply.isAnswered) return { text: reply.text, error: '' }
    return { text: '', error: reply.reason === 'api-error' ? `the model call failed (${reply.error}${reply.status ? `, ${reply.status}` : ''})` : `the model gave no answer (${reply.reason})` }
  },
  redraw: () => $.ui.invalidate('ui.render'),
})

// A question to the model, its answer cutting the board (the ask box, /board ask).
/** @param {Engine} $ @param {string} question */
const askBoard = async ($, question) => {
  const at = await laneOf($)
  if (board) await ask(assistIo($, at.repoName), question, board, at.me, answer => setLook($, answerLook(answer, look.view)))
}

// Hands the session one prompt and says so under the tabs.
/** @param {Engine} $ @param {string} prompt @param {string} what */
const handOver = ($, prompt, what) => {
  deliver($, prompt)
  note = `Handed to the session: ${what}. It asks before changing anything.`
  $.ui.invalidate('ui.render')
}

/** @param {Engine} $ @param {Partial<Look>} patch */
const setLook = ($, patch) => {
  look = { ...look, ...patch }
  $.ui.invalidate('ui.render')
}

/** @param {Engine} $ @param {any} e */
const drawPane = async ($, e) => {
  const el = $.ui.resolve(e)
  if (!(await hasIntents($))) return el.Text({ wrap: 'wrap', children: NOT_HERE })
  void syncMain($)
  if (!board) await refresh($)
  else void refresh($)
  const at = await laneOf($)
  const now = Date.now()
  const records = board?.records ?? []
  // The brief once per read of origin (D7); its suggestions merged with the board's own.
  const io = assistIo($, at.repoName)
  const set = modulesFor(at.pack.id, at.settings, records)
  if (board) {
    void runBrief(io, board, at.me)
    void runMapping(io, board, set)
  }
  const brief = briefState()
  const suggestions = mergeSuggestions(brief.value?.suggestions ?? [], plainSuggestions(records, at.me, now))
  const named = (/** @type {readonly string[]} */ keys) => records.filter(one => keys.includes(one.key))
  return boardPane(
    el,
    { records, look, width: e.props?.bodyColumns ?? 80, isDesktop: e.surface !== 'terminal', now, title: `${at.repoName || 'Team'} intents`, fresh: syncText(sync, now), error: syncError(sync), note, me: at.me, opened, suggestions, brief, asked: askState(), modules: set.modules, mapped: mapState() },
    {
      onView: view => () => setLook($, { view }),
      onFilter: patch => setLook($, { filter: { ...look.filter, ...patch } }),
      onPick: (by, value) => setLook($, pickLook(look, by, value)),
      onSort: () => setLook($, { sort: nextOf(SORT_KEYS, look.sort) }),
      onGroup: () => setLook($, { group: nextOf(GROUP_KEYS, look.group) }),
      onBy: () => setLook($, { by: look.by === 'area' ? 'owner' : 'area' }),
      onRow: record => () => {
        opened = opened === record.key ? '' : record.key
        $.ui.invalidate('ui.render')
      },
      onAction: (kind, list) => handOver($, batchPrompt(kind, list, at.base), `${ACTION_LABELS[kind].toLowerCase()}, ${list.map(one => one.slug).join(', ')}`),
      onDecide: (record, call, letter) => handOver($, decisionPrompt(record, call, letter), letter ? `${call.id} on ${record.slug}: ${letter}` : `explain ${call.id} on ${record.slug}`),
      onSuggestion: one => (one.action === 'show' ? setLook($, { view: 'table', filter: { ...NO_FILTER, keys: one.keys } }) : handOver($, batchPrompt(one.action, named(one.keys), at.base), one.title)),
      onBriefAgain: () => { if (board) void runBrief(io, board, at.me, true) },
      onMapAgain: () => { if (board) void runMapping(io, board, set, true) },
      onAsk: question => void askBoard($, question),
      onClearAsk: () => {
        clearAsk()
        setLook($, { filter: NO_FILTER })
      },
      onOpenPage: () => void openPage($),
      onPublish: () => void publish($),
      onSync: () => void syncMain($, true),
    },
  )
}

const NOT_HERE = 'Ather Board reads a repository’s intents (its docs/intent folder), and this one has none. Open the session in a checkout that has them.'
const HELP = '/board opens the board, on what is yours to act on. /board ask <question> asks Sonnet and cuts the board to the answer. /board open writes the full page and opens it in your browser. /board publish writes it and has the session publish it to the team’s shared site.'

/** @param {import('claude-code').On} on */
export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'board', description: 'The team’s intents as a board: triage, table, open items, people and areas', argumentHint: '[open | publish | ask <question>]' }).catch(error => $.ui.log(`Ather Board: /board not registered: ${String(error)}`, { to: 'debug' }))
    return next(e)
  })

  on('command.run', { command: 'board' }, async ($, e) => {
    try {
      if (!(await hasIntents($))) return { text: NOT_HERE }
      const word = e.args.trim().toLowerCase()
      if (word === 'open') return { text: await openPage($) }
      if (word === 'publish') return { text: await publish($) }
      if (word.startsWith('ask ')) {
        await openPane($)
        await refresh($)
        void askBoard($, e.args.trim().slice(4))
        return { text: 'Asked Sonnet; the answer shows on the board.' }
      }
      if (word !== '') return { text: HELP }
      await openPane($)
      return { text: 'Board opened.' }
    } catch (error) {
      return { text: `Ather Board: ${String(error)}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    try {
      return await drawPane($, e)
    } catch (error) {
      $.ui.log(`Ather Board: the pane failed to draw: ${String(error)}`, { to: 'debug' })
      return $.ui.resolve(e).Text({ children: 'Ather Board could not draw. /board tries again.' })
    }
  })
}
