// @ts-check
// Ather Board: the model's help (D7, D9). The brief: Sonnet reads a digest of the open intents and says
// what matters, as a headline and a few suggestions that each name intents and one action. Ask: a
// question typed in the pane comes back as a short answer and a cut of the board. Every reply is checked
// against what the board read: an intent it does not know, or an action it does not have, is dropped,
// so a suggestion on the board always acts on real intents. Pure: no `$`; index.mjs makes the calls.

import { ACTION_KINDS, OWNER_ACTIONS } from './act.mjs'
import { isMine } from './ather/model.mjs'
import { NO_FILTER, PANE_VIEWS, STAGES, ageText } from './views.mjs'

/**
 * @typedef {import('./views.mjs').BoardRecord} BoardRecord
 * @typedef {import('./views.mjs').View} View
 * @typedef {import('./views.mjs').Filter} Filter
 * @typedef {import('./focus.mjs').Suggestion} Suggestion
 * @typedef {{ headline: string, suggestions: Suggestion[] }} Brief
 * @typedef {{ answer: string, view: View | '', area: string, owner: string, stage: string, keys: string[] }} Answer a cut of the board: '' leaves that part as it is; `keys`: only these intents
 */

export const MODEL = 'sonnet'
export const MAX_SUGGESTIONS = 5

// One line per open intent, what a model needs to judge it and nothing more (a digest of ~80 intents is ~6k tokens).
/** @param {readonly BoardRecord[]} records @param {string} me @param {number} now */
export const digest = (records, me, now) =>
  records
    .filter(one => one.stage !== 'done')
    .map(one =>
      [
        one.key,
        STAGES.find(stage => stage.key === one.stage)?.label ?? one.stage,
        one.area,
        `${one.owner || 'no owner'}${isMine(one, me) ? ' (me)' : ''}`,
        one.total ? `${one.done}/${one.total} met` : 'no checklist',
        `changed ${ageText(one.updatedAt, now) || '?'} ago`,
        one.flags.length ? `flags: ${one.flags.map(flag => flag.label).join(', ')}` : '',
        one.calls.length ? `decisions: ${one.calls.map(call => `${call.id} ${call.title}`).join('; ')}` : '',
        one.goal,
      ]
        .filter(Boolean)
        .join(' | '),
    )
    .join('\n')

// The views an answer may pick: the pane's, less For you (which takes no filter).
const VIEWS = PANE_VIEWS.filter(view => view !== 'foryou')

const ROLE = `You help a game studio's team cut through its list of "intents" (features, each a folder with a goal, an acceptance checklist and open decisions). The board is read-only; every action you suggest is handed to a Claude Code session that asks the person before changing anything. Be concrete and brief: name intents by their key exactly as given, never invent one. Prefer what unblocks the most work: decisions waiting, work ready to close, stale or stuck work, then hygiene.`

const ACTIONS = `Actions: ${ACTION_KINDS.join(', ')}, or show (cut the board to the intents named). ${OWNER_ACTIONS.join(', ')} are for the person's own intents (marked "(me)"); for a teammate's, use ping, about or show.`

/** @param {readonly BoardRecord[]} records @param {string} me @param {number} now */
export const briefRequest = (records, me, now) => ({
  model: MODEL,
  maxTokens: 1500,
  system: `${ROLE}\n${ACTIONS}`,
  prompt: `The person at the keyboard is ${me || 'unknown'}. The open intents, one per line (key | stage | area | owner | checklist | last change | flags | decisions | goal):\n\n${digest(records, me, now)}\n\nWrite the brief: what matters most right now, for this person first, then for the team. Reply with JSON only, no prose around it:\n{"headline": "<one sentence>", "suggestions": [{"title": "<imperative, under 12 words>", "why": "<one short sentence>", "action": "<action>", "intents": ["<key>", ...]}]}\nAt most ${MAX_SUGGESTIONS} suggestions.`,
})

/** @param {string} question @param {readonly BoardRecord[]} records @param {string} me @param {number} now */
export const askRequest = (question, records, me, now) => ({
  model: MODEL,
  maxTokens: 800,
  system: `${ROLE}\nYou answer a question about the board and pick the cut of it that shows the answer. Views: ${VIEWS.join(', ')} (items: open acceptance items; modules: the game's modules). Stages: ${STAGES.map(stage => stage.key).join(', ')}.`,
  prompt: `The person at the keyboard is ${me || 'unknown'}. The open intents, one per line (key | stage | area | owner | checklist | last change | flags | decisions | goal):\n\n${digest(records, me, now)}\n\nTheir question: ${question.trim()}\n\nReply with JSON only, no prose around it:\n{"answer": "<at most three sentences>", "view": "<a view, or empty>", "area": "<an area exactly as listed, or empty>", "owner": "<an owner exactly as listed, or empty>", "stage": "<a stage, or empty>", "intents": ["<key>", ...]}\nList intents only when the answer is a particular set of them; leave the rest empty.`,
})

// The first JSON object in a reply (a model may wrap it in a code fence); null when there is none.
/** @param {string} text @returns {Record<string, unknown> | null} */
export const jsonOf = text => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** @param {unknown} value @param {number} max */
const words = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

// The keys a reply names that the board read, in its order, once each.
/** @param {unknown} value @param {readonly BoardRecord[]} records @returns {string[]} */
const knownKeys = (value, records) => {
  const known = new Set(records.map(one => one.key))
  return Array.isArray(value) ? [...new Set(value.filter(key => typeof key === 'string' && known.has(key)))] : []
}

// What a suggestion may ask for: an action, or show.
/** @type {Suggestion['action'][]} */
const PICKS = ['show', ...ACTION_KINDS]

// A brief from the model's reply; null when the reply has no brief in it. A suggestion naming no known
// intent, or an unknown action, is dropped; an action only the owner may take, suggested for a
// teammate's intent, becomes show.
/** @param {string} text @param {readonly BoardRecord[]} records @param {string} me @returns {Brief | null} */
export const parseBrief = (text, records, me) => {
  const reply = jsonOf(text)
  if (!reply) return null
  const list = Array.isArray(reply.suggestions) ? reply.suggestions : []
  /** @type {Suggestion[]} */
  const suggestions = list.flatMap((/** @type {unknown} */ item, /** @type {number} */ index) => {
    const one = item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {}
    const keys = knownKeys(one.intents, records)
    const action = PICKS.find(kind => kind === words(one.action, 20))
    if (keys.length === 0 || !action) return []
    const isOwn = keys.every(key => records.some(record => record.key === key && isMine(record, me)))
    return [{ key: `brief-${index}`, title: words(one.title, 90) || keys.join(', '), why: words(one.why, 200), action: action !== 'show' && OWNER_ACTIONS.some(kind => kind === action) && !isOwn ? 'show' : action, keys }]
  })
  return { headline: words(reply.headline, 240), suggestions: suggestions.slice(0, MAX_SUGGESTIONS) }
}

// An answer from the model's reply; null when there is none. A view, area, owner or stage the board
// does not have is left as it is ('').
/** @param {string} text @param {readonly BoardRecord[]} records @returns {Answer | null} */
export const parseAnswer = (text, records) => {
  const reply = jsonOf(text)
  if (!reply) return null
  const answer = words(reply.answer, 600)
  const pick = (/** @type {unknown} */ value, /** @type {readonly string[]} */ allowed) => { const one = words(value, 80); return allowed.includes(one) ? one : '' }
  return {
    answer,
    view: VIEWS.find(view => view === words(reply.view, 20)) ?? '',
    area: pick(reply.area, [...new Set(records.map(one => one.area))]),
    owner: pick(reply.owner, [...new Set(records.map(one => one.owner))]),
    stage: pick(reply.stage, STAGES.map(stage => stage.key)),
    keys: knownKeys(reply.intents, records),
  }
}

// The cut of the board an answer picked: its view (the table when it names intents and no view; For you,
// which has no filters, gives way to Triage), and its filters over a clean slate.
/** @param {Answer} answer @param {View} current @returns {{ view: View, filter: Filter }} */
export const answerLook = (answer, current) => ({
  view: answer.view || (answer.keys.length > 0 ? 'table' : current === 'foryou' ? 'triage' : current),
  filter: { ...NO_FILTER, area: answer.area, owner: answer.owner, stage: answer.stage, keys: answer.keys },
})
