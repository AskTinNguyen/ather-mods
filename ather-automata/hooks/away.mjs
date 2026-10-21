// @ts-check
// Ather Automata: the autonomy window's rules. What a window allows and holds,
// its ledger text, and the mandate the session is given. Pure: no `$`; the one
// place that changes a window is state.mjs.

import { forBase, heldLabel } from './guards.mjs'
import { untitledName } from './handoff.mjs'
import { clockText, durationText } from './model.mjs'
import { unreal } from './packs/unreal.mjs'

/** @typedef {import('./packs/index.mjs').Pack} Pack */

/**
 * @typedef {{ id: string, kind: string, command: string, at: number }} Parked
 * A window holds actions and records questions from the moment it starts until the person has reviewed it:
 * 'running' while they are away, 'review' once it has ended and waits for them. `group`: the windows opened together
 * from one Away dialog or /away share it, and the person's return in any of them ends them all.
 * @typedef {{ phase: 'off' | 'running' | 'review', untilDone: boolean, goal: string, held: string[], startedAt: number, wakeAt: number, endedAt?: number, ledgerPath: string, parked: Parked[], person: string, root: string, group?: string }} Away
 * @typedef {{ hours: number, untilDone: boolean, goal: string, held?: string[], group?: string }} WindowChoice
 */

/** @returns {Away} */
export const offAway = () => ({ phase: 'off', untilDone: false, goal: '', held: ['merge', 'push-main'], startedAt: 0, wakeAt: 0, ledgerPath: '', parked: [], person: '', root: '' })

// Held actions stay held until the person has reviewed the window, not only while it runs.
/** @param {Away} away */
export const isHolding = away => away.phase !== 'off'

// The session's questions go to the ledger while the window runs, and after it ends until the person
// is back: the first thing they type after the end (at `lastPersonAt`) means they can be asked again.
/** @param {Away} away @param {number} lastPersonAt */
export const isRecordingQuestions = (away, lastPersonAt) => away.phase === 'running' || (away.phase === 'review' && lastPersonAt < (away.endedAt ?? 0))

// Presets (decided 2026-10-03). Each may push branches and open draft PRs and PRs to main;
// merges and direct pushes to main stay held.
export const AWAY_PRESETS = [
  { label: 'Until done', hotkey: 'u', choice: { hours: 24, untilDone: true } },
  { label: '8 hours', hotkey: 'o', choice: { hours: 8, untilDone: false } },
  { label: '4 hours', hotkey: 'h', choice: { hours: 4, untilDone: false } },
]

/** @param {number} hours */
export const clampHours = hours => Math.min(16, Math.max(0.25, hours))

// "/away stop", "/away end now": ending, in the words people use.
/** @param {string} args */
export const isStopWord = args => /^((i'?m|i am)\s+)?(end|stop|off|cancel|quit|finish|back|home)(\s+now)?[.!]?$/i.test(args.trim())

// "/away until done ship it", "/away 6h fix the pool", "30m", "until 9am", "tonight": how long, then the goal.
// `nowMinutes` is the person's local time of day, for "until 9am" and "tonight" (until 09:00).
/** @param {string} args @param {number} nowMinutes @returns {WindowChoice | null} */
export const parseAwayArgs = (args, nowMinutes) => {
  const text = args.trim()
  const done = /^(until[\s-]*done|done)\b[\s,]*/i.exec(text)
  if (done) return { hours: 24, untilDone: true, goal: text.slice(done[0].length).trim() }
  const hours = /^(\d{1,2}(?:\.\d+)?)\s*h(?:ours?|rs?)?\b[\s,]*/i.exec(text)
  if (hours) return { hours: clampHours(Number(hours[1])), untilDone: false, goal: text.slice(hours[0].length).trim() }
  const minutes = /^(\d{1,3})\s*m(?:in(?:ute)?s?)?\b[\s,]*/i.exec(text)
  if (minutes) return { hours: clampHours(Number(minutes[1]) / 60), untilDone: false, goal: text.slice(minutes[0].length).trim() }
  const until = /^(?:until|till|til)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b[\s,]*/i.exec(text) ?? /^(tonight|overnight|tomorrow(?:\s+morning)?)\b[\s,]*/i.exec(text)
  if (!until) return null
  const isNamed = /^(tonight|overnight|tomorrow)/i.test(until[1] ?? '')
  let hour = isNamed ? 9 : Number(until[1]) % 12 + (/pm/i.test(until[3] ?? '') ? 12 : 0)
  if (!isNamed && !until[3] && Number(until[1]) >= 12) hour = Number(until[1])
  const target = hour * 60 + (isNamed ? 0 : Number(until[2] ?? 0))
  const ahead = (target - nowMinutes + 1440) % 1440 || 1440
  return { hours: Math.min(24, ahead / 60), untilDone: false, goal: text.slice(until[0].length).trim() }
}

/** @param {Away} away @param {number} tz */
export const windowEndText = (away, tz) => (away.untilDone ? 'until done (24 hours at most)' : `until ${clockText(away.wakeAt, tz)}`)

// The same for the session to read: "until 17:30 local time", or "until the work is done (hard stop 13:45 local
// time)" for a window with no set end, whose `wakeAt` is only its 24-hour limit, never when the person is back.
/** @param {Pick<Away, 'untilDone' | 'wakeAt'>} away @param {number} tz */
export const awayUntilText = (away, tz) => (away.untilDone ? `until the work is done (hard stop ${clockText(away.wakeAt, tz)} local time)` : `until ${clockText(away.wakeAt, tz)} local time`)

// Why a question is not asked now: the person is away, or has not reviewed the window that ended.
/** @param {{ phase: string, untilDone: boolean, wakeAt: number }} away @param {number} tz */
export const awayReason = (away, tz) => (away.phase === 'review' ? 'The user has not reviewed the away window yet' : `The user is away ${awayUntilText(away, tz)}`)

/** @param {WindowChoice} choice @param {number} now @param {string} ledgerPath @param {{ person: string, root: string }} owner @returns {Away} */
export const newWindow = (choice, now, ledgerPath, owner) => ({
  phase: 'running',
  untilDone: choice.untilDone,
  goal: choice.goal,
  held: choice.held ?? ['merge', 'push-main'],
  startedAt: now,
  wakeAt: now + (choice.untilDone ? 24 : Math.min(24, Math.max(0.25, choice.hours))) * 3600000,
  ledgerPath,
  parked: [],
  person: owner.person,
  root: owner.root,
  ...(choice.group ? { group: choice.group } : {}),
})

// `base`: the branch the checkout's team merges into; a window there says so where it says main (guards.mjs forBase).
/** @param {Away} away @param {Pack} pack @param {string} [base] */
const heldText = (away, pack, base) => away.held.map(kind => heldLabel(kind, pack, base)).join(', ') || 'nothing'

// A ledger file with a new window appended (or started).
/** @param {string} existing @param {Away} away @param {number} tz @param {Pack} [pack] @param {string} [base] */
export const ledgerWithWindow = (existing, away, tz, pack = unreal, base = 'main') =>
  [
    existing === '' ? '# Autonomy Window Decisions\n' : existing.trimEnd(),
    '',
    `## Autonomy window from ${clockText(away.startedAt, tz)}, ${windowEndText(away, tz)}`,
    '',
    `- Goal: ${away.goal || '(see the session)'}`,
    `- Allowed without asking: ${forBase(pack.mandate.allowed, base)}`,
    `- Held: ${heldText(away, pack, base)}`,
    '',
    'Each decision taken for you while you were away. Entry format: Options, Choice, Why, Evidence, Revert, Status (provisional, kept, revert requested, reopened).',
    '',
  ].join('\n')

/** @param {Away} away @param {number} tz @param {Pack} [pack] @param {string} [base] */
export const mandateText = (away, tz, pack = unreal, base = 'main') =>
  away.phase === 'review'
    ? `AWAY WINDOW ENDED (Ather Automata): the user has not reviewed it yet. Until they do, do not retry held actions (${heldText(away, pack, base)}) and record any decision that would be theirs in ${away.ledgerPath} instead of asking.`
    : [
    `AUTONOMY WINDOW (Ather Automata): the user is away ${awayUntilText(away, tz)}.${away.untilDone ? ' When the goal is done, call the mcp__ather-automata__away tool with action "end" so the user gets the review.' : ''}`,
    `Goal: ${away.goal || 'continue the active work'}.`,
    `Allowed without asking for this window: ${forBase(pack.mandate.allowed, base)}. Use them on feature branches; ${pack.mandate.merge}.`,
    `Do not stop to ask or wait for answers. On any decision that would be the user\'s, take the recommended option, prefer the reversible one, and ${pack.mandate.flags}.`,
    `Record every such decision when you make it in ${away.ledgerPath} as "### D-<n> · <question>" with the lines Options, Choice, Why, Evidence, Revert, Status: provisional.`,
    `Held until the user has reviewed the window (they will be refused and parked, do not retry them): ${heldText(away, pack, base)}.`,
    'The AGENTS.md safety contract still applies in full. When blocked on one item, move to another instead of waiting.',
  ].join(' ')

/** @param {string} id @param {string} question @param {readonly string[]} options */
export const pendingEntry = (id, question, options) =>
  [`### ${id} · ${question.replace(/\s+/g, ' ').trim()}`, `- Options: ${options.length > 0 ? options.join('; ') : '(none given)'}`, '- Choice: pending (take the recommended option)', '- Why: ', '- Evidence: ', '- Revert: ', '- Status: provisional', ''].join('\n')

// Decision ids continue from the ledger file itself, so nothing else has to count them.
/** @param {string} markdown */
export const nextLedgerId = markdown => Math.max(1, ...[...markdown.matchAll(/^###\s+D-(\d+)/gm)].map(match => Number(match[1]) + 1))

/** @param {readonly Parked[]} parked */
export const nextParkId = parked => `P-${Math.max(0, ...parked.map(one => Number(one.id.slice(2)) || 0)) + 1}`

// The decisions recorded in the latest window of a ledger.
/** @param {string} markdown */
export const windowDecisions = markdown => {
  const parts = markdown.split(/^(?=## Autonomy window from )/m)
  return [...(parts[parts.length - 1] ?? '').matchAll(/^###\s+(D-\d+)\s*[·:\-–]?\s*(.*)$/gm)].map(match => ({ id: match[1] ?? '', question: (match[2] ?? '').trim() }))
}

// ---------------------------------------------------------------- heading off for several sessions

// A session that runs on its own whoever is at the keyboard, so the Away dialog does not tick it by default (A1):
// the sync conductor (a name starting with ♾, or naming "sync main") or a scheduled task (a name saying how often it
// runs: "(2 tiếng/lần)", "Hằng ngày", "daily", "hourly", "nightly", "every …", "scheduled"). Read from its title in
// the desktop app, else its branch.
/** @param {string} name @returns {'sync' | 'scheduled' | ''} */
export const sideKind = name => {
  if (/^\s*♾/u.test(name) || /\bsync[\s_-]*main\b/i.test(name)) return 'sync'
  if (/\(\s*\d+\s*(tiếng|giờ|phút|h|m)\s*\/\s*lần\s*\)|h[ằà]ng ngày|\b(daily|hourly|nightly|every|scheduled)\b/iu.test(name)) return 'scheduled'
  return ''
}

/**
 * One live session of the checkout as the Away dialog lists it (A1): its CLI id and app id (to send it the mandate),
 * its title in the app ('' outside it), branch and tracked intent (what /away names match), the row's name and what it
 * says beside it, and whether it is ticked when the dialog opens. `awayUntil`: the end of the window it is already in
 * ('' for none); such a session is listed, never ticked.
 * @typedef {{ sessionId: string, appId: string, title: string, branch: string, intent: string | null, name: string, detail: string, isSelf: boolean, isDefault: boolean, awayUntil: string }} AwaySession
 * @typedef {import('./handoff.mjs').Peer & { window?: Away }} AwayPeer a live session of the checkout with its stored window
 */

/**
 * The Away dialog's list: this session first; then the others, those ticked by default (each tracks an intent and is
 * neither the sync conductor nor a scheduled task), then the rest, then those already away, each group the most
 * recently active first. This session is always ticked.
 * @param {{ sessionId: string, title: string, branch: string, intent: string | null }} self
 * @param {readonly AwayPeer[]} peers @param {number} now @param {number} tz @returns {AwaySession[]}
 */
export const awaySessions = (self, peers, now, tz) => {
  const others = peers
    .filter(lane => typeof lane.sessionId === 'string' && lane.sessionId !== '' && lane.sessionId !== self.sessionId)
    .map(lane => {
      const title = lane.app?.title ?? ''
      const branch = lane.branch ?? ''
      const window = lane.window && isHolding(lane.window) ? lane.window : null
      const side = sideKind(title || branch)
      const ago = now - Number(lane.lastActiveAt ?? lane.updatedAt)
      const detail = window ? `away ${windowEndText(window, tz)}` : side === 'scheduled' ? 'scheduled' : ago < 60000 ? 'active now' : `active ${durationText(ago)} ago`
      /** @type {AwaySession} */
      const row = { sessionId: lane.sessionId, appId: lane.app?.id ?? '', title, branch, intent: lane.intent, name: title || untitledName(branch), detail, isSelf: false, isDefault: !window && Boolean(lane.intent) && side === '', awayUntil: window ? windowEndText(window, tz) : '' }
      return { row, rank: window ? 2 : row.isDefault ? 0 : 1, at: -ago }
    })
    .sort((a, b) => a.rank - b.rank || b.at - a.at)
    .map(one => one.row)
  const name = self.title || self.branch
  return [{ sessionId: self.sessionId, appId: '', title: self.title, branch: self.branch, intent: self.intent, name: name ? `this session · ${name}` : 'this session', detail: '', isSelf: true, isDefault: true, awayUntil: '' }, ...others]
}

// "/away 8h all", "/away until done enemy, playtest: finish the pass": which sessions the words after the length name
// (A4). `all`: the ones ticked by default. Else each comma-separated name (three letters at least) picks every session
// whose title, branch or intent contains it, case-insensitive; a goal may follow a colon. Null when any name matches
// no session: the words are the goal, for this session only, as before. A session already away is never picked.
/** @param {string} words @param {readonly AwaySession[]} sessions @returns {{ picked: AwaySession[], goal: string } | null} */
export const pickedSessions = (words, sessions) => {
  const [list = '', ...rest] = words.split(':')
  const names = list.split(',').map(one => one.trim().toLowerCase())
  const open = sessions.filter(one => one.awayUntil === '')
  const goal = rest.join(':').trim()
  if (names.length === 1 && names[0] === 'all') return { picked: open.filter(one => one.isDefault), goal }
  const matches = names.map(name => (name.length < 3 ? [] : open.filter(one => [one.title, one.branch, one.intent ?? ''].some(field => field.toLowerCase().includes(name)))))
  if (matches.some(found => found.length === 0)) return null
  return { picked: open.filter(one => matches.some(found => found.includes(one))), goal }
}

// What another session reads when the person heads off from this one (A2): that its window is open, and the mandate
// whole (its ledger, what is held). The engine frames it as a message from this session (`from`, as its tab names it).
// Should the window not show there, the session can open it itself with the same length and goal; a window opened that
// way is its own, outside the group (the person's return elsewhere does not end it).
/** @param {{ from: string, away: Away, tz: number, pack?: Pack, base?: string }} at */
export const awayMessage = ({ from, away, tz, pack = unreal, base = 'main' }) =>
  [
    `From the Ather pane of ${from}: the person is heading off and opened an away window in your session too.`,
    mandateText(away, tz, pack, base),
    `If the mcp__ather-automata__status tool shows no away window for your session, open it with the mcp__ather-automata__away tool: action "start", ${away.untilDone ? 'untilDone true' : `hours ${Math.round(((away.wakeAt - away.startedAt) / 3600000) * 100) / 100}`}, goal ${JSON.stringify(away.goal)}.`,
  ].join('\n\n')
