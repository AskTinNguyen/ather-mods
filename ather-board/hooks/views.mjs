// @ts-check
// Ather Board: what every view shows, for the pane and the page alike. The look (view, filter, sort,
// group), the records a view sees, the sections it draws (sectionsOf), and the cuts beneath them:
// filter, sort, group with a rollup per group, triage, the outstanding items and the pulse. The
// pane (pane.mjs) and the page (page/client.js) only draw the sections. Pure: no `$`.
//
// The HTML page runs these same functions in the browser: page.mjs writes each export into the
// page by its source text, and each value as JSON. So every exported function is self-contained: it
// names only other exports of this module, Ather's `ageText`, `miniBarSvg` and `BAR_CELLS` (imported,
// and written into the page too, so both surfaces draw a row's age and bar alike) and the language's
// own globals. The page test runs every one of them as written into the page.

import { BAR_CELLS, STAGE_BLOCKS, STAGE_GLYPHS, ageText, miniBarSvg } from './ather/worklist.mjs'

export { BAR_CELLS, ageText, miniBarSvg }

/**
 * @typedef {'plan' | 'build' | 'prove' | 'met' | 'parked' | 'done'} Stage
 * @typedef {'decisions' | 'colliding' | 'met' | 'stale' | 'unparked' | 'plan' | 'status' | 'owner' | 'area'} FlagKind
 * @typedef {{ kind: FlagKind, label: string }} Flag
 * @typedef {{
 *   key: string, slug: string, title: string, goal: string, area: string, owner: string, stage: Stage,
 *   status: string, statusNote: string, done: number, total: number, openItems: { id: string, text: string }[],
 *   prs: number[], issue: number | null, calls: Call[], updatedAt: number, createdAt: number,
 *   source: 'main' | 'local', flags: Flag[], mentions: string[], branch: string, collisions: Collision[]
 * }} BoardRecord one intent as the board reads it (records.mjs); `calls`: its open findings waiting on a decision;
 *   `mentions`: the other intents its files name; `branch`: its Branch line; `collisions`: the overlaps it is a side of (records.mjs withCollisions)
 * @typedef {{ key: string, slug: string, owner: string, stage: Stage | '', branch: string }} Party one side of a collision: an intent, or the base
 *   branch (`key` '', `slug` the branch's name, `owner` its last author on the files, `stage` '')
 * @typedef {{ key: string, a: Party, b: Party, files: string[], spots: import('./ather/overlap.mjs').Spot[], count: number, at: number }} Collision
 *   two pieces of work that change the same lines (overlap.mjs): the base, when it is a side, is always `a`; `at`: the base's last change to the files (0 for two intents)
 * @typedef {{ id: string, title: string, options: { letter: string, label: string, text: string, isRecommended: boolean }[] }} Call a decision waiting: its options as the finding writes them (model.mjs parseOptions); none for an open question
 * @typedef {{ words: string, area: string, owner: string, stage: string, showDone: boolean, keys: readonly string[] }} Filter '' matches any; `keys`: only these intents (a suggestion's or an answer's), none: any
 * @typedef {'recent' | 'stale' | 'closest' | 'items'} Sort
 * @typedef {'owner' | 'area' | 'stage' | 'none'} Group
 * @typedef {'foryou' | 'triage' | 'board' | 'map' | 'modules' | 'table' | 'items' | 'people' | 'areas' | 'pulse'} View 'foryou': the pane's own (focus.mjs), needing the person's name;
 *   'modules' (the pane) and 'map' (the page): the intents on the game's modules (map.mjs)
 * @typedef {{ view: View, filter: Filter, sort: Sort, group: Group, by: 'area' | 'owner' }} Look what the person picked
 * @typedef {{ count: number, done: number, open: number, parked: number, items: number, calls: number, stale: number, at: number }} Rollup `open`: neither done nor parked; `calls`: decisions waiting
 */

// In the order the board's columns and stage groups run: Ather's list stages (worklist.mjs), with
// Plan before them and Done after.
export const STAGES = [
  { key: 'plan', label: 'Plan', glyph: '○' },
  ...(/** @type {const} */ (['build', 'prove', 'met', 'parked'])).map(key => ({ key, label: STAGE_BLOCKS.find(block => block.key === key)?.title ?? key, glyph: STAGE_GLYPHS[key] })),
  { key: 'done', label: 'Done', glyph: '■' },
]

/** @type {Record<Sort, string>} */
export const SORTS = { recent: 'Recent', stale: 'Stalest first', closest: 'Closest to done', items: 'Most open items' }
/** @type {Record<Group, string>} */
export const GROUPS = { owner: 'Owner', area: 'Area', stage: 'Stage', none: 'No groups' }
// In the order a press cycles them.
export const SORT_KEYS = /** @type {const} */ (['recent', 'stale', 'closest', 'items'])
export const GROUP_KEYS = /** @type {const} */ (['owner', 'area', 'stage', 'none'])

export const DAY_MS = 86400000
// Open with no commit for this long: stale.
export const STALE_DAYS = 5

// What needs someone, worst first: Triage groups its intents by the worst of these they have, under
// these titles. Then the flags of data hygiene, listed apart.
export const REASONS = /** @type {const} */ ([
  { kind: 'decisions', title: 'Decisions waiting' },
  { kind: 'met', title: 'Ready to close' },
  { kind: 'stale', title: `No change for ${STALE_DAYS} days or more` },
  { kind: 'unparked', title: 'Parked without a reason' },
  { kind: 'plan', title: 'No acceptance checklist' },
])
export const HYGIENE = /** @type {readonly FlagKind[]} */ (['status', 'owner', 'area'])
export const FLAG_ORDER = [...REASONS.map(reason => reason.kind), ...HYGIENE]
// The warnings a row carries: what needs someone, less ready to close and no checklist, which the row's
// stage glyph (✓, ○), or its column, already says.
export const WARNINGS = /** @type {readonly FlagKind[]} */ (['decisions', 'colliding', 'stale', 'unparked'])

export const VIEW_LABELS = /** @type {const} */ ({ foryou: 'For you', triage: 'Triage', board: 'Board', map: 'Map', modules: 'Modules', table: 'Table', items: 'Open items', people: 'People', areas: 'Areas', pulse: 'Pulse' })
// The pane's views, in its tab order; the page has its own (page/client.js), adding Board, Map and Pulse.
export const PANE_VIEWS = /** @type {const} */ (['foryou', 'triage', 'modules', 'table', 'items', 'people', 'areas'])
// The views that hide done intents unless they are shown; the rest count every intent (Open items lists none of theirs).
export const HIDES_DONE = /** @type {readonly View[]} */ (['board', 'table'])

/** @type {Filter} */
export const NO_FILTER = { words: '', area: '', owner: '', stage: '', showDone: false, keys: [] }

/** @type {Look} */
export const DEFAULT_LOOK = { view: 'triage', filter: NO_FILTER, sort: 'recent', group: 'owner', by: 'area' }

// The words typed match when each starts a word of the intent's key, title, goal, area or owner.
/** @param {BoardRecord} record @param {Filter} filter */
export const matches = (record, filter) => {
  if (!filter.showDone && record.stage === 'done' && filter.stage !== 'done') return false
  if (filter.area && record.area !== filter.area) return false
  if (filter.owner && record.owner !== filter.owner) return false
  if (filter.stage && record.stage !== filter.stage) return false
  if (filter.keys.length > 0 && !filter.keys.includes(record.key)) return false
  const words = filter.words.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.length === 0) return true
  const hay = `${record.key} ${record.title} ${record.goal} ${record.area} ${record.owner}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)
  return words.every(word => hay.some(part => part.startsWith(word)))
}

/** @param {readonly BoardRecord[]} records @param {Filter} filter */
export const filterRecords = (records, filter) => records.filter(record => matches(record, filter))

// Recent: last change first. Stalest: open work longest untouched first, done last. Closest to done: the
// share of the checklist met, then the fewest items left. Most open items: the longest list left.
/** @param {readonly BoardRecord[]} records @param {Sort} sort */
export const sortRecords = (records, sort) => {
  const left = (/** @type {BoardRecord} */ one) => one.total - one.done
  const share = (/** @type {BoardRecord} */ one) => (one.total > 0 ? one.done / one.total : -1)
  /** @type {Record<Sort, (a: BoardRecord, b: BoardRecord) => number>} */
  const by = {
    recent: (a, b) => b.updatedAt - a.updatedAt,
    stale: (a, b) => Number(a.stage === 'done') - Number(b.stage === 'done') || a.updatedAt - b.updatedAt,
    closest: (a, b) => share(b) - share(a) || left(a) - left(b) || b.updatedAt - a.updatedAt,
    items: (a, b) => left(b) - left(a) || b.updatedAt - a.updatedAt,
  }
  return [...records].sort(by[sort] ?? by.recent)
}

/** @param {readonly BoardRecord[]} records @returns {Rollup} */
export const rollup = records => ({
  count: records.length,
  done: records.filter(one => one.stage === 'done').length,
  open: records.filter(one => one.stage !== 'done' && one.stage !== 'parked').length,
  parked: records.filter(one => one.stage === 'parked').length,
  items: records.reduce((sum, one) => sum + (one.stage === 'done' ? 0 : one.openItems.length), 0),
  calls: records.reduce((sum, one) => sum + one.calls.length, 0),
  stale: records.filter(one => one.flags.some(flag => flag.kind === 'stale')).length,
  at: records.reduce((latest, one) => Math.max(latest, one.updatedAt), 0),
})

// "4 intents · 3 done · 6 open items · 2d": a group in one line.
/** @param {Rollup} sum @param {number} now */
export const rollupText = (sum, now) =>
  [`${sum.count} ${sum.count === 1 ? 'intent' : 'intents'}`, sum.done ? `${sum.done} done` : '', sum.items ? `${sum.items} open ${sum.items === 1 ? 'item' : 'items'}` : '', ageText(sum.at, now)].filter(Boolean).join(' · ')

/**
 * The records in groups, each sorted as asked and with its rollup. Stages run in board order; owners
 * and areas with the most open work first, then by name. `none`: one group holding everything.
 * @param {readonly BoardRecord[]} records @param {Group} group @param {Sort} sort
 * @returns {{ key: string, title: string, records: BoardRecord[], rollup: Rollup }[]}
 */
export const groupRecords = (records, group, sort) => {
  /** @type {(one: BoardRecord) => string} */
  const keyOf = group === 'owner' ? one => one.owner || 'No owner' : group === 'area' ? one => one.area : group === 'stage' ? one => one.stage : () => ''
  /** @type {Map<string, BoardRecord[]>} */
  const buckets = new Map()
  for (const one of records) buckets.set(keyOf(one), [...(buckets.get(keyOf(one)) ?? []), one])
  const groups = [...buckets].map(([key, list]) => ({ key, title: group === 'stage' ? (STAGES.find(stage => stage.key === key)?.label ?? key) : key, records: sortRecords(list, sort), rollup: rollup(list) }))
  const stageAt = (/** @type {string} */ key) => STAGES.findIndex(stage => stage.key === key)
  return groups.sort((a, b) => (group === 'stage' ? stageAt(a.key) - stageAt(b.key) : b.rollup.open - a.rollup.open || a.title.localeCompare(b.title)))
}

/** @param {BoardRecord} record */
export const worstFlag = record => Math.min(...record.flags.map(flag => FLAG_ORDER.indexOf(flag.kind)).filter(at => at >= 0), FLAG_ORDER.length)

/**
 * What needs someone, team-wide: open intents with a reason's flag, worst first, then the longest untouched.
 * Colliding is drawn by pairs instead (collisionGroup). `hygiene`: intents whose files the board could not fully read as written.
 * @param {readonly BoardRecord[]} records
 */
export const triage = records => {
  const isHygiene = (/** @type {Flag} */ flag) => HYGIENE.some(kind => kind === flag.kind)
  const attention = records
    .filter(one => one.stage !== 'done' && one.flags.some(flag => REASONS.some(reason => reason.kind === flag.kind)))
    .sort((a, b) => worstFlag(a) - worstFlag(b) || a.updatedAt - b.updatedAt)
  const hygiene = records.filter(one => one.flags.some(isHygiene)).sort((a, b) => b.updatedAt - a.updatedAt)
  return { attention, hygiene }
}

/**
 * Every acceptance item not yet met, of every intent not done, grouped by area or owner, the group with
 * the most items first. Parked intents' items count too: they are still owed.
 * @param {readonly BoardRecord[]} records @param {'area' | 'owner'} by
 * @returns {{ title: string, count: number, intents: { record: BoardRecord, items: { id: string, text: string }[] }[] }[]}
 */
export const outstanding = (records, by) => {
  /** @type {Map<string, { record: BoardRecord, items: { id: string, text: string }[] }[]>} */
  const groups = new Map()
  for (const record of records) {
    if (record.stage === 'done' || record.openItems.length === 0) continue
    const key = by === 'owner' ? record.owner || 'No owner' : record.area
    groups.set(key, [...(groups.get(key) ?? []), { record, items: record.openItems }])
  }
  return [...groups]
    .map(([title, intents]) => ({ title, count: intents.reduce((sum, one) => sum + one.items.length, 0), intents: intents.sort((a, b) => b.items.length - a.items.length) }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
}

/**
 * The last `weeks` weeks (Monday to Sunday, UTC), oldest first: intents opened (their folder's first
 * commit) and closed (done, dated by their last commit), and how many there are in each stage now.
 * @param {readonly BoardRecord[]} records @param {number} now @param {number} [weeks]
 */
export const pulse = (records, now, weeks = 8) => {
  const today = Math.floor(now / DAY_MS) * DAY_MS
  // 1970-01-01 was a Thursday: day 4 of a week that starts on Monday is 3 days in.
  const monday = today - (((Math.floor(today / DAY_MS) + 3) % 7) * DAY_MS)
  const starts = Array.from({ length: weeks }, (_, index) => monday - (weeks - 1 - index) * 7 * DAY_MS)
  const weekOf = (/** @type {number} */ at) => starts.findIndex(start => at >= start && at < start + 7 * DAY_MS)
  const rows = starts.map(start => ({ start, opened: 0, closed: 0 }))
  for (const one of records) {
    const opened = rows[weekOf(one.createdAt)]
    if (opened) opened.opened += 1
    const closed = one.stage === 'done' ? rows[weekOf(one.updatedAt)] : undefined
    if (closed) closed.closed += 1
  }
  const stages = STAGES.map(stage => ({ key: stage.key, label: stage.label, count: records.filter(one => one.stage === stage.key).length }))
  return { weeks: rows, stages }
}

// "142 intents · 78 open · 9 parked · 55 done · this week 5 opened, 3 closed".
/** @param {readonly BoardRecord[]} records @param {number} now */
export const summaryText = (records, now) => {
  const { weeks, stages } = pulse(records, now, 1)
  const count = (/** @type {string} */ key) => stages.find(stage => stage.key === key)?.count ?? 0
  const week = weeks[0] ?? { opened: 0, closed: 0 }
  const open = records.length - count('done') - count('parked')
  return `${records.length} intents · ${open} open · ${count('parked')} parked · ${count('done')} done · this week ${week.opened} opened, ${week.closed} closed`
}

// The areas and owners present, for the filter pickers: by name.
/** @param {readonly BoardRecord[]} records */
export const choices = records => ({
  areas: [...new Set(records.map(one => one.area))].sort((a, b) => a.localeCompare(b)),
  owners: [...new Set(records.map(one => one.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
})

// The collisions among the records shown, each once, those with the most places first.
/** @param {readonly BoardRecord[]} records @returns {Collision[]} */
export const collisionsOf = records => {
  /** @type {Map<string, Collision>} */
  const seen = new Map()
  for (const one of records) for (const collision of one.collisions) seen.set(collision.key, collision)
  return [...seen.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

// ---------------------------------------------------------------- what a view shows

// One intent as a row: the flags among `kinds` it warns with, and no items under it.
/** @param {BoardRecord} record @param {readonly string[]} kinds @returns {Row} */
export const rowOf = (record, kinds) => ({ record, flags: record.flags.filter(flag => kinds.includes(flag.kind)), items: [] })

// A person or an area picked from People or Areas: the table of their intents, the other filters cleared.
/** @param {Look} look @param {'owner' | 'area'} by @param {string} value @returns {Look} */
export const pickLook = (look, by, value) => ({ ...look, view: 'table', filter: { ...NO_FILTER, showDone: look.filter.showDone, [by]: value } })

// The records a view sees: the filters always, done intents only where the view hides them unless shown.
/** @param {readonly BoardRecord[]} records @param {Look} look */
export const recordsFor = (records, look) => filterRecords(records, HIDES_DONE.includes(look.view) ? look.filter : { ...look.filter, showDone: true })

// A person's or an area's line: what is in hand, and what needs someone, apart.
/** @param {Rollup} sum @param {number} now */
export const rollupLine = (sum, now) => ({
  words: [`${sum.open} open`, sum.parked ? `${sum.parked} parked` : '', sum.done ? `${sum.done} done` : '', sum.items ? `${sum.items} items` : '', ageText(sum.at, now)].filter(Boolean).join(' · '),
  warn: [sum.calls ? `${sum.calls} ${sum.calls === 1 ? 'decision' : 'decisions'}` : '', sum.stale ? `${sum.stale} stale` : ''].filter(Boolean).join(' · '),
})

/**
 * What a view shows, in two levels: a `label` is a top-level heading over its groups (spaced-out capitals;
 * `isLoud`: what needs someone, Ather's one lime); a group of `intents` is its rows under its title (bold)
 * and `meta` (its rollup), with no head when the title is ''; `lines` is People's or Areas' table.
 * A row: the flags it warns with, the items listed under it (Open items), and the column a group of one
 * owner or one area leaves out (`hide`, on the group).
 * @typedef {{ record: BoardRecord, flags: Flag[], items: { id: string, text: string }[] }} Row
 * @typedef {{ key: string, title: string, rollup: Rollup, words: string, warn: string }} Line
 * @typedef {{ kind: 'intents', key: string, title: string, meta: string, empty: string, hide: '' | 'owner' | 'area', rows: Row[] }} IntentGroup
 * @typedef {{ kind: 'pairs', key: string, title: string, meta: string, empty: string, pairs: Collision[] }} PairGroup the collisions, one row a pair
 * @typedef {{ kind: 'label', key: string, title: string, meta: string, isLoud: boolean, groups: (IntentGroup | PairGroup)[] }
 *   | IntentGroup
 *   | { kind: 'lines', key: string, by: 'owner' | 'area', lines: Line[] }} Section
 */

// Colliding (overlap-check D5): one row a pair; `note` says why nothing could be checked (old git), shown in its place.
/** @param {string} key @param {readonly BoardRecord[]} records @param {string} note @returns {PairGroup[]} */
export const collisionGroup = (key, records, note) => {
  const pairs = collisionsOf(records)
  return pairs.length > 0 || note ? [{ kind: 'pairs', key, title: 'Colliding', meta: pairs.length > 0 ? String(pairs.length) : '', empty: note, pairs }] : []
}

/**
 * What a view shows, as sections both surfaces draw; [] for Pulse (the page's own chart). `records`: recordsFor's.
 * Board: a group per stage that has intents, in board order. `note`: why overlaps could not be checked ('' when they were).
 * @param {readonly BoardRecord[]} records @param {Look} look @param {number} now @param {string} [note] @returns {Section[]}
 */
export const sectionsOf = (records, look, now, note = '') => {
  const row = rowOf
  /** @param {string} key @param {string} title @param {string} meta @param {string} empty @param {Row[]} rows @param {'' | 'owner' | 'area'} [hide] @returns {IntentGroup} */
  const intents = (key, title, meta, empty, rows, hide = '') => ({ kind: 'intents', key, title, meta, empty, hide, rows })
  const none = (/** @type {string} */ empty) => [intents('none', '', '', empty, [])]
  const view = look.view
  if (view === 'triage') {
    const { attention, hygiene } = triage(records)
    const reasons = REASONS.map(reason => ({ ...reason, list: attention.filter(one => FLAG_ORDER[worstFlag(one)] === reason.kind) })).filter(reason => reason.list.length > 0)
    // A reason's rows leave out the warning its title says; how many decisions wait is each row's own.
    const byReason = reasons.map(reason => intents(`attention-${reason.kind}`, reason.title, String(reason.list.length), '', reason.list.map(one => row(one, WARNINGS.filter(kind => kind !== reason.kind || kind === 'decisions')))))
    // Colliding comes second, after the decisions (D5).
    const at = byReason[0]?.key === 'attention-decisions' ? 1 : 0
    const groups = [...byReason.slice(0, at), ...collisionGroup('attention-colliding', records, note), ...byReason.slice(at)]
    return [
      { kind: 'label', key: 'label-attention', title: 'Needs someone', meta: String(attention.length + collisionsOf(records).length), isLoud: true, groups: groups.length > 0 ? groups : none('Nothing is stuck.') },
      { kind: 'label', key: 'label-hygiene', title: 'Data hygiene', meta: `${hygiene.length} not fully readable`, isLoud: false, groups: [intents('hygiene', '', '', 'Every intent reads cleanly.', hygiene.map(one => row(one, HYGIENE)))] },
    ]
  }
  if (view === 'board') {
    const columns = STAGES.map(stage => ({ stage, list: sortRecords(records.filter(one => one.stage === stage.key), look.sort) })).filter(column => column.list.length > 0)
    return columns.length > 0 ? columns.map(({ stage, list }) => intents(stage.key, `${stage.glyph} ${stage.label}`, String(list.length), '', list.map(one => row(one, WARNINGS)))) : none('No intent matches.')
  }
  if (view === 'table') {
    if (records.length === 0) return none('No intent matches.')
    const hide = look.group === 'owner' || look.group === 'area' ? look.group : ''
    return groupRecords(records, look.group, look.sort).map(group => intents(`group-${group.key || 'all'}`, group.title, rollupText(group.rollup, now), '', group.records.map(one => row(one, WARNINGS)), hide))
  }
  if (view === 'items') {
    const groups = outstanding(records, look.by)
    if (groups.length === 0) return none('No open acceptance items.')
    return groups.map(group => intents(`items-${group.title}`, group.title, `${group.count} open ${group.count === 1 ? 'item' : 'items'}`, '', group.intents.map(one => ({ ...row(one.record, []), items: one.items })), look.by))
  }
  if (view === 'people' || view === 'areas') {
    const by = view === 'people' ? 'owner' : 'area'
    return [{ kind: 'lines', key: `lines-${by}`, by, lines: groupRecords(records, by, 'recent').map(group => ({ key: group.key, title: group.title, rollup: group.rollup, ...rollupLine(group.rollup, now) })) }]
  }
  return []
}
