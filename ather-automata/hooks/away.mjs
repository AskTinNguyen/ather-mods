// @ts-check
// Ather Automata: the autonomy window's rules. What a window allows and holds,
// its ledger text, and the mandate the session is given. Pure: no `$`; the one
// place that changes a window is state.mjs.

import { HELD_LABELS } from './guards.mjs'
import { clockText } from './model.mjs'

/**
 * @typedef {{ id: string, kind: string, command: string, at: number }} Parked
 * A window holds actions and records questions from the moment it starts until the person has reviewed it:
 * 'running' while they are away, 'review' once it has ended and waits for them.
 * @typedef {{ phase: 'off' | 'running' | 'review', untilDone: boolean, goal: string, held: string[], startedAt: number, wakeAt: number, endedAt?: number, ledgerPath: string, parked: Parked[], person: string, root: string }} Away
 * @typedef {{ hours: number, untilDone: boolean, goal: string, held?: string[] }} WindowChoice
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
export const ALLOWED_TEXT = 'push branches, open draft PRs, open PRs to main'

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
})

/** @param {Away} away */
const heldText = away => away.held.map(kind => HELD_LABELS[/** @type {keyof typeof HELD_LABELS} */ (kind)] ?? kind).join(', ') || 'nothing'

// A ledger file with a new window appended (or started).
/** @param {string} existing @param {Away} away @param {number} tz */
export const ledgerWithWindow = (existing, away, tz) =>
  [
    existing === '' ? '# Autonomy Window Decisions\n' : existing.trimEnd(),
    '',
    `## Autonomy window from ${clockText(away.startedAt, tz)}, ${windowEndText(away, tz)}`,
    '',
    `- Goal: ${away.goal || '(see the session)'}`,
    `- Allowed without asking: ${ALLOWED_TEXT}`,
    `- Held: ${heldText(away)}`,
    '',
    'Each decision taken for you while you were away. Entry format: Options, Choice, Why, Evidence, Revert, Status (provisional, kept, revert requested, reopened).',
    '',
  ].join('\n')

/** @param {Away} away @param {number} tz */
export const mandateText = (away, tz) =>
  away.phase === 'review'
    ? `AWAY WINDOW ENDED (Ather Automata): the user has not reviewed it yet. Until they do, do not retry held actions (${heldText(away)}) and record any decision that would be theirs in ${away.ledgerPath} instead of asking.`
    : [
    away.untilDone
      ? `AUTONOMY WINDOW (Ather Automata): the user is away until the work is done (hard stop ${clockText(away.wakeAt, tz)} local time). When the goal is done, call the mcp__ather-automata__away tool with action "end" so the user gets the review.`
      : `AUTONOMY WINDOW (Ather Automata): the user is away until ${clockText(away.wakeAt, tz)} local time.`,
    `Goal: ${away.goal || 'continue the active work'}.`,
    `Allowed without asking for this window: ${ALLOWED_TEXT}. Use them on feature branches; never merge.`,
    'Do not stop to ask or wait for answers. On any decision that would be the user\'s, take the recommended option, prefer the reversible one, and keep behaviour changes behind a CVar that defaults to the current behaviour.',
    `Record every such decision when you make it in ${away.ledgerPath} as "### D-<n> · <question>" with the lines Options, Choice, Why, Evidence, Revert, Status: provisional.`,
    `Held until the user has reviewed the window (they will be refused and parked, do not retry them): ${heldText(away)}.`,
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
