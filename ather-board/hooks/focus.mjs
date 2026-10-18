// @ts-check
// Ather Board: For you (D8). What the person at the keyboard can act on, before the team's views:
// their intents grouped by what each needs from them, worst first, then the rest of their open work;
// and the suggestions the board can make without a model (the brief adds the model's, brief.mjs).
// Pure: no `$`.

import { isMine } from './ather/model.mjs'
import { nextAction } from './act.mjs'
import { moduleSections } from './map.mjs'
import { DAY_MS, WARNINGS, collisionGroup, recordsFor, rowOf, sectionsOf, sortRecords } from './views.mjs'

/**
 * @typedef {import('./views.mjs').BoardRecord} BoardRecord
 * @typedef {import('./views.mjs').Section} Section
 * @typedef {import('./views.mjs').IntentGroup} IntentGroup
 * @typedef {import('./act.mjs').ActionKind} ActionKind
 * @typedef {{ key: string, title: string, why: string, action: ActionKind | 'show', keys: string[] }} Suggestion
 *   one thing worth doing: `action` over the intents `keys` (`show`: cut the board to them)
 */

// What each of the person's open intents needs from them, in this order; an intent sits in the first that fits.
const NEEDS = /** @type {const} */ ([
  { key: 'decide', title: 'Waiting on your decision', actions: ['decide'] },
  { key: 'close', title: 'Ready for you to close', actions: ['close'] },
  { key: 'stuck', title: 'Stuck', actions: ['reason', 'unstick'] },
  { key: 'tidy', title: 'Needs a checklist or a tidy header', actions: ['checklist', 'tidy'] },
])

/** @param {string} key @param {string} title @param {string} empty @param {readonly BoardRecord[]} list @returns {IntentGroup} */
const group = (key, title, empty, list) => ({ kind: 'intents', key, title, meta: String(list.length), empty, hide: 'owner', rows: list.map(record => rowOf(record, WARNINGS)) })

/**
 * For you as sections: a lime label over what needs the person, then their other open work.
 * `me`: their git name ('' when unknown).
 * @param {readonly BoardRecord[]} records @param {string} me @returns {Section[]}
 */
export const forYou = (records, me) => {
  if (me === '') return [{ kind: 'label', key: 'label-you', title: 'For you', meta: '', isLoud: true, groups: [group('you-none', '', 'Set git user.name in this checkout so the board knows which intents are yours. Triage shows the team’s.', [])] }]
  const mine = sortRecords(records.filter(one => one.stage !== 'done' && isMine(one, me)), 'stale')
  const needs = NEEDS.map(need => ({ need, list: mine.filter(one => need.actions.some(action => action === nextAction(one, true))) })).filter(one => one.list.length > 0)
  const placed = new Set(needs.flatMap(one => one.list.map(record => record.key)))
  const rest = sortRecords(mine.filter(one => !placed.has(one.key)), 'recent')
  // Your work that collides, after your decisions (overlap-check D5).
  const colliding = collisionGroup('you-colliding', mine, '')
  const count = needs.reduce((sum, one) => sum + one.list.length, 0) + (colliding[0]?.pairs.length ?? 0)
  const byNeed = needs.map(({ need, list }) => group(`you-${need.key}`, need.title, '', list))
  const at = needs[0]?.need.key === 'decide' ? 1 : 0
  const groups = [...byNeed.slice(0, at), ...colliding, ...byNeed.slice(at)]
  return [
    { kind: 'label', key: 'label-you', title: 'For you', meta: String(count), isLoud: true, groups: groups.length > 0 ? groups : [group('you-none', '', mine.length > 0 ? 'Nothing of yours needs you now.' : 'You own no open intents. Triage shows the team’s.', [])] },
    ...(rest.length > 0 ? [/** @type {Section} */ ({ kind: 'label', key: 'label-yours', title: 'Your other open work', meta: String(rest.length), isLoud: false, groups: [group('yours', '', '', rest)] })] : []),
  ]
}

// The brief's suggestions, then the board's own that the brief did not already make (the same action on the same intents).
/** @param {readonly Suggestion[]} brief @param {readonly Suggestion[]} plain */
export const mergeSuggestions = (brief, plain) => {
  const said = new Set(brief.map(one => `${one.action}:${[...one.keys].sort().join(',')}`))
  return [...brief, ...plain.filter(one => !said.has(`${one.action}:${[...one.keys].sort().join(',')}`))]
}

/**
 * What the board suggests without a model, most useful first, at most four: close every ready intent of
 * yours at once, answer your oldest decision, tidy your headers, and see the teammates' intents that wait on a decision.
 * @param {readonly BoardRecord[]} records @param {string} me @param {number} now @returns {Suggestion[]}
 */
export const plainSuggestions = (records, me, now) => {
  const open = records.filter(one => one.stage !== 'done')
  const mine = open.filter(one => isMine(one, me))
  const days = (/** @type {BoardRecord} */ one) => Math.max(0, Math.floor((now - one.updatedAt) / DAY_MS))
  const ready = mine.filter(one => one.stage === 'met')
  const [oldest] = sortRecords(mine.filter(one => one.calls.length > 0), 'stale')
  const untidy = mine.filter(one => nextAction(one, true) === 'tidy')
  const waiting = open.filter(one => !isMine(one, me) && one.calls.length > 0)
  /** @type {Suggestion[]} */
  const all = [
    ...(ready.length === 0 ? [] : [{ key: 'close-ready', title: ready.length === 1 ? `Close ${ready[0]?.slug}` : `Close your ${ready.length} ready intents`, why: 'Every acceptance item is met.', action: /** @type {const} */ ('close'), keys: ready.map(one => one.key) }]),
    ...(oldest ? [{ key: 'decide-oldest', title: `Answer ${oldest.calls.length === 1 ? 'the decision' : `the ${oldest.calls.length} decisions`} on ${oldest.slug}`, why: `Waiting ${days(oldest)} ${days(oldest) === 1 ? 'day' : 'days'}; the work cannot go on until then.`, action: /** @type {const} */ ('decide'), keys: [oldest.key] }] : []),
    ...(untidy.length === 0 ? [] : [{ key: 'tidy-mine', title: untidy.length === 1 ? `Fix the header of ${untidy[0]?.slug}` : `Fix the headers of your ${untidy.length} intents`, why: 'The team’s views cannot place them as written.', action: /** @type {const} */ ('tidy'), keys: untidy.map(one => one.key) }]),
    ...(waiting.length === 0 ? [] : [{ key: 'show-waiting', title: `${waiting.length} teammates’ intents wait on a decision`, why: 'Answering, or nudging their owners, unblocks the most work.', action: /** @type {const} */ ('show'), keys: waiting.map(one => one.key) }]),
  ]
  return all.slice(0, 4)
}

/**
 * What each of the pane's views draws besides its sections: the search and the pickers (`filters`), the
 * suggestions (`brief`, For you), and where the module mapping stands (`mapping`, Modules).
 * @typedef {{ filters: boolean, brief: boolean, mapping: boolean }} Extras
 */
/** @type {Extras} */
const PLAIN = { filters: true, brief: false, mapping: false }
/** @type {Partial<Record<import('./views.mjs').View, Extras>>} */
const EXTRAS = { foryou: { filters: false, brief: true, mapping: false }, modules: { filters: true, brief: false, mapping: true } }

/**
 * What a pane view shows: the records it sees, its sections (For you's, the modules', or the shared
 * views'), and its extras. The one place the pane's views are told apart.
 * @param {readonly BoardRecord[]} records @param {import('./views.mjs').Look} look
 * @param {{ me: string, modules: readonly import('./modules.mjs').Module[], mapping: import('./modules.mjs').Mapping, now: number, note?: string }} context
 * `note`: why the overlap check could not run, for Triage
 */
export const paneView = (records, look, { me, modules, mapping, now, note = '' }) => {
  const shown = recordsFor(records, look)
  const parts = look.view === 'foryou' ? forYou(records, me) : look.view === 'modules' ? moduleSections(shown, modules, mapping, look.sort, now) : sectionsOf(shown, look, now, note)
  return { shown, parts, extras: EXTRAS[look.view] ?? PLAIN }
}
