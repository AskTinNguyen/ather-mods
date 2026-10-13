// @ts-check
// Ather Board: what can be done about an intent from the board, and what each press hands the session.
// The board never changes anything itself (D6): every action is one prompt the session acts on with its
// own tools, asking before it writes, commits or messages anyone. Answering a decision uses Ather's own
// prompts (decide.mjs), so a decision taken here is recorded the intent skill's way, as in /ather.
// Pure: no `$`.

import { decidePrompt, explainPrompt } from './ather/decide.mjs'
import { aboutIntentPrompt, andList, checklistPrompt, closePrompt, plural } from './ather/model.mjs'
import { HYGIENE } from './views.mjs'

/**
 * @typedef {import('./views.mjs').BoardRecord} BoardRecord
 * @typedef {import('./views.mjs').Call} Call
 * @typedef {'decide' | 'close' | 'unstick' | 'reason' | 'checklist' | 'tidy' | 'ping' | 'about'} ActionKind
 */

// What each action's button says.
export const ACTION_LABELS = /** @type {const} */ ({
  decide: 'Answer its decisions',
  close: 'Close it',
  unstick: 'Unstick it',
  reason: 'Give a reason',
  checklist: 'Write the checklist',
  tidy: 'Fix its header',
  ping: 'Ask the owner',
  about: 'Where it stands',
})
export const ACTION_KINDS = /** @type {readonly ActionKind[]} */ (Object.keys(ACTION_LABELS))

// The owner's actions, by the flag that calls for each, worst first: an intent's next action is the first
// whose flag it has. A teammate's intent offers asking its owner instead, when anything needs someone.
// Only an intent's owner is offered these (OWNER_ACTIONS); the brief turns one suggested for a teammate's into show.
const OWN = /** @type {const} */ ([
  ['decisions', 'decide'],
  ['met', 'close'],
  ['unparked', 'reason'],
  ['stale', 'unstick'],
  ['plan', 'checklist'],
  ['status', 'tidy'],
  ['owner', 'tidy'],
  ['area', 'tidy'],
])

/**
 * Every action an intent offers, its next action first and "Where it stands" last. Done intents offer
 * only that. `isMine`: the person at the keyboard owns it.
 * @param {BoardRecord} record @param {boolean} isMine @returns {ActionKind[]}
 */
export const actionsFor = (record, isMine) => {
  if (record.stage === 'done') return ['about']
  const kinds = new Set(record.flags.map(flag => flag.kind))
  /** @type {ActionKind[]} */
  const offered = isMine ? OWN.filter(([flag]) => kinds.has(flag)).map(([, action]) => action) : record.flags.some(flag => !HYGIENE.includes(flag.kind)) ? ['ping'] : []
  return [...new Set([...offered, /** @type {ActionKind} */ ('about')])]
}

export const OWNER_ACTIONS = /** @type {readonly ActionKind[]} */ ([...new Set(OWN.map(([, action]) => action))])

/** @param {BoardRecord} record @param {boolean} isMine */
export const nextAction = (record, isMine) => actionsFor(record, isMine)[0] ?? 'about'

// Reading an intent wherever it is: this checkout's copy, else origin's, never changing either.
/** @param {string} slug @param {string} base */
const readIt = (slug, base) => `Read intent ${slug} from docs/intent/${slug}/; if this checkout lacks it or is behind, read it from origin/${base} with git show (GIT_OPTIONAL_LOCKS=0), without fetching or checking anything out.`

// What every writing prompt asks first: the checkout's copy is the one to change.
/** @param {string} slug @param {string} base */
const inCheckout = (slug, base) => `Work in docs/intent/${slug}/ of this checkout; if it is missing or behind origin/${base}, say so and stop before changing anything.`

/**
 * The one prompt an action hands the session. `base`: the branch the team merges into.
 * @param {ActionKind} kind @param {BoardRecord} record @param {string} base
 */
export const actionPrompt = (kind, record, base) => {
  const { slug } = record
  const flags = record.flags.map(flag => flag.label)
  switch (kind) {
    case 'decide':
      return `Walk me through the ${plural(record.calls.length, 'open decision')} on intent ${slug} (${record.calls.map(call => call.id).join(', ')}), one at a time: what each is about, its options and your recommendation. Record each answer I give the intent skill's way (.agents/skills/intent/SKILL.md, the decision step). ${inCheckout(slug, base)}`
    case 'close':
      return `${closePrompt(slug, record.prs, 'show me the diff before committing as the skill says')} ${inCheckout(slug, base)}`
    case 'unstick':
      return `Intent ${slug} has had no change for a while. ${readIt(slug, base)} Tell me, in under eight lines, what it is waiting on and the one next step that would move it, then offer to take that step. Change nothing until I say.`
    case 'reason':
      return `Intent ${slug} is parked with no reason on its Status line. Read its files and propose a one-line reason (what it waits on, or why it stopped) as "Status: parked: <reason>"; show me the line and edit prompt.md only once I agree. ${inCheckout(slug, base)}`
    case 'checklist':
      return `${checklistPrompt(slug)} ${inCheckout(slug, base)}`
    case 'tidy':
      return `The header of intent ${slug} does not read cleanly: ${andList(record.flags.filter(flag => HYGIENE.includes(flag.kind)).map(flag => flag.label))}. Propose the fix the intent skill's way (Status one word: active, parked or completed, a parked reason after it; an Owner line naming a person; an Area from docs/intent/README.md), show me the diff, and change nothing until I agree. ${inCheckout(slug, base)}`
    case 'ping':
      return `Draft a short, friendly message to ${record.owner || 'the owner'} about their intent ${slug}: ${flags.length ? andList(flags) : 'where it stands'}. ${readIt(slug, base)} Name the one thing that would help. Show me the draft; do not send it.`
    case 'about':
      return aboutIntentPrompt(slug, record.source === 'main', '', base)
  }
}

// One action over several intents (closing every ready one, say): each one's own prompt, in turn.
/** @param {ActionKind} kind @param {readonly BoardRecord[]} records @param {string} base */
export const batchPrompt = (kind, records, base) =>
  records.length === 1 && records[0]
    ? actionPrompt(kind, records[0], base)
    : [`Take these ${records.length} intents one at a time, finishing each before the next:`, ...records.map((one, index) => `${index + 1}. ${actionPrompt(kind, one, base)}`)].join('\n')

// A decision answered in place: an option chosen, or Explain. Ather's own wording (decide.mjs).
/** @param {BoardRecord} record @param {Call} call @param {string} letter '' explains it */
export const decisionPrompt = (record, call, letter) => {
  const option = call.options.find(one => one.letter === letter)
  return option ? decidePrompt(record.slug, call.id, `${option.letter} — ${option.text}`) : explainPrompt(record.slug, call.id)
}
