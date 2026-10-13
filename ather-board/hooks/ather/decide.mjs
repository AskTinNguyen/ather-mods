// @ts-check
// Ather Automata: answering a decision where Needs you shows it (0.2.0). What an item offers as
// answers, what each answer hands the session, what Needs you draws for each row, and the answers
// this session gave. Pure: no `$`.

import { callBlocks } from './worklist.mjs'

/** @typedef {import('./model.mjs').FindingOption} FindingOption */

/**
 * What a Needs you item can be answered with, in place. `options`: the buttons, in order, each with what
 * it hands the session ('' hands nothing: the press only closes the item); `explain`: what Explain hands
 * over; `typed`: what a typed answer hands over, given the person's words; `source`: the finding as
 * written, for Open findings (absent: no such button).
 * @typedef {{ options: (FindingOption & { prompt: string })[], explain: string, typed: (words: string) => string, source?: string }} Answers
 */

// How long an answered row shows "✓ Decided" in place before it folds into "▸ N decided".
export const DECIDED_SHOWN_MS = 8000

// A press on the opened decision's own row closes it: nothing is opened until another is pressed.
export const NONE_OPEN = '-'

/** @param {string} slug @param {string} id */
export const callId = (slug, id) => `call:${slug}:${id}`

// ---------------------------------------------------------------- what each answer hands the session

const RECORD = "Record it as the intent skill's decision step says (mark the finding, fill its Resolution, fold an accepted amendment into prompt.md with a Rev bump and a Decisions entry); do not ask me again."

/** @param {string} slug @param {string} id @param {string} choice */
export const decidePrompt = (slug, id, choice) => `Decide ${id} on ${slug}: ${choice.replace(/[\s.]+$/, '')}. ${RECORD}`

/** @param {string} slug @param {string} id */
export const explainPrompt = (slug, id) => `Explain decision ${id} on ${slug}: what it is about, each option and what it means, and why the recommendation; do not decide or change anything.`

// A typed answer as the choice: the person's words, quoted.
/** @param {string} words */
export const ownWords = words => `"${words.replace(/\s+/g, ' ').trim()}" (my own answer, in my words)`

// A finding's answers: its options, Explain, a typed answer and Open findings.
/** @param {string} slug @param {{ id: string, options?: readonly FindingOption[], source?: string }} finding @returns {Answers} */
export const findingAnswers = (slug, finding) => ({
  options: (finding.options ?? []).map(option => ({ ...option, prompt: decidePrompt(slug, finding.id, `${option.letter} — ${option.text}`) })),
  explain: explainPrompt(slug, finding.id),
  typed: words => decidePrompt(slug, finding.id, ownWords(words)),
  source: finding.source ?? '',
})

// ---------------------------------------------------------------- "make them rules?"

/** @typedef {{ title: string, count: number, fix: string }} Trap */

// The one wording every rule request ends with.
/** @param {string} owners @param {boolean} [isMany] */
const draftRule = (owners, isMany = false) =>
  `draft the change that prevents it (the AGENTS.md line or skill step, at the closest authority AGENTS.md allows) and show me the ${isMany ? 'diffs' : 'diff'} for review by the owners (${owners}); do not commit.`

/** @param {readonly Trap[]} traps */
const trapList = traps => traps.map((one, index) => `${traps.length > 1 ? `(${index + 1}) ` : ''}"${one.title}", ${one.count} sessions; its fix each time: ${one.fix}`).join(' ')

// The walk-through the session takes the person through (the item's own press, and /ather's question).
/** @param {readonly Trap[]} traps @param {string} owners */
export const rulePrompt = (traps, owners) => {
  const [one] = traps
  if (traps.length === 1 && one) return `The trap "${one.title}" has come up in ${one.count} separate sessions. Its fix each time: ${one.fix} Ask me with a question dialog whether to make it a rule. If yes, ${draftRule(owners)}`
  return `These traps keep coming back, each in several separate sessions: ${trapList(traps)} Ask me in one question dialog (multiSelect, one option per trap, labels short enough to stand alone) which to make rules. For each I pick, ${draftRule(owners, true)}`
}

// "Make them rules?" answered in place: yes drafts the change(s), no closes it here.
/** @param {readonly Trap[]} traps @param {string} owners @returns {Answers} */
export const ruleAnswers = (traps, owners) => {
  const named = trapList(traps)
  const one = traps.length === 1
  const yes = one ? 'Make it a rule' : `Make all ${traps.length} rules`
  const no = one ? 'No, leave it' : 'None of them'
  return {
    options: [
      { letter: 'A', label: yes, text: yes, isRecommended: false, prompt: `These traps keep coming back: ${named} Make ${one ? 'it a rule' : 'each one a rule'}: for each, ${draftRule(owners, !one)}` },
      { letter: 'B', label: no, text: no, isRecommended: false, prompt: '' },
    ],
    explain: `Explain ${one ? 'this repeated problem' : 'these repeated problems'}: ${named} Say what keeps happening and what a rule would change; do not draft or change anything.`,
    typed: words => `These traps keep coming back: ${named} My answer about making them rules: ${ownWords(words)}. For each I want made a rule, ${draftRule(owners, !one)}`,
  }
}

// ---------------------------------------------------------------- this session's answers

/**
 * An answer this session gave: the item, what was chosen ("A", or the typed words) and when.
 * Kept in this session only, until the item no longer reads as waiting in the files.
 * @typedef {{ id: string, answer: string, at: number }} Decided
 */

/**
 * Needs you's answering state: the decision pressed open ('' the first that waits, NONE_OPEN none), whose
 * typed answer is open, whether "▸ N decided" is unfolded, and this session's answers, newest first.
 * @typedef {{ opened: string, typing: string, isFoldOpen: boolean, decided: readonly Decided[] }} AnswerState
 */

/** @type {Readonly<AnswerState>} */
export const FRESH_ANSWERS = Object.freeze({ opened: '', typing: '', isFoldOpen: false, decided: Object.freeze([]) })

// "✓ Decided: A", or the first words of a typed answer.
/** @param {string} answer */
export const decidedText = answer => `✓ Decided: ${answer.length <= 40 ? answer : `${answer.slice(0, 39)}…`}`

// A new answer, replacing an earlier one for the same item.
/** @param {readonly Decided[]} decided @param {Decided} one */
export const withDecided = (decided, one) => [one, ...decided.filter(each => each.id !== one.id)]

// The answers to keep once the files were read again: those whose item still waits, and any given
// under DECIDED_SHOWN_MS ago (so a row that closes at once still shows its "✓ Decided").
/** @param {readonly Decided[]} decided @param {(id: string) => boolean} stillWaits @param {number} now */
export const pruneDecided = (decided, stillWaits, now) => decided.filter(one => stillWaits(one.id) || now - one.at < DECIDED_SHOWN_MS)

// The answers to draw, read only: those whose item is listed now, split into the ones shown in place
// (answered under DECIDED_SHOWN_MS ago) and the ones folded under "▸ N decided", newest first.
/** @param {readonly Decided[]} decided @param {readonly { id: string }[]} items @param {number} now */
export const decidedView = (decided, items, now) => {
  const listed = decided.filter(one => items.some(item => item.id === one.id)).sort((a, b) => b.at - a.at)
  return { fresh: listed.filter(one => now - one.at < DECIDED_SHOWN_MS), folded: listed.filter(one => now - one.at >= DECIDED_SHOWN_MS) }
}

// The decision drawn opened: the one pressed while it can still be answered, else the first that can
// (NONE_OPEN: none). `canAnswer` says which items wait for an answer now.
/** @template {{ id: string }} T @param {readonly T[]} visible @param {string} chosen @param {(one: T) => boolean} canAnswer @returns {T | undefined} */
export const openedDecision = (visible, chosen, canAnswer) => {
  if (chosen === NONE_OPEN) return undefined
  return visible.find(one => one.id === chosen && canAnswer(one)) ?? visible.find(canAnswer)
}

/** @typedef {'decided' | 'opened' | 'line'} RowState how Needs you draws a row: "✓ Decided" in place, opened with its answers, or its one line */

/**
 * @template T
 * @typedef {{ blocks: { slug: string, items: T[] }[], states: Record<string, RowState>, opens: Set<string>, shownId: string, fresh: Decided[], folded: Decided[], typingId: string, isFocusFree: boolean, isFoldOpen: boolean }} NeedsView
 */

// What Needs you draws (D3, D4): the blocks (an intent's several decisions as one), each row's state,
// the answers shown in place and folded, whose typed-answer field is drawn (only where the surface has
// one, `hasInput`) and whether the rows may take the focus. `opened`: the blocks pressed open.
/**
 * @template {{ id: string, kind: string, slug?: string, answers?: Answers }} T
 * @param {readonly T[]} items @param {readonly T[]} open @param {AnswerState} state @param {ReadonlySet<string>} opened @param {number} now @param {boolean} hasInput
 * @returns {NeedsView<T>}
 */
export const needsView = (items, open, state, opened, now, hasInput) => {
  const { fresh, folded } = decidedView(state.decided, items, now)
  const freshIds = new Set(fresh.map(one => one.id))
  const foldedIds = new Set(folded.map(one => one.id))
  const blocks = callBlocks(items.filter(one => !foldedIds.has(one.id)).slice(0, 9))
  const visible = blocks.flatMap(block => (block.items.length === 1 || opened.has(block.slug) ? block.items : []))
  const canAnswer = (/** @type {T} */ one) => Boolean(one.answers) && open.includes(one) && !freshIds.has(one.id)
  const shown = openedDecision(visible, state.opened, canAnswer)
  const typingId = shown && hasInput && shown.id === state.typing ? shown.id : ''
  /** @type {Record<string, RowState>} */
  const states = Object.fromEntries(items.map(one => [one.id, freshIds.has(one.id) ? 'decided' : one === shown ? 'opened' : 'line']))
  // A press on a row that waits for an answer opens (or closes) it; any other row keeps its own press.
  const opens = new Set(items.filter(canAnswer).map(one => one.id))
  return { blocks, states, opens, shownId: shown?.id ?? '', fresh, folded, typingId, isFocusFree: typingId === '', isFoldOpen: state.isFoldOpen }
}
