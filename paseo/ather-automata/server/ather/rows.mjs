// Ather Automata: the pane's look, and the lists it draws (Needs you, Everything open, Home's
// preview), built with the elements the pane is handed (`el`). Pure: no `$`; every press
// arrives as a closure from console.mjs.

import { NONE_OPEN, decidedText } from './decide.mjs'
import { WORK_GROUPS, workGroup } from './home.mjs'
import { BAR_CELLS, LEGEND, PARKED_KEY, blocksOf, countText, listCells, miniBarSvg } from './worklist.mjs'

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

// A checkout's name after a row's title: a worktree's folder can be longer than the title it sits beside, so it is cut.
const REPO_CELLS = 16

// A top-level section label, spaced out as the studio's are ("N E E D S   Y O U"), plain when too wide.
/** @param {any} el @param {string} key @param {string} text @param {number} width @param {string} [colour] */
export const label = (el, key, text, width, colour = INK) => {
  const spaced = text.toUpperCase().split('').join(' ')
  return el.Text({ key, color: colour, bold: true, children: spaced.length <= width ? spaced : fit(text.toUpperCase(), width) })
}

/** @param {any} el @param {string} key @param {any[]} children */
export const section = (el, key, children) => el.Box({ key, flexDirection: 'column', width: '100%', marginTop: 1, children })

/**
 * @typedef {{ key: string, hotkey?: string, title: string, detail?: string, isSent?: boolean, isQuiet?: boolean, autoFocus?: boolean, lead?: string, mark?: string, marginTop?: number, width: number, onPress: () => void, below?: any }} Choice
 * `below`: drawn under the row's text, beside its mark (an opened decision's answers)
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
    ...(row.below ? [row.below] : []),
  ]
  // A marked row (something that needs you) hangs its text beside the mark.
  if (row.mark) return el.Box({ key: `row-${row.key}`, flexDirection: 'row', width: '100%', marginTop: row.marginTop, children: [el.Text({ key: `${row.key}-mark`, color: row.isSent ? QUIET : LIME, children: `${row.mark} ` }), el.Box({ key: `${row.key}-body`, flexDirection: 'column', flexGrow: 1, flexShrink: 1, children: body })] })
  return el.Box({ key: `row-${row.key}`, flexDirection: 'column', width: '100%', marginTop: row.marginTop, children: body })
}

// One row of work, the same in every list (D7): stage glyph and title (its warning, then its repository's
// name, dim, when the pane lists several), then the
// progress bar and count, age and owner, each in a column as wide as the list's widest. `hotkey`:
// as the surface draws it (none on the desktop).
// On the desktop (`isClicked`) the bar is drawn as an SVG, the count sits at its column's right
// edge with room for the font's wider digits, and a long title is clipped in its own box, so
// the right-hand columns stay where they are; its warning and repository's name are in that box too.
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
  const repo = cells.repo ? ` ${fit(cells.repo, REPO_CELLS)}` : ''
  const title = fit(`${cells.glyph ? `${cells.glyph} ` : ''}${cells.title}`, Math.max(8, row.width - right - warn.length - repo.length - (row.hotkey ? 3 : 0)))
  return el.Box({
    key: `row-${row.key}`,
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    children: [
      el.Box({ key: `${row.key}-main`, flexDirection: 'row', flexGrow: 1, flexShrink: 1, children: [el.Button({ key: row.key, label: title, hotkey: row.hotkey, plain: true, autoFocus: row.autoFocus ? true : undefined, onPress: row.onPress }), ...(warn ? [el.Text({ key: `${row.key}-warn`, color: AMBER, children: warn })] : []), ...(repo ? [el.Text({ key: `${row.key}-repo`, color: QUIET, children: repo })] : [])] }),
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
  const title = [el.Button({ key: row.key, label: `${cells.glyph ? `${cells.glyph} ` : ''}${cells.title}`, plain: true, autoFocus: row.autoFocus ? true : undefined, onPress: row.onPress }), ...(cells.warn ? [el.Text({ key: `${row.key}-warn`, color: AMBER, children: ` ${cells.warn}` })] : [])]
  // With a repository's name the title alone gives way in a narrow pane: the name is what tells two checkouts' rows of one intent apart.
  const main = cells.repo
    ? [el.Box({ key: `${row.key}-title`, flexDirection: 'row', flexShrink: 1, overflow: 'hidden', children: title }), el.Box({ key: `${row.key}-repo`, flexShrink: 0, paddingRight: 1, children: [el.Text({ key: `${row.key}-repo-text`, color: QUIET, children: ` ${fit(cells.repo, REPO_CELLS)}` })] })]
    : title
  return el.Box({
    key: `row-${row.key}`,
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
    children: [
      el.Box({ key: `${row.key}-main`, flexDirection: 'row', flexGrow: 1, flexShrink: 1, overflow: 'hidden', children: main }),
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
 * @typedef {{ isClicked: boolean, width: number, now: number, isTagged: boolean | ((one: import('./worklist.mjs').RowWork) => boolean), ownerColour: (name: string) => string, onRow: (one: Work) => () => void }} Look
 */

/** @param {any} el @param {Look} look @param {Work} one @param {Map<string, RowCells>} cells @param {Columns} cols @param {string} key @param {string | undefined} hotkey @param {boolean} [autoFocus] */
const rowOf = (el, look, one, cells, cols, key, hotkey, autoFocus) => {
  const row = /** @type {RowCells} */ (cells.get(one.id))
  return workLine(el, { key, cells: row, cols, width: look.width, ownerColour: look.ownerColour(row.owner), hotkey: look.isClicked ? undefined : hotkey, autoFocus, onPress: look.onRow(one), isClicked: look.isClicked })
}

// The colour of a decision answered here.
const DONE = '#3ccf7a'

/**
 * How Needs you answers in place (0.2.0): what to draw (decide.mjs needsView) and what each press does.
 * The presses that act on an answer are handed the item's answers, so none needs to look them up.
 * @typedef {{ view: NeedsView,
 *   onOpen: (id: string) => () => void, onAnswer: (one: Item, option: Option) => () => void, onExplain: (one: Item, answers: Answers) => () => void,
 *   onType: (one: Item, answers: Answers) => () => void, onTyped: (one: Item, answers: Answers) => (words: string) => void, onFindings: (one: Item) => () => void, onFold: () => void }} Answering
 * @typedef {import('./decide.mjs').NeedsView<Item>} NeedsView
 * @typedef {import('./decide.mjs').Answers} Answers
 * @typedef {Answers['options'][number]} Option
 */

// What an item is called once answered: "F-10 on fluid-snow-sand-look", or its label.
/** @param {Item} one */
const answeredName = one => (one.kind === 'call' ? one.question.split(':')[0] ?? one.label : one.label)

// "A: Prove both on a map … (recommended)", the label cut so the mark always shows.
/** @param {Option} option @param {number} width */
const optionText = (option, width) => {
  const mark = option.isRecommended ? ' (recommended)' : ''
  return `${option.letter}: ${fit(option.label, Math.max(12, width - mark.length - option.letter.length - 2))}${mark}`
}

// The opened decision under its row: the whole question, each option a button (the recommended one
// primary), then Explain, Type an answer and Open findings, and the typed answer's field when open.
/** @param {any} el @param {boolean} isClicked @param {Item} one @param {Answers} answers @param {number} width @param {Answering} answer */
const decisionBody = (el, isClicked, one, answers, width, answer) => {
  const pad = isClicked ? 1 : 3
  const inner = width - pad - 4
  return el.Box({
    key: `answers-${one.id}`,
    flexDirection: 'column',
    paddingLeft: pad,
    children: [
      ...(one.detail ? [el.Text({ key: `answers-${one.id}-question`, wrap: 'wrap', children: one.detail })] : []),
      ...answers.options.map(option => el.Box({ key: `option-${one.id}-${option.letter}-row`, children: [el.Button({ key: `option-${one.id}-${option.letter}`, label: optionText(option, inner), variant: option.isRecommended ? 'primary' : undefined, onPress: answer.onAnswer(one, option) })] })),
      el.Box({
        key: `answers-${one.id}-more`,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 3,
        children: [
          el.Button({ key: `explain-${one.id}`, label: 'Explain', hotkey: isClicked ? undefined : 'x', plain: true, onPress: answer.onExplain(one, answers) }),
          el.Button({ key: `type-${one.id}`, label: 'Type an answer', hotkey: isClicked ? undefined : 't', plain: true, onPress: answer.onType(one, answers) }),
          ...(answers.source ? [el.Button({ key: `findings-${one.id}`, label: 'Open findings ›', plain: true, dimColor: true, onPress: answer.onFindings(one) })] : []),
        ],
      }),
      ...(answer.view.typingId === one.id ? [el.Input({ key: `typed-${one.id}`, placeholder: `Your answer to ${answeredName(one)}`, submitLabel: 'send', autoFocus: true, onSubmit: answer.onTyped(one, answers) })] : []),
    ],
  })
}

// Needs you's rows, as decide.mjs needsView lays them out: one per thing, except an intent's several
// decisions, which wait as one row that opens them (D7); each row "✓ Decided" in place, opened with its
// answers, or its one line; then "▸ N decided". `key`: the next digit, shared with Needs attention.
/**
 * @param {any} el @param {boolean} isClicked
 * @param {{ items: readonly Item[], open: readonly Item[], opened: ReadonlySet<string>, width: number, key: () => string | undefined, onAct: (one: Item) => () => void, onToggle: (slug: string) => () => void, answer: Answering }} spec
 */
export const needsRows = (el, isClicked, { items, open, opened, width, key, onAct, onToggle, answer }) => {
  const { view } = answer
  const fresh = new Map(view.fresh.map(one => [one.id, one]))
  /** @param {Item} one @param {boolean} isFirst @param {string} [slug] */
  const row = (one, isFirst, slug) => {
    const rowWidth = slug ? width - 2 : width
    const marginTop = isFirst || slug ? undefined : 1
    const state = view.states[one.id] ?? 'line'
    if (state === 'decided') return el.Box({ key: `row-item-${one.id}`, marginTop, children: [el.Text({ key: `item-${one.id}-done`, color: DONE, children: fit(`${decidedText(fresh.get(one.id)?.answer ?? '')} · ${answeredName(one)}`, rowWidth) })] })
    const isShown = state === 'opened' && one.answers
    const press = view.opens.has(one.id) ? answer.onOpen(isShown ? NONE_OPEN : one.id) : onAct(one)
    return choiceRow(el, { key: `item-${one.id}`, title: slug ? one.title.replace(`${slug} · `, '') : one.label, detail: isShown ? undefined : slug ? one.detail : (one.detail ?? (one.title === one.label ? '' : one.title)), mark: slug ? '·' : '◆', marginTop, hotkey: key(), isSent: !open.includes(one), autoFocus: view.isFocusFree && one === open[0], width: rowWidth, onPress: press, below: isShown && one.answers ? decisionBody(el, isClicked, one, one.answers, rowWidth - 2, answer) : undefined }, isClicked)
  }
  const rows = view.blocks.flatMap((block, at) => {
    const [only] = block.items
    if (block.items.length === 1 && only) return [row(only, at === 0)]
    const isOpen = opened.has(block.slug)
    const head = choiceRow(el, { key: `calls-${block.slug}`, title: `${isOpen ? '▾' : '▸'} ${block.slug} · ${block.items.length} decisions`, mark: '◆', marginTop: at === 0 ? undefined : 1, hotkey: key(), isSent: !block.items.some(one => open.includes(one)), autoFocus: view.isFocusFree && !isOpen && block.items.some(one => one === open[0]), width, onPress: onToggle(block.slug) }, isClicked)
    return [head, ...(isOpen ? [el.Box({ key: `calls-${block.slug}-list`, flexDirection: 'column', paddingLeft: 2, children: block.items.map(one => row(one, false, block.slug)) })] : [])]
  })
  if (view.folded.length === 0) return rows
  // This session's answers, newest first, until the files read them resolved.
  const names = new Map(items.map(one => [one.id, answeredName(one)]))
  return [
    ...rows,
    el.Box({ key: 'decided-row', marginTop: rows.length > 0 ? 1 : 0, children: [el.Button({ key: 'decided-fold', label: `${view.isFoldOpen ? '▾' : '▸'} ${view.folded.length} decided`, plain: true, dimColor: true, onPress: answer.onFold })] }),
    ...(view.isFoldOpen ? view.folded.map(one => el.Box({ key: `decided-${one.id}`, paddingLeft: 2, children: [el.Text({ key: `decided-${one.id}-text`, color: QUIET, children: fit(`✓ ${names.get(one.id) ?? one.id}: ${one.answer}`, width - 2) })] })) : []),
  ]
}

// Open findings: the finding as written, whole, and the way back.
/** @param {any} el @param {{ item: Item, width: number, isClicked: boolean, onBack: () => void }} spec */
export const findingRows = (el, { item, width, isClicked, onBack }) => [
  el.Box({ key: 'finding-head', flexDirection: 'column', children: [label(el, 'brand', 'Finding', width), el.Text({ key: 'title', bold: true, children: fit(answeredName(item), width) })] }),
  section(el, 'finding-text', [el.Markdown({ key: 'finding-markdown', text: item.answers?.source || item.detail || item.title })]),
  section(el, 'finding-back', [el.Button({ key: 'finding-back', label: 'Back', hotkey: isClicked ? undefined : '0', plain: true, dimColor: true, autoFocus: true, onPress: onBack })]),
]

// Everything open's groups: your intents, your issues, teammates' intents, each foldable with its
// count, in the sort's order; sorted for closing, intents come in bold stage blocks with counts (D4).
// Then "Nothing matches" when a search found nothing, and the glyphs' legend.
/**
 * @param {any} el @param {Look} look
 * @param {{ work: readonly Work[], shown: readonly Work[], query: string, sort: import('./worklist.mjs').Sort, groupBy?: import('./worklist.mjs').GroupBy, areas?: readonly string[], folded: ReadonlySet<string>, me: string, isFocusTaken?: boolean, onFold: (key: string) => () => void, issuesFoot: any[] }} spec
 */
export const workGroups = (el, look, { work, shown, query, sort, groupBy = 'none', areas = [], folded, me, isFocusTaken = false, onFold, issuesFoot }) => {
  const { cells, cols } = listCells(shown, look.now, look.isTagged, look.width)
  const isSearching = query !== ''
  let index = 0
  /** @param {Work} one */
  const line = one => {
    index += 1
    return rowOf(el, look, one, cells, cols, `pick-${one.id}`, index < 10 ? String(index) : undefined, index === 1 && !isFocusTaken)
  }
  // `folded` holds the heads pressed: a head that starts folded (a large sub-group, Parked; nothing while searching) opens when pressed.
  /** @param {string} key @param {boolean} startsFolded */
  const isFoldedAt = (key, startsFolded) => folded.has(key) !== startsFolded
  // A sub-head: its fold, then its title and count in bold (not letter-spaced, never lime).
  /** @param {string} key @param {string} foldKey @param {string} text @param {boolean} isFolded */
  const subHead = (key, foldKey, text, isFolded) => el.Box({ key, flexDirection: 'row', gap: 1, children: [el.Button({ key: `${key}-fold`, label: isFolded ? '▸' : '▾', plain: true, onPress: onFold(foldKey) }), el.Text({ key: `${key}-text`, bold: true, children: text })] })
  const out = []
  for (const group of WORK_GROUPS) {
    const all = work.filter(one => workGroup(one) === group.key)
    const list = shown.filter(one => workGroup(one) === group.key)
    const hasNone = group.key === 'issues' && !work.some(one => one.kind === 'issue')
    if (list.length === 0 && !(hasNone && !query)) continue
    const isFolded = isFoldedAt(group.key, false)
    // Without a name to compare, nobody's work is called a teammate's.
    const title = group.key === 'others' && !me ? 'Open intents' : group.title
    const head = el.Box({ key: `group-${group.key}-head`, flexDirection: 'row', gap: 1, marginTop: 1, children: [el.Button({ key: `group-${group.key}-fold`, label: isFolded ? '▸' : '▾', plain: true, onPress: onFold(group.key) }), label(el, `group-${group.key}-label`, `${title} · ${countText(list.length, all.length, isSearching)}`, look.width, GROUP_COLOURS[group.key])] })
    // The group's blocks (worklist.mjs blocksOf): sub-groups, stage blocks or plain rows, then Parked (D7-D9).
    let subAt = 0
    const body = isFolded
      ? []
      : blocksOf(group.key, list, all, { sort, groupBy, areas, isSearching }).flatMap(block => {
          if (block.kind === 'plain') return block.items.map(line)
          const count = `${block.title} · ${countText(block.items.length, block.total, isSearching)}`
          if (block.kind === 'stage') return [el.Text({ key: `group-${group.key}-${block.key}`, bold: true, children: count }), ...block.items.map(line)]
          const isBlockFolded = isFoldedAt(block.foldKey, block.startsFolded)
          const key = block.key === PARKED_KEY ? `park-${group.key}` : `sub-${group.key}-${subAt++}`
          return [subHead(key, block.foldKey, count, isBlockFolded), ...(isBlockFolded ? [] : block.items.map(line))]
        })
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

// ---------------------------------------------------------------- the header and the summary strip

// The Ather mark: the A, its lime I, and the 5 raised as a power.
const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><polygon points="6,98 40,14 60,14 94,98 76,98 50,36 24,98" fill="#C9CCCC"/><rect x="47.5" y="56" width="5" height="28" fill="#DDFF00"/><text x="86" y="40" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="40" fill="#DDFF00">5</text></svg>'

// Plan ✓ ─ Build ● ─ Prove ○ ─ Ship ○, lit up to where the work is.
/** @param {any} el @param {readonly { label: string, state: 'done' | 'now' | 'todo' }[]} stages */
export function stageRow(el, stages) {
  return el.Box({
    key: 'stages',
    flexDirection: 'row',
    children: stages.flatMap((one, index) => [
      ...(index > 0 ? [el.Text({ key: `stage-gap-${index}`, color: QUIET, children: ' ─ ' })] : []),
      el.Text({ key: `stage-${index}`, color: one.state === 'todo' ? QUIET : INK, bold: one.state === 'now', children: `${one.label} ${one.state === 'done' ? '✓' : one.state === 'now' ? '●' : '○'}` }),
    ]),
  })
}

/** @param {any} el @param {any[]} lines @param {string | undefined} surface */
export function masthead(el, lines, surface) {
  const words = el.Box({ key: 'head-words', flexDirection: 'column', children: lines })
  return surface === 'desktop' && el.Svg ? el.Box({ key: 'head', flexDirection: 'row', gap: 2, alignItems: 'center', children: [el.Svg({ source: MARK, alt: 'Ather', width: 48, height: 40 }), words] }) : words
}

// Ten segments, lit in lime as far as the checklist is done.
/** @param {any} el @param {string} key @param {number} done @param {number} total */
function bar(el, key, done, total) {
  const lit = total > 0 ? Math.round((done / total) * 10) : 0
  return el.Box({ key, flexDirection: 'row', children: [el.Text({ color: INK, children: '━'.repeat(lit) }), el.Text({ color: '#3a3c36', children: '━'.repeat(10 - lit) })] })
}

// How it is going, before anything is read: the checklist, workers running, decisions waiting on you.
/** @param {any} el @param {{ header: { done: number, total: number }, open: readonly unknown[], work: readonly { isMine: boolean }[] }} model @param {readonly { state: string }[]} crew @param {boolean} isClicked */
export function summaryStrip(el, model, crew, isClicked) {
  const { header } = model
  const running = crew.filter(one => one.state === 'running').length
  // The same count as the Needs you section beneath: a rule to make waits on you as much as a decision.
  const decisions = model.open.length
  const first = header.total > 0 ? { key: 'Checklist', value: `${header.done}/${header.total}`, extra: bar(el, 'strip-bar', header.done, header.total) } : { key: 'Yours', value: String(model.work.filter(one => one.isMine).length), extra: el.Text({ color: QUIET, children: 'intents and issues' }) }
  const cards = [
    { ...first, isHot: false },
    { key: 'Workers', value: String(running), extra: el.Text({ color: QUIET, children: 'running' }), isHot: false },
    { key: 'Needs you', value: String(decisions), extra: el.Text({ color: decisions > 0 ? LIME : QUIET, children: decisions === 1 ? 'thing waiting' : 'things waiting' }), isHot: decisions > 0 },
  ]
  if (isClicked) {
    return el.Box({
      key: 'strip',
      flexDirection: 'row',
      gap: 1,
      width: '100%',
      marginTop: 1,
      children: cards.map(card => el.Box({ key: `strip-${card.key}`, flexDirection: 'column', flexGrow: 1, borderStyle: 'round', borderColor: card.isHot ? LIME : '#3a3c36', paddingX: 1, children: [el.Text({ color: QUIET, children: card.key }), el.Text({ bold: true, color: card.isHot ? LIME : undefined, children: card.value }), card.extra] })),
    })
  }
  // The terminal: one line.
  return el.Box({
    key: 'strip',
    flexDirection: 'row',
    marginTop: 1,
    children: [
      el.Text({ color: QUIET, children: `${first.key} ` }),
      el.Text({ bold: true, children: first.value }),
      ...(header.total > 0 ? [el.Text({ children: ' ' }), bar(el, 'strip-bar', header.done, header.total)] : []),
      el.Text({ color: QUIET, children: ` · Workers ` }),
      el.Text({ bold: true, children: String(running) }),
      el.Text({ color: QUIET, children: ' · Needs you ' }),
      el.Text({ bold: true, color: decisions > 0 ? LIME : undefined, children: String(decisions) }),
    ],
  })
}

// Role, proof, the Editor lock and this week's figures; each proof is green when it passed and red when it failed.
/** @param {any} el @param {{ role: string, proof: string, lock: string, week: string }} header */
export function metaRow(el, header) {
  const parts = [
    ...(header.role ? [el.Text({ color: QUIET, children: header.role })] : []),
    ...(header.proof ? header.proof.split(' · ').map(piece => el.Text({ color: piece.endsWith('✗') ? '#ff5a45' : piece.endsWith('✓') ? '#3ccf7a' : QUIET, children: piece })) : []),
    ...(header.lock ? [el.Text({ color: QUIET, children: header.lock })] : []),
    ...(header.week ? [el.Text({ color: QUIET, children: header.week })] : []),
  ]
  return el.Box({ key: 'meta', flexDirection: 'row', flexWrap: 'wrap', children: parts.flatMap((part, index) => (index > 0 ? [el.Text({ color: QUIET, children: ' · ' }), part] : [part])) })
}
