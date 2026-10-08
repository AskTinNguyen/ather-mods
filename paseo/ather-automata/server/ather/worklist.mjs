// Ather Automata: how the work list reads. Every row one anatomy (stage glyph, title,
// progress bar and count, age, owner), three sorts, the stage blocks, owner names
// tidied for display, and what needs each person's attention (D4-D7). Pure: no `$`.

import { isAllMet, isMine, isReadyToClose } from './model.mjs'

/** @typedef {import('./model.mjs').Intent} Intent */

// ---------------------------------------------------------------- stages and sorts

/** @typedef {'met' | 'prove' | 'build' | 'parked'} ListStage */

// Where an intent stands in the list: the tracked header's stages (currentStage) without a session's
// proof, which only the session that ran it has. Building while an item is open; proving once every
// item is met and its PRs are not all merged; ready to close once they are (or it names none).
/** @param {Intent} intent @param {import('./model.mjs').PrStates} [prs] @returns {ListStage} */
export const listStage = (intent, prs = {}) =>
  intent.status === 'parked' ? 'parked' : !isAllMet(intent) ? 'build' : intent.prs.length === 0 || isReadyToClose(intent, prs) ? 'met' : 'prove'

export const STAGE_GLYPHS = /** @type {const} */ ({ build: '●', prove: '◐', met: '✓', parked: '‖' })

// The blocks "Ready to close" groups the list in, in order.
export const STAGE_BLOCKS = /** @type {const} */ ([
  { key: 'met', title: 'Ready to close' },
  { key: 'prove', title: 'Proving' },
  { key: 'build', title: 'Building' },
  { key: 'parked', title: 'Parked' },
])

export const LEGEND = '● Building  ◐ Items met, PR not merged  ✓ Ready to close  ‖ Parked'

export const SORTS = /** @type {const} */ (['recent', 'close', 'oldest'])
/** @typedef {typeof SORTS[number]} Sort */
export const SORT_LABELS = { recent: 'Recent', close: 'Ready to close', oldest: 'Oldest' }

/** @param {Sort} sort @returns {Sort} */
export const nextSort = sort => SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length] ?? 'recent'

/** @typedef {{ updatedAt: number, stage?: ListStage | '' }} Sortable */

// The list in the sort's order: newest first, oldest first, or by stage block and then newest.
// An item with no known date sorts as the oldest.
/** @template {Sortable} T @param {readonly T[]} list @param {Sort} sort @returns {T[]} */
export const sortWork = (list, sort) => {
  const block = (/** @type {T} */ one) => {
    const at = STAGE_BLOCKS.findIndex(each => each.key === one.stage)
    return at < 0 ? STAGE_BLOCKS.length : at
  }
  return [...list].sort((a, b) => (sort === 'oldest' ? a.updatedAt - b.updatedAt : (sort === 'close' ? block(a) - block(b) : 0) || b.updatedAt - a.updatedAt))
}

// The list cut into its stage blocks, each with its items in order; empty blocks are left out.
// Anything without a stage (an issue) comes last, untitled.
/** @template {Sortable} T @param {readonly T[]} list @returns {{ key: string, title: string, items: T[] }[]} */
export const stageBlocks = list => {
  const sorted = sortWork(list, 'close')
  return [...STAGE_BLOCKS.map(({ key, title }) => ({ key, title, items: sorted.filter(one => one.stage === key) })), { key: 'other', title: '', items: sorted.filter(one => !one.stage) }].filter(block => block.items.length > 0)
}

// ---------------------------------------------------------------- grouping a long list (D7, D8)

// How Everything open sub-groups the teammates' intents: by person, by area, by stage, or not at all.
export const GROUP_BYS = /** @type {const} */ (['person', 'area', 'stage', 'none'])
/** @typedef {typeof GROUP_BYS[number]} GroupBy */
export const GROUP_LABELS = { person: 'Person', area: 'Area', stage: 'Stage', none: 'None' }

/** @param {GroupBy} by @returns {GroupBy} */
export const nextGroup = by => GROUP_BYS[(GROUP_BYS.indexOf(by) + 1) % GROUP_BYS.length] ?? 'person'

// A stored choice read back: anything else is the default, Person.
/** @param {unknown} value @returns {GroupBy} */
export const groupByOf = value => (GROUP_BYS.includes(/** @type {GroupBy} */ (value)) ? /** @type {GroupBy} */ (value) : 'person')

// A sub-group larger than this starts folded.
export const FOLD_OVER = 6

/** @typedef {{ stage?: ListStage | '', who?: string, area?: string }} Groupable */

// The list cut into sub-groups, each titled, in a fixed order: people by name (no owner last); areas in the
// pack's order (`areas`), then any other by name, Unsorted last; stages as the stage blocks are. Each keeps the
// list's order. Grouped by none: one untitled group.
/** @template {Groupable} T @param {readonly T[]} list @param {GroupBy} by @param {readonly string[]} [areas] @returns {{ key: string, title: string, items: T[] }[]} */
export const subGroups = (list, by, areas = []) => {
  if (by === 'none') return list.length > 0 ? [{ key: 'all', title: '', items: [...list] }] : []
  const NO_OWNER = 'No owner'
  /** @param {T} one */
  const titleOf = one => (by === 'person' ? one.who || NO_OWNER : by === 'area' ? one.area || 'Unsorted' : (STAGE_BLOCKS.find(block => block.key === one.stage)?.title ?? 'Other'))
  const titles = [...new Set(list.map(titleOf))]
  /** @param {string} title */
  const rank = title => {
    if (by === 'stage') return STAGE_BLOCKS.findIndex(block => block.title === title) >>> 0
    if (by === 'area') return title === 'Unsorted' ? 2 * areas.length + 1 : areas.indexOf(title) >= 0 ? areas.indexOf(title) : areas.length
    return title === NO_OWNER ? 1 : 0
  }
  titles.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return titles.map(title => ({ key: title, title, items: list.filter(one => titleOf(one) === title) }))
}

// Parked intents leave the list for a folded block at its end (D8).
/** @template {Groupable} T @param {readonly T[]} list @returns {{ open: T[], parked: T[] }} */
export const splitParked = list => ({ open: list.filter(one => one.stage !== 'parked'), parked: list.filter(one => one.stage === 'parked') })

// A head's count: "5", or "2 of 5" while a search narrows the list (D9).
/** @param {number} shown @param {number} total @param {boolean} isSearching */
export const countText = (shown, total, isSearching) => (isSearching ? `${shown} of ${total}` : String(shown))

/**
 * One block of a group in Everything open: `kind` 'sub' (a foldable sub-head: a person, area or stage, or Parked),
 * 'stage' (a bold stage title, sorted for closing), 'plain' (rows only). `total`: the block's size in the whole
 * list, for "x of y"; `foldKey`: what a press on its head toggles.
 * @template T @typedef {{ key: string, title: string, items: T[], total: number, kind: 'sub' | 'stage' | 'plain', startsFolded: boolean, foldKey: string }} Block
 */

export const PARKED_KEY = '‖parked'

/**
 * A group's blocks, in the order drawn (D7-D9): the teammates' intents by `groupBy` (a sub-group larger than
 * FOLD_OVER starts folded), anything else in stage blocks when sorted for closing, or as one plain block; then
 * the parked intents, a folded block at the end. While searching nothing starts folded, so every match shows.
 * `list`: the group's items the search kept; `all`: the group's items before the search.
 * @template {Groupable & Sortable} T
 * @param {'mine' | 'issues' | 'others'} group @param {readonly T[]} list @param {readonly T[]} all
 * @param {{ sort: Sort, groupBy: GroupBy, areas?: readonly string[], isSearching: boolean }} how
 * @returns {Block<T>[]}
 */
export const blocksOf = (group, list, all, { sort, groupBy, areas = [], isSearching }) => {
  const by = group === 'others' ? groupBy : 'none'
  const mode = by !== 'none' ? 'sub' : group !== 'issues' && sort === 'close' ? 'stage' : 'plain'
  const subKey = (/** @type {T} */ one) => subGroups([one], by, areas)[0]?.key ?? ''
  /** @param {T} one */
  const keyOf = one => (one.stage === 'parked' ? PARKED_KEY : mode === 'sub' ? subKey(one) : mode === 'stage' ? one.stage || 'other' : 'all')
  /** @type {Map<string, number>} */
  const totals = new Map()
  for (const one of all) totals.set(keyOf(one), (totals.get(keyOf(one)) ?? 0) + 1)
  const { open, parked } = splitParked(sortWork(list, sort))
  const raw = mode === 'sub' ? subGroups(open, by, areas) : mode === 'stage' ? stageBlocks(open) : open.length > 0 ? [{ key: 'all', title: '', items: open }] : []
  /** @type {Block<T>[]} */
  const blocks = raw.map(block => {
    const total = totals.get(block.key) ?? block.items.length
    return { ...block, total, kind: mode, startsFolded: mode === 'sub' && !isSearching && total > FOLD_OVER, foldKey: `${group}:${by}:${block.key}` }
  })
  if (parked.length > 0) blocks.push({ key: PARKED_KEY, title: '‖ Parked', items: parked, total: totals.get(PARKED_KEY) ?? parked.length, kind: 'sub', startsFolded: !isSearching, foldKey: `${group}:parked` })
  return blocks
}

// ---------------------------------------------------------------- what needs the person

// Parked, and nobody said why: its row warns, and its owner is asked to add one.
/** @param {{ status: string, statusNote: string }} intent */
export const isParkedBare = intent => intent.status === 'parked' && !intent.statusNote

/** @typedef {{ id: string, slug: string, kind: 'close' | 'reason', title: string, ask: string }} Attention */

// The person's own open intents that want a press: every item met ("Close it?"), or parked with no reason given.
/** @param {readonly Intent[]} intents @param {string} me @param {import('./model.mjs').PrStates} [prs] @returns {Attention[]} */
export const needsAttention = (intents, me, prs = {}) =>
  intents
    .filter(one => one.status !== 'completed' && isMine(one, me))
    .flatMap(one => {
      /** @type {Attention[]} */
      const wants = isParkedBare(one)
        ? [{ id: `attention:${one.slug}`, slug: one.slug, kind: 'reason', title: `${one.slug} · parked, no reason`, ask: 'Add one?' }]
        : listStage(one, prs) === 'met' ? [{ id: `attention:${one.slug}`, slug: one.slug, kind: 'close', title: `${one.slug} · ready to close`, ask: 'Close it?' }] : []
      return wants
    })

// ---------------------------------------------------------------- people

/**
 * A studio's rules for reading its git names (the pack's `names`): words at the end that say the role
 * or the studio (`suffix`), the studio's name glued to the end of one lower-case word (`studio`), and
 * the family names that end such a word (`families`, "trucnguyen").
 * @typedef {{ suffix: RegExp, studio: RegExp, families: readonly string[] }} NameRules
 */

// Without a studio's rules a name is only split and capitalised.
const PLAIN_NAMES = /** @type {NameRules} */ ({ suffix: /^$/, studio: /^$/, families: [] })

/** @param {string} word */
const capital = word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

// A git name as a person's name, by the studio's rules: "LamPhung-Art" → "Lam Phung", "trucnguyen" →
// "Truc Nguyen", "DuyTranSipher" → "Duy Tran", "KhoaLe (Game Engineer)" → "Khoa Le". A plain name stays as it is.
/** @param {string} name @param {NameRules} [rules] */
export const tidyName = (name, rules = PLAIN_NAMES) => {
  const words = name
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/)
    .filter(Boolean)
  const cut = words.findIndex((word, index) => index > 0 && (rules.suffix.test(word) || /^[A-Z]{2,}/.test(word)))
  let kept = cut < 0 ? words : words.slice(0, cut)
  // One lower-case run: the studio's name off its end, then split before a family name.
  const [only] = kept
  if (kept.length === 1 && only && /^[A-Za-z][a-z]+$/.test(only)) {
    const bare = only.replace(rules.studio, '') || only
    const family = rules.families.find(one => bare.toLowerCase().endsWith(one) && bare.length - one.length >= 3)
    kept = family ? [bare.slice(0, bare.length - family.length), family] : [bare]
  }
  return kept.length > 0 ? kept.map(capital).join(' ') : name.trim()
}

// Who an intent belongs to, for display: a known team with its lead ("Tien Dang · Cinematic"),
// a git name tidied, or, with no Owner line, whoever first committed its folder. `people`: the
// pack's teams and name rules.
/** @param {string} owner @param {string} firstAuthor @param {{ teams?: Readonly<Record<string, string>>, names?: NameRules }} [people] */
export const ownerName = (owner, firstAuthor, { teams = {}, names } = {}) => {
  const name = owner.trim() || firstAuthor.trim()
  const team = Object.keys(teams).find(one => one.toLowerCase() === name.toLowerCase())
  if (team) return `${teams[team]} · ${team}`
  return name ? tidyName(name, names) : ''
}

// ---------------------------------------------------------------- one row anatomy

// "3h", "12d": how long since an item last changed; '' when nobody knows.
/** @param {number} at @param {number} now */
export const ageText = (at, now) => {
  if (!at) return ''
  const minutes = Math.max(0, Math.floor((now - at) / 60000))
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
}

export const BAR_CELLS = 5

// "▰▰▱▱▱": how much of a checklist is met, in five cells; blank without a checklist.
/** @param {number} done @param {number} total */
// The same bar for the desktop as an SVG: five cells in exact pixels, where text glyphs take the
// font's widths and spill into the next column. `colour` fills the lit cells and outlines the rest.
/** @param {number} done @param {number} total @param {string} colour */
export const miniBarSvg = (done, total, colour) => {
  const lit = total > 0 ? Math.round((Math.min(done, total) / total) * BAR_CELLS) : 0
  const cells = Array.from({ length: BAR_CELLS }, (_, index) =>
    index < lit ? `<rect x="${index * 10 + 0.5}" y="0.5" width="8" height="8" rx="1.5" fill="${colour}"/>` : `<rect x="${index * 10 + 1}" y="1" width="7" height="7" rx="1.5" fill="none" stroke="${colour}" stroke-opacity="0.55"/>`,
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BAR_CELLS * 10} 9" width="${BAR_CELLS * 10}" height="9">${total > 0 ? cells.join('') : ''}</svg>`
}

export const miniBar = (done, total) => {
  if (total <= 0) return ' '.repeat(BAR_CELLS)
  const lit = Math.round((Math.min(done, total) / total) * BAR_CELLS)
  return `${'▰'.repeat(lit)}${'▱'.repeat(BAR_CELLS - lit)}`
}

/** @typedef {{ glyph: string, title: string, warn: string, bar: string, count: string, age: string, owner: string }} RowCells */

// Each row's cells, and the widths of the right-hand columns shared by every row in the list,
// so they line up: count, age and owner as wide as their widest (the owner at most `ownerMax`).
/** @param {readonly RowCells[]} rows @param {number} ownerMax */
export const rowColumns = (rows, ownerMax) => ({
  count: Math.max(0, ...rows.map(one => one.count.length)),
  age: Math.max(0, ...rows.map(one => one.age.length)),
  owner: Math.min(ownerMax, Math.max(0, ...rows.map(one => one.owner.length))),
})

/**
 * @typedef {{ kind: 'intent' | 'issue', label: string, stage: ListStage | '', updatedAt: number, isMine: boolean, done?: number, total?: number, who?: string, warn?: string, source?: string }} RowWork
 */

// A work row's cells: an intent's stage glyph, its warning and `local` tag (when main was read, `isTagged`),
// its checklist, age and owner (blank for the person's own); an issue's title and age.
/** @param {RowWork} one @param {number} now @param {boolean} isTagged @returns {RowCells} */
export const rowCells = (one, now, isTagged) => ({
  glyph: one.stage ? STAGE_GLYPHS[one.stage] : '',
  title: one.label,
  warn: [one.warn ? `⚠ ${one.warn}` : '', isTagged && one.source === 'local' ? 'local' : ''].filter(Boolean).join(' · '),
  bar: miniBar(one.done ?? 0, one.total ?? 0),
  count: one.total ? `${one.done ?? 0}/${one.total}` : '',
  age: ageText(one.updatedAt, now),
  owner: one.isMine ? '' : (one.who ?? ''),
})

// The cells of every row a view shows, by id, and the right-hand column widths they share so the
// columns line up; a narrow pane (under 90 columns) gives the owner at most 12.
/** @template {RowWork & { id: string }} T @param {readonly T[]} list @param {number} now @param {boolean} isTagged @param {number} width */
export const listCells = (list, now, isTagged, width) => {
  const cells = new Map(list.map(one => [one.id, rowCells(one, now, isTagged)]))
  return { cells, cols: rowColumns([...cells.values()], width < 90 ? 12 : 22) }
}

// Needs you, one block per intent: each intent's decisions together, in the order they came; anything else on its own.
/** @template {{ kind: string, slug?: string }} T @param {readonly T[]} items @returns {{ slug: string, items: T[] }[]} */
export const callBlocks = items => {
  /** @type {{ slug: string, items: T[] }[]} */
  const blocks = []
  for (const one of items) {
    const slug = one.kind === 'call' ? (one.slug ?? '') : ''
    const block = slug ? blocks.find(each => each.slug === slug) : undefined
    if (block) block.items.push(one)
    else blocks.push({ slug, items: [one] })
  }
  return blocks
}
