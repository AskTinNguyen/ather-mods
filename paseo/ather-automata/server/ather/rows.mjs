// Ather Automata: the pane's look, and the lists it draws (Needs you, Everything open, Home's
// preview), built with the elements the pane is handed (`el`). Pure: no `$`; every press
// arrives as a closure from console.mjs.

import { WORK_GROUPS, workGroup } from './home.mjs'
import { BAR_CELLS, LEGEND, callBlocks, listCells, miniBarSvg, sortWork, stageBlocks } from './worklist.mjs'

/** @typedef {import('./worklist.mjs').RowCells} RowCells */
/** @typedef {ReturnType<typeof import('./worklist.mjs').rowColumns>} Columns */
/** @typedef {import('./home.mjs').Work} Work */
/** @typedef {import('./home.mjs').Item} Item */

// Ather's look: near-black, one lime accent kept for what needs the person (Needs you, Needs attention,
// Next), light ink for headings and progress, quiet grey for everything secondary.
export const LIME = '#DDFF00'
export const INK = '#C9CCCC'
export const QUIET = '#8E918A'
// A notice that is not a fault: the Editor held, another session on the same intent.
export const AMBER = '#f2a516'
// Each source of work has its colour.
export const GROUP_COLOURS = { mine: INK, issues: AMBER, others: '#3ccf7a' }
// Home's work rows take letters; they skip f (sync) and i (Everything open).
const PICK_KEYS = 'abcdeghjkl'

/** @param {string} text @param {number} width */
export const fit = (text, width) => {
  const clean = text.replace(/[\r\n\t]+/g, ' ')
  return clean.length <= width ? clean : `${clean.slice(0, Math.max(1, width - 1))}…`
}

// A top-level section label, spaced out as the studio's are ("N E E D S   Y O U"), plain when too wide.
/** @param {any} el @param {string} key @param {string} text @param {number} width @param {string} [colour] */
export const label = (el, key, text, width, colour = INK) => {
  const spaced = text.toUpperCase().split('').join(' ')
  return el.Text({ key, color: colour, bold: true, children: spaced.length <= width ? spaced : fit(text.toUpperCase(), width) })
}

/** @param {any} el @param {string} key @param {any[]} children */
export const section = (el, key, children) => el.Box({ key, flexDirection: 'column', width: '100%', marginTop: 1, children })

/**
 * @typedef {{ key: string, hotkey?: string, title: string, detail?: string, isSent?: boolean, isQuiet?: boolean, autoFocus?: boolean, lead?: string, mark?: string, marginTop?: number, width: number, onPress: () => void }} Choice
 */

// One choice: its key and what it does, then one quiet line of detail beneath. On the desktop
// (`isClicked`) no key is drawn and the detail wraps whole; the terminal keeps it to three lines.
/** @param {any} el @param {Choice} row @param {boolean} isClicked */
export const choiceRow = (el, row, isClicked) => {
  const title = `${row.isSent ? '✓ sent · ' : ''}${row.title}`
  const button = el.Button({ key: row.key, label: fit(title, row.width - 3 - (row.mark ? 2 : 0)), hotkey: isClicked ? undefined : row.hotkey, plain: true, dimColor: row.isSent || row.isQuiet ? true : undefined, autoFocus: row.autoFocus ? true : undefined, onPress: row.onPress })
  const body = [
    button,
    // The whole name, wrapped, where a button's one line would cut it (the desktop).
    ...(row.lead ? [el.Box({ key: `${row.key}-lead`, paddingLeft: isClicked ? 1 : 3, children: [el.Text({ wrap: 'wrap', children: row.lead })] })] : []),
    ...(row.detail ? [el.Box({ key: `${row.key}-detail`, paddingLeft: isClicked ? 1 : 3, children: [el.Text({ color: QUIET, wrap: 'wrap', children: isClicked ? row.detail : fit(row.detail, 3 * Math.max(20, row.width - 4)) })] })] : []),
  ]
  // A marked row (something that needs you) hangs its text beside the mark.
  if (row.mark) return el.Box({ key: `row-${row.key}`, flexDirection: 'row', width: '100%', marginTop: row.marginTop, children: [el.Text({ key: `${row.key}-mark`, color: row.isSent ? QUIET : LIME, children: `${row.mark} ` }), el.Box({ key: `${row.key}-body`, flexDirection: 'column', flexGrow: 1, flexShrink: 1, children: body })] })
  return el.Box({ key: `row-${row.key}`, flexDirection: 'column', width: '100%', marginTop: row.marginTop, children: body })
}

// One row of work, the same in every list (D7): stage glyph and title (and its warning), then the
// progress bar and count, age and owner, each in a column as wide as the list's widest. `hotkey`:
// as the surface draws it (none on the desktop).
// On the desktop (`isClicked`) the bar is drawn as an SVG, the count sits at its column's right
// edge with room for the font's wider digits, and a long title is clipped in its own box, so
// the right-hand columns stay where they are.
/** @param {any} el @param {{ key: string, cells: RowCells, cols: Columns, width: number, ownerColour: string, hotkey?: string, autoFocus?: boolean, onPress: () => void, isClicked?: boolean }} row */
export const workLine = (el, row) => {
  const { cells, cols } = row
  if (row.isClicked) return deskLine(el, row)
  const columns = /** @type {[string, string, string | undefined, number][]} */ ([
    ['bar', cells.bar, INK, BAR_CELLS],
    ['count', cells.count.padStart(cols.count), undefined, cols.count],
    ['age', cells.age.padStart(cols.age), QUIET, cols.age],
    ['owner', fit(cells.owner, cols.owner).padEnd(cols.owner), row.ownerColour, cols.owner],
  ]).filter(([, , , size]) => size > 0)
  const right = columns.reduce((sum, [, , , size]) => sum + size + 2, 0)
  const warn = cells.warn ? ` ${cells.warn}` : ''
  const title = fit(`${cells.glyph ? `${cells.glyph} ` : ''}${cells.title}`, Math.max(8, row.width - right - warn.length - (row.hotkey ? 3 : 0)))
  return el.Box({
    key: `row-${row.key}`,
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    children: [
      el.Box({ key: `${row.key}-main`, flexDirection: 'row', flexGrow: 1, flexShrink: 1, children: [el.Button({ key: row.key, label: title, hotkey: row.hotkey, plain: true, autoFocus: row.autoFocus ? true : undefined, onPress: row.onPress }), ...(warn ? [el.Text({ key: `${row.key}-warn`, color: AMBER, children: warn })] : [])] }),
      el.Box({ key: `${row.key}-cols`, flexDirection: 'row', gap: 2, flexShrink: 0, children: columns.map(([name, text, color, size]) => el.Box({ key: `${row.key}-${name}`, width: size, children: [el.Text({ key: `${row.key}-${name}-text`, color, children: text })] })) }),
    ],
  })
}

/** @param {any} el @param {{ key: string, cells: RowCells, cols: Columns, ownerColour: string, autoFocus?: boolean, onPress: () => void }} row */
const deskLine = (el, row) => {
  const { cells, cols } = row
  /** @param {string} name @param {number} size @param {any} child @param {boolean} [isRight] */
  const column = (name, size, child, isRight = false) => el.Box({ key: `${row.key}-${name}`, width: size, flexShrink: 0, justifyContent: isRight ? 'flex-end' : undefined, children: [child] })
  const [done, total] = cells.count ? cells.count.split('/').map(Number) : [0, 0]
  const columns = [
    el.Box({ key: `${row.key}-bar`, flexShrink: 0, children: [el.Svg({ source: miniBarSvg(done, total, INK), alt: cells.count ? `${cells.count} done` : 'no checklist', width: BAR_CELLS * 10, height: 9 })] }),
    ...(cols.count > 0 ? [column('count', cols.count + 1, el.Text({ key: `${row.key}-count-text`, children: cells.count }), true)] : []),
    ...(cols.age > 0 ? [column('age', cols.age + 1, el.Text({ key: `${row.key}-age-text`, color: QUIET, children: cells.age }), true)] : []),
    ...(cols.owner > 0 ? [column('owner', cols.owner, el.Text({ key: `${row.key}-owner-text`, color: row.ownerColour, wrap: 'truncate', children: cells.owner }))] : []),
  ]
  return el.Box({
    key: `row-${row.key}`,
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
    children: [
      el.Box({ key: `${row.key}-main`, flexDirection: 'row', flexGrow: 1, flexShrink: 1, overflow: 'hidden', children: [el.Button({ key: row.key, label: `${cells.glyph ? `${cells.glyph} ` : ''}${cells.title}`, plain: true, autoFocus: row.autoFocus ? true : undefined, onPress: row.onPress }), ...(cells.warn ? [el.Text({ key: `${row.key}-warn`, color: AMBER, children: ` ${cells.warn}` })] : [])] }),
      el.Box({ key: `${row.key}-cols`, flexDirection: 'row', gap: 2, flexShrink: 0, alignItems: 'center', children: columns }),
    ],
  })
}

// The header's one status line: where things stand, and at its right how fresh the team's list is
// (`fresh`, a press that fetches now); without it, the words alone.
/** @param {any} el @param {{ text: string, fresh: string, width: number, hotkey?: string, onPress: () => void }} line */
export const statusLine = (el, { text, fresh, width, hotkey, onPress }) => {
  if (!fresh) return text ? el.Text({ key: 'status', children: fit(text, width) }) : null
  return el.Box({
    key: 'status',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    children: [el.Text({ key: 'status-words', children: fit(text, Math.max(1, width - fresh.length - 6)) }), el.Button({ key: 'sync', label: fresh, hotkey, plain: true, dimColor: true, onPress })],
  })
}

/**
 * How a pane draws work rows: on which surface and how wide, whether rows carry a `local` tag, each
 * owner's colour, and what a press on a row does.
 * @typedef {{ isClicked: boolean, width: number, now: number, isTagged: boolean, ownerColour: (name: string) => string, onRow: (one: Work) => () => void }} Look
 */

/** @param {any} el @param {Look} look @param {Work} one @param {Map<string, RowCells>} cells @param {Columns} cols @param {string} key @param {string | undefined} hotkey @param {boolean} [autoFocus] */
const rowOf = (el, look, one, cells, cols, key, hotkey, autoFocus) => {
  const row = /** @type {RowCells} */ (cells.get(one.id))
  return workLine(el, { key, cells: row, cols, width: look.width, ownerColour: look.ownerColour(row.owner), hotkey: look.isClicked ? undefined : hotkey, autoFocus, onPress: look.onRow(one), isClicked: look.isClicked })
}

// Needs you's rows: one per thing, except an intent's several decisions, which wait as one row that
// opens them (D7). `key`: the next digit, shared with Needs attention.
/**
 * @param {any} el @param {boolean} isClicked
 * @param {{ items: readonly Item[], open: readonly Item[], opened: ReadonlySet<string>, width: number, key: () => string | undefined, onAct: (one: Item) => () => void, onToggle: (slug: string) => () => void }} spec
 */
export const needsRows = (el, isClicked, { items, open, opened, width, key, onAct, onToggle }) => {
  /** @param {Item} one @param {boolean} isFirst @param {string} [slug] */
  const row = (one, isFirst, slug) => choiceRow(el, { key: `item-${one.id}`, title: slug ? one.title.replace(`${slug} · `, '') : one.label, detail: slug ? one.detail : (one.detail ?? (one.title === one.label ? '' : one.title)), mark: slug ? '·' : '◆', marginTop: isFirst || slug ? undefined : 1, hotkey: key(), isSent: !open.includes(one), autoFocus: one === open[0], width: slug ? width - 2 : width, onPress: onAct(one) }, isClicked)
  return callBlocks(items.slice(0, 9)).flatMap((block, at) => {
    const [only] = block.items
    if (block.items.length === 1 && only) return [row(only, at === 0)]
    const isOpen = opened.has(block.slug)
    const head = choiceRow(el, { key: `calls-${block.slug}`, title: `${isOpen ? '▾' : '▸'} ${block.slug} · ${block.items.length} decisions`, mark: '◆', marginTop: at === 0 ? undefined : 1, hotkey: key(), isSent: !block.items.some(one => open.includes(one)), autoFocus: !isOpen && block.items.some(one => one === open[0]), width, onPress: onToggle(block.slug) }, isClicked)
    return [head, ...(isOpen ? [el.Box({ key: `calls-${block.slug}-list`, flexDirection: 'column', paddingLeft: 2, children: block.items.map(one => row(one, false, block.slug)) })] : [])]
  })
}

// Everything open's groups: your intents, your issues, teammates' intents, each foldable with its
// count, in the sort's order; sorted for closing, intents come in bold stage blocks with counts (D4).
// Then "Nothing matches" when a search found nothing, and the glyphs' legend.
/**
 * @param {any} el @param {Look} look
 * @param {{ work: readonly Work[], shown: readonly Work[], query: string, sort: import('./worklist.mjs').Sort, folded: ReadonlySet<string>, me: string, onFold: (key: string) => () => void, issuesFoot: any[] }} spec
 */
export const workGroups = (el, look, { work, shown, query, sort, folded, me, onFold, issuesFoot }) => {
  const { cells, cols } = listCells(shown, look.now, look.isTagged, look.width)
  let index = 0
  /** @param {Work} one */
  const line = one => {
    index += 1
    return rowOf(el, look, one, cells, cols, `pick-${one.id}`, index < 10 ? String(index) : undefined, index === 1)
  }
  const out = []
  for (const group of WORK_GROUPS) {
    const list = sortWork(shown.filter(one => workGroup(one) === group.key), sort)
    const hasNone = group.key === 'issues' && !work.some(one => one.kind === 'issue')
    if (list.length === 0 && !(hasNone && !query)) continue
    const isFolded = folded.has(group.key)
    // Without a name to compare, nobody's work is called a teammate's.
    const title = group.key === 'others' && !me ? 'Open intents' : group.title
    const head = el.Box({ key: `group-${group.key}-head`, flexDirection: 'row', gap: 1, marginTop: 1, children: [el.Button({ key: `group-${group.key}-fold`, label: isFolded ? '▸' : '▾', plain: true, onPress: onFold(group.key) }), label(el, `group-${group.key}-label`, `${title} · ${list.length}`, look.width, GROUP_COLOURS[group.key])] })
    const body = isFolded ? [] : sort === 'close' && group.key !== 'issues' ? stageBlocks(list).flatMap(block => [el.Text({ key: `group-${group.key}-${block.key}`, bold: true, children: `${block.title} · ${block.items.length}` }), ...block.items.map(line)]) : list.map(line)
    const foot = group.key === 'issues' && !isFolded ? [...(hasNone ? [el.Text({ key: 'issues-none', color: QUIET, children: 'None assigned to you right now.' })] : []), ...issuesFoot] : []
    out.push(el.Box({ key: `group-${group.key}`, flexDirection: 'column', children: [head, ...body, ...foot] }))
  }
  if (shown.length === 0 && query) out.push(section(el, 'pick-empty', [el.Text({ key: 'pick-empty-text', color: QUIET, children: 'Nothing matches.' })]))
  out.push(section(el, 'legend', [el.Text({ key: 'legend-text', color: QUIET, children: fit(LEGEND, look.width) })]))
  return out
}

// Home's preview (D7): with nothing tracked, the person's own other work; for everyone, the team's
// first rows with their count, then "+N more ›" (or "Everything open ›") into the whole list.
/**
 * @param {any} el @param {Look} look
 * @param {{ own: readonly Work[], team: { rows: readonly Work[], total: number }, isNewcomer: boolean, me: string, onAll: () => void }} spec
 */
export const homePreview = (el, look, { own, team, isNewcomer, me, onAll }) => {
  const { cells, cols } = listCells([...own, ...team.rows], look.now, look.isTagged, look.width)
  let index = 0
  /** @param {Work} one */
  const line = one => rowOf(el, look, one, cells, cols, `work-${one.id}`, PICK_KEYS[index++])
  const more = team.total - team.rows.length
  return [
    ...(own.length > 0 ? [section(el, 'picks-mine', [label(el, 'picks-mine-label', isNewcomer ? 'Or pick your own' : 'Also yours', look.width), ...own.map(line)])] : []),
    // Without a name to compare, nobody's work is called a teammate's.
    ...(team.rows.length > 0 ? [section(el, 'picks-theirs', [label(el, 'picks-theirs-label', `${me ? "Teammates' intents" : 'Open intents'} · ${team.total}`, look.width), ...(me ? [el.Text({ key: 'picks-theirs-note', color: QUIET, children: 'Read-only: their decisions stay theirs.' })] : []), ...team.rows.map(line)])] : []),
    el.Box({ key: 'all-row', marginTop: own.length + team.rows.length > 0 ? 0 : 1, children: [el.Button({ key: 'all', label: more > 0 ? `+${more} more ›` : 'Everything open ›', hotkey: look.isClicked ? undefined : 'i', plain: look.isClicked ? undefined : true, dimColor: look.isClicked ? undefined : true, onPress: onAll })] }),
  ]
}
