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
import { TOUR_PROMPT, askPrompt, batchPrompt, buildHome } from './home.mjs'
import { issuePrompt, parseIssues } from './issues.mjs'
import { AREAS, ROLES, ROLE_LABELS, clockText, closestWord, localMinutes, parseEditorLock, parseIntent, parseRole, searchIntents } from './model.mjs'
import * as state from './state.mjs'

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
let paneMode = /** @type {'home' | 'pick'} */ ('home')
let isIssuesWarned = false
/** @type {{ version: number, at: number, model: Home | null }} */
let view = { version: -1, at: 0, model: null }

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
    gitUser: async () => ((await $.process.run(['git', 'config', 'user.name'], { cwd, timeoutMs: 10000 })).stdout ?? '').trim(),
    redraw: () => $.ui.invalidate('ui.render'),
  }
}

/** @param {Engine} $ */
function laneOf($) {
  return state.lane(io($), cwd)
}

const NOT_S2 = 'Ather Automata works in S2 checkouts (a docs/intent folder); none here.'

/** @param {import('claude-code').On} on */
export function register(on) {
  // Only sessions with a person at them get the console (watch.mjs starts in every session).
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    const result = await next(e)
    sent.clear()
    paneMode = 'home'
    isIssuesWarned = false
    view = { version: -1, at: 0, model: null }
    cwd = e.cwd
    try {
      await $.command.register({ name: 'ather', description: 'Ather Automata: what needs you, and what is next', argumentHint: '[pick | issues | issue <number> | tour | skip | role <role> | checked | intent <name>]' })
      await $.command.register({ name: 'away', description: 'Ather Automata: going away? hand over with full autonomy, decisions recorded', argumentHint: '[tonight | 8h | 30m | until 9am | until done] [goal] | stop' })
      const lane = await laneOf($)
      me = lane.me
      if (!lane.isS2) return result
      await refresh($)
      $.clock.every(60000, () => void refresh($).catch(() => undefined))
      // watch.mjs may pick up last night's window just after this; show it.
      $.clock.after(1500, () => void refresh($).catch(() => undefined))
      void refreshIssues($).catch(() => undefined)
      $.clock.every(ISSUES_EVERY_MS, () => void refreshIssues($).catch(() => undefined))
      if ((await home($)).isNewcomer && !(await state.readProfile(io($), me)).isNudged) {
        $.ui.toast('Ather: new here? Type /ather tour for a six-step tour of how S2 works with Claude Code.', { timeoutMs: 12000 })
        await state.setProfile(io($), me, { isNudged: true })
      }
    } catch (error) {
      $.ui.log(`Ather console: start failed: ${String(error)}`, { to: 'debug' })
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId && (await laneOf($)).isS2) await refresh($).catch(() => undefined)
    return result
  })

  on('command.run', { command: 'ather' }, async ($, e) => {
    if (!(await laneOf($)).isS2) return { text: NOT_S2 }
    await refresh($).catch(() => undefined)
    return { text: await atherCommand($, e.args.trim()) }
  })

  on('command.run', { command: 'away' }, async ($, e) => ({ text: (await laneOf($)).isS2 ? await awayCommand($, e.args.trim()) : NOT_S2 }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await laneOf($)).isS2) return next(e)
    const hint = bandHint(await home($))
    // The band is shared with other mods: draw only when there is something to say.
    if (hint === '') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return Box({ flexDirection: 'row', gap: 2, children: [Text({ color: 'cyan', children: hint }), Button({ key: 'ather-open', label: 'Open', plain: true, dimColor: true, onPress: () => void openPane($, 'home') })] })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => (e.requestId === PANE_ID ? paneView($.ui.resolve(e), $, await home($), e.props.bodyColumns ?? 80) : next(e)))

  on('ui.close', ($, e, next) => {
    if (e.id === PANE_ID) paneMode = 'home'
    return next(e)
  })
}

// ---------------------------------------------------------------- the view model

// Re-reads the intents; the rest comes from shared state when the view is rebuilt.
/** @param {Engine} $ */
async function refresh($) {
  const { root } = await laneOf($)
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
        progress: isPinned ? ((await files.read(`${dir}/progress.md`)) ?? '') : '',
        files: isPinned ? (await $.fs.list(dir).catch(() => [])).map(one => one.name) : [],
        hasDebrief: isPinned && (await files.exists(`${root}/Saved/AtherAutomata/debriefs/${entry.name}.md`)),
        mtimeMs: Math.max(...stats),
      }),
    )
  }
  intents = read.sort((a, b) => b.mtimeMs - a.mtimeMs)
  stale()
  const hint = bandHint(await home($))
  $.ui.status(hint === '' ? undefined : hint)
  $.ui.invalidate('ui.render')
}

function stale() {
  view = { ...view, version: -1 }
}

// The GitHub issues assigned to the person, read with gh. Without gh, or signed out, there are
// simply none: one line in the debug log, never an error on screen. Never writes to GitHub.
/** @param {Engine} $ */
async function refreshIssues($) {
  const { root } = await laneOf($)
  const run = await $.process.run(['gh', 'issue', 'list', '--assignee', '@me', '--state', 'open', '--limit', '30', '--json', 'number,title,url,labels,updatedAt'], { cwd: root, timeoutMs: 30000 }).catch(() => undefined)
  if (!run || run.exitCode !== 0) {
    // Signed out: the last list may be stale, so none is shown.
    if (/auth login|not logged in|authentication/i.test(run?.stderr ?? '')) await state.setIssues(io($), me, [])
    if (!isIssuesWarned) $.ui.log(`Ather: could not read your GitHub issues (is gh installed and signed in?) ${run?.stderr?.slice(0, 200) ?? ''}`, { to: 'debug' })
    isIssuesWarned = true
    return
  }
  await state.setIssues(io($), me, parseIssues(run.stdout))
}

/** @param {Engine} $ @returns {Promise<Home>} */
async function home($) {
  const version = state.stateVersion()
  if (view.model && view.version === version && Date.now() - view.at < VIEW_TTL_MS) return view.model
  const files = io($)
  const { root } = await laneOf($)
  const tz = await state.readTz(files)
  const now = Date.now()
  const away = await state.readAway(files)
  const profile = await state.readProfile(files, me)
  const model = buildHome({
    intents,
    pinned: await state.readPinned(files),
    me,
    ...profile,
    evidence: await state.readEvidence(files, await state.evidenceScope(files)),
    away,
    ledger: away.phase === 'off' ? '' : ((await files.read(away.ledgerPath)) ?? ''),
    lost: await state.readLost(files),
    lock: parseEditorLock(await files.read(`${root}/Saved/EDITOR_OWNER.txt`), localMinutes(now, tz)),
    recurring: await state.readRecurring(files),
    issues: await state.readIssues(files, me),
    last: await state.readLast(files, me),
    sent: [...sent],
    workers: (await $.agent.list().catch(() => [])).filter(agent => agent.status === 'running' && agent.parentId === undefined).length,
    now,
    tz,
  })
  view = { version, at: now, model }
  $.ui.status(bandHint(model) || undefined)
  return model
}

/** @param {Home} model */
function bandHint(model) {
  const { header } = model
  if (header.stage === 'Away') return `🌙 Away ${header.progress} · ${header.sentence} · /ather`
  if (model.open.some(one => one.kind === 'review')) return '☀ Welcome back · review the away window · /ather'
  if (model.isNewcomer) return '◆ New here? /ather tour'
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
  handOff($, ['next:tour'], TOUR_PROMPT, () => state.setProfile(io($), me, { tourDone: true }))
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
  const issue = { number, title: '', url: '', labels: [], updatedAt: 0, area: 'Unsorted', isUrgent: false }
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
  const away = await state.startAway(io($), choice, { root: (await laneOf($)).root, me, tz, now: Date.now() })
  if (away === null) return 'An away window is already running or waiting for your review: /ather shows it.'
  const { root } = await laneOf($)
  const ledger = away.ledgerPath.startsWith(root) ? away.ledgerPath.slice(root.length + 1) : away.ledgerPath
  handOff($, ['away-start'], `I am away ${windowEndText(away, tz)}. Goal: ${choice.goal || 'continue the active work'}. Work through it without waiting for me and record every decision you take for me in ${ledger}.`)
  return `Away ${windowEndText(away, tz)}${choice.goal ? ` (goal: ${choice.goal})` : ''}. The session may push branches and open PRs; nothing merges until you are back.`
}

// Text typed instead of picking: an intent, a question for the session, or nothing.
/** @param {Engine} $ @param {string} text @param {boolean} [isInQuestion] typed under Other, so no further question */
async function typed($, text, isInQuestion = true) {
  if (/^tours?$/i.test(text.trim())) return startTour($)
  const number = /^#(\d+)$|^(\d{3,7})$/.exec(text.trim())
  if (number) return startIssue($, Number(number[1] ?? number[2]), isInQuestion)
  if (searchIntents(intents, text).length > 0) return track($, text)
  const question = /^(help|\?)$/i.test(text.trim()) ? 'What can Ather do for me?' : text
  void deliver($, askPrompt(question)).catch(error => $.ui.toast(`Ather: could not send to the session: ${String(error)}`))
  return 'Sent your question to the session.'
}

// ---------------------------------------------------------------- commands

/** @param {Engine} $ */
async function isTerminal($) {
  return (/** @type {readonly string[]} */ (await $.session.surfaces().catch(() => []))).includes('terminal')
}

/** @param {Engine} $ */
async function skipTour($) {
  await state.setProfile(io($), me, { tourDone: true })
  return ask($, {
    header: 'Your role',
    question: 'Tour skipped (/ather tour brings it back). What kind of work do you do? It decides what proof Ather asks for.',
    choices: ROLES.map(role => ({ label: ROLE_LABELS[role], description: role === 'engineer' ? 'Builds and automation tests.' : role === 'techart' ? 'A PIE proof and your own Editor check.' : 'A PIE proof.', run: () => atherCommand($, `role ${role}`) })),
    fallback: 'Tour skipped. Say your role any time with /ather role designer, tech artist or engineer.',
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
    const role = parseRole(rest)
    if (!role) return 'Which role? /ather role designer, /ather role tech artist or /ather role engineer.'
    await state.setProfile(io($), me, { role })
    return `Your role is ${ROLE_LABELS[role]}. It shapes the next step and what Prove asks for.`
  }
  if (word === 'checked') {
    await state.setRung(io($), await state.evidenceScope(io($)), 'editor', { state: 'pass', detail: 'checked by you in the Editor' })
    return 'Recorded: you checked it in the Editor.'
  }
  if (word === 'pick' || word === 'issues') return (await isTerminal($)) ? openPane($, 'pick') : workQuestion($)
  // "/ather tuor": a typo of a command word is pointed out, never run ("ship" is one letter from "skip").
  const meant = rest === '' ? closestWord(word, COMMAND_WORDS) : null
  if (meant && searchIntents(intents, word).length === 0) return `Did you mean /ather ${meant}?`
  if (word !== '') return typed($, args, false)
  return (await isTerminal($)) ? openPane($, 'home') : menuQuestion($)
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
    if (mine) choices.push({ label: cut(mine.kind === 'issue' ? `Start #${mine.issue.number} ${mine.issue.title}` : `Pick up ${mine.slug}`, 40), description: mine.hint, run: () => startWork($, mine) })
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
          ? `${me ? `Hi ${me.split(/\s+/)[0]}, new` : 'New'} to Ather? The tour shows how S2 works with Claude Code in six short steps and ends with your first intent started.`
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

/** @param {Engine} $ @param {'home' | 'pick'} mode */
async function openPane($, mode) {
  paneMode = mode
  await $.ui.open({ id: PANE_ID, title: 'Ather', focus: true, closeOnEscape: true, rows: 22 })
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

/** @param {Engine} $ @param {'home' | 'pick'} mode */
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

/** @param {any} el @param {Engine} $ @param {Home} model @param {number} columns */
function paneView(el, $, model, columns) {
  const { Box, Text, Button } = el
  const width = Math.max(30, columns - 4)
  const rows = []
  if (paneMode === 'pick') {
    rows.push(Text({ key: 'pick-title', bold: true, children: 'Everything open (yours first)' }))
    /** @type {Map<string, Work[]>} */
    const groups = new Map()
    for (const one of model.work) {
      const group = one.kind === 'issue' ? 'Your GitHub issues' : one.area
      groups.set(group, [...(groups.get(group) ?? []), one])
    }
    let index = 0
    for (const group of ['Your GitHub issues', ...AREAS, 'Unsorted'].filter(name => groups.has(name))) {
      rows.push(Text({ key: `group-${group}`, dimColor: true, children: group }))
      for (const one of groups.get(group) ?? []) {
        index += 1
        rows.push(Button({ key: `pick-${one.id}`, label: fit(workRow(one), width - 4), hotkey: index < 10 ? String(index) : undefined, plain: true, autoFocus: index === 1 ? true : undefined, onPress: press($, () => startWork($, one), false) }))
      }
    }
    rows.push(Button({ key: 'pick-back', label: 'Back', hotkey: '0', plain: true, dimColor: true, onPress: show($, 'home') }))
    return Box({ flexDirection: 'column', children: rows })
  }
  const { header } = model
  if (header.stage === 'Away') {
    // Nothing is focused: one stray Enter must not end the window and lift its holds.
    const [end] = model.items
    rows.push(Text({ key: 'title', bold: true, children: fit(`${header.title === 'Ather' ? 'Ather' : header.title} · 🌙 away ${header.progress}`, width) }))
    rows.push(Text({ key: 'so', dimColor: true, children: fit(`So far: ${header.sentence}.`, width) }))
    rows.push(Text({ key: 'gap-end', children: ' ' }))
    if (end) rows.push(Button({ key: 'end', label: end.title, hotkey: 'e', plain: true, onPress: press($, () => act($, end), false) }))
    rows.push(Text({ key: 'gap-foot', children: ' ' }))
    rows.push(Text({ key: 'foot', dimColor: true, children: 'Esc closes' }))
    return Box({ flexDirection: 'column', children: rows })
  }
  const status = [header.stage, header.progress, header.sentence].filter(Boolean).join(' · ')
  rows.push(Text({ key: 'title', bold: true, children: fit(`${header.title}${status ? ` · ${status}` : ''}`, width) }))
  rows.push(Text({ key: 'track', dimColor: true, children: fit([header.track, header.role, header.proof, header.lock].filter(Boolean).join('   '), width) }))
  if (model.items.length > 0) {
    rows.push(Text({ key: 'gap-items', children: ' ' }))
    rows.push(Text({ key: 'needs', bold: true, children: `Needs you (${model.open.length})` }))
    model.items.slice(0, 9).forEach((one, index) => {
      const isSent = !model.open.includes(one)
      rows.push(Button({ key: `item-${one.id}`, label: fit(`${isSent ? '✓ sent · ' : ''}${one.title}`, width), hotkey: String(index + 1), plain: true, dimColor: isSent ? true : undefined, autoFocus: one === model.open[0] ? true : undefined, onPress: press($, () => act($, one), false) }))
    })
  }
  const next = model.next
  if (next) {
    const isSent = sent.has(next.id)
    rows.push(Text({ key: 'gap-next', children: ' ' }))
    rows.push(Button({ key: 'next', label: fit(`NEXT  ${isSent ? '✓ sent · ' : ''}${next.label}`, width), hotkey: 'n', plain: true, dimColor: isSent ? true : undefined, autoFocus: model.open.length === 0 && !next.action ? true : undefined, onPress: press($, () => doNext($, next), next.work?.kind === 'intent') }))
    rows.push(Text({ key: 'next-hint', dimColor: true, wrap: 'wrap', children: `      ${next.hint}` }))
  }
  if (header.title === 'Ather') {
    rows.push(Text({ key: 'gap-picks', children: ' ' }))
    const mine = model.picks.filter(one => one.isMine)
    const theirs = model.picks.filter(one => !one.isMine)
    let index = 0
    for (const [key, heading, list] of /** @type {const} */ ([['mine', model.isNewcomer ? 'Or pick something of yours' : 'Also yours', mine], ['theirs', 'Follow a teammate (read-only)', theirs]])) {
      if (list.length === 0) continue
      rows.push(Text({ key: `picks-${key}`, bold: true, children: heading }))
      for (const one of list) {
        rows.push(Button({ key: `work-${one.id}`, label: fit(workRow(one), width), plain: true, hotkey: String.fromCharCode(97 + index), onPress: press($, () => startWork($, one), one.kind === 'intent') }))
        index += 1
      }
    }
    rows.push(Button({ key: 'all', label: 'Everything open…', hotkey: 'i', plain: true, dimColor: true, onPress: show($, 'pick') }))
  }
  if (model.offerAway) {
    rows.push(Text({ key: 'gap-away', children: ' ' }))
    const presets = AWAY_PRESETS.map(preset => Button({ key: `away-${preset.hotkey}`, label: preset.label, hotkey: preset.hotkey === 'u' ? 'u' : undefined, plain: true, onPress: press($, () => startAway($, { ...preset.choice, goal: '' }), false) }))
    rows.push(Box({ key: 'away', flexDirection: 'row', gap: 2, children: [Text({ bold: true, children: '🌙 Heading off?' }), ...presets] }))
  }
  rows.push(Text({ key: 'gap-foot', children: ' ' }))
  rows.push(Text({ key: 'foot', dimColor: true, children: fit(model.isNewcomer ? 'Enter chooses · Esc closes · /ather tour' : 'Enter chooses · Esc closes · /away when you leave', width) }))
  return Box({ flexDirection: 'column', children: rows })
}
