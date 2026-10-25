// @ts-check
// Ather Lanes: the pane as design.md draws it (D7). `paneLines` is pure: it lays the board (board.mjs) out as
// lines of segments, each with its words, colour and press, so every line's width and colour can be checked;
// `drawPane` turns those lines into the surface's elements. Lime only for For you's label and count, amber only
// on A look's reasons; everything else ink or quiet. No columns, no legend; one hint line on the terminal.

import { AMBER, INK, LIME, QUIET, cells, fit, padCells } from './ather/rows.mjs'
import { plural } from './ather/model.mjs'
import { ageText } from './ather/worklist.mjs'
import { HERE, decisionCount, detailsOf, foldText, glyphOf, holdText, minutesText, phraseOf, poolText, registerLine } from './board.mjs'

/**
 * @typedef {import('./board.mjs').Board} Board
 * @typedef {import('./records.mjs').LaneRecord} LaneRecord
 * @typedef {{ name: string, from: 'you' | 'look' | 'fold' }} Opened a lane opened in place, and the section it was opened from
 * @typedef {{ kind: 'refresh' } | { kind: 'fold' } | { kind: 'lane', lane: Opened }} Press what pressing a segment does
 * @typedef {{ key: string, text: string, color?: string, bold?: boolean, press?: Press, link?: string, hotkey?: string }} Segment
 * @typedef {{ key: string, segments: Segment[], marginTop?: number }} Line
 * @typedef {{ width: number, isDesktop: boolean, now: number, clock: (ms: number) => string, opened: Opened | null, isFoldOpen: boolean,
 *   refreshedAt: number | null, errors: readonly string[] }} View
 */

/** @param {string} name @param {Opened['from']} from @returns {Press} */
const laneAt = (name, from) => ({ kind: 'lane', lane: { name, from } })

/** @param {View} view @param {string} name @param {Opened['from']} from */
const isOpenAt = (view, name, from) => view.opened?.name === name && view.opened.from === from

// A lane's name keeps this many cells in a terminal line (design.md's mockups).
const NAME_CELLS = 16
const INDENT = '  '
const DETAIL_INDENT = '    '
const LABEL_CELLS = 6

/** @param {string} key @param {Segment[]} segments @param {number} [marginTop] @returns {Line} */
const line = (key, segments, marginTop) => ({ key, segments: segments.filter(one => one.text !== ''), ...(marginTop ? { marginTop } : {}) })

// The cells a segment takes as the terminal draws it: a button's hotkey adds "r: " before its words.
/** @param {Segment} one */
const segmentCells = one => cells(one.text) + (one.hotkey ? cells(one.hotkey) + 2 : 0)

// A line with words on the left and on the right, the gap between filled so it is `width` wide.
/** @param {string} key @param {Segment[]} left @param {Segment} right @param {number} width @param {number} [marginTop] */
const spread = (key, left, right, width, marginTop) => {
  const used = left.reduce((sum, one) => sum + segmentCells(one), 0)
  const room = width - used - 1 - (right.hotkey ? cells(right.hotkey) + 2 : 0)
  const tail = { ...right, text: room >= 4 ? fit(right.text, room) : '' }
  return line(key, [...left, { key: `${key}-gap`, text: ' '.repeat(Math.max(1, width - used - segmentCells(tail))) }, tail], marginTop)
}

// Words wrapped to `width` cells, each piece a line of its own; a word longer than the width is cut.
/** @param {string} text @param {number} width */
const wrap = (text, width) => {
  /** @type {string[]} */
  const out = []
  let current = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word
    if (cells(next) <= width) current = next
    else {
      if (current) out.push(current)
      current = fit(word, width)
    }
  }
  return current ? [...out, current] : out
}

/** @param {string} text */
const spaced = text => text.toUpperCase().split('').join(' ')

/** @param {Board} board @param {LaneRecord} lane */
const isHere = (board, lane) => board.here?.name === lane.name

// An item's line, with "this session" quiet at its right end when it is this session's lane (D10): the words are cut
// to leave it room.
/** @param {string} key @param {Segment[]} left @param {boolean} here @param {number} width */
const marked = (key, left, here, width) => {
  if (!here) return line(key, left)
  const room = width - cells(HERE) - 2
  let used = 0
  const cut = left.map(one => {
    const text = fit(one.text, Math.max(0, room - used))
    used += cells(text)
    return { ...one, text }
  })
  return spread(key, cut, { key: `${key}-here`, text: HERE, color: QUIET }, width)
}

// The opened lane's lines (D4, design.md's order), under the item it was opened from.
/** @param {LaneRecord} lane @param {Board} board @param {View} view @returns {Line[]} */
const openedLines = (lane, board, view) => {
  const indent = view.isDesktop ? '' : DETAIL_INDENT
  const room = Math.max(20, view.width - cells(indent) - LABEL_CELLS)
  const here = isHere(board, lane) ? [line(`open-${lane.name}-here`, [{ key: `open-${lane.name}-here-text`, text: `${indent}${HERE}`, color: QUIET }])] : []
  if (lane.sidecar === 'unregistered') {
    const command = registerLine(lane)
    // Too wide for the pane: broken where PowerShell's line continuation (a backtick) keeps it one command to copy.
    const commandLines = view.isDesktop || cells(indent) + cells(command) <= view.width ? [command] : [command.replace(/ -Intent .*$/, ' `'), `  ${command.replace(/^.* (-Intent .*)$/, '$1')}`]
    return [
      ...here,
      ...wrap('No sidecar, so the board knows no intent, tier or claims for this worktree. Register it with:', view.width - cells(indent)).map((text, index) => line(`open-${lane.name}-why-${index}`, [{ key: `open-${lane.name}-why-${index}-text`, text: `${indent}${text}`, color: QUIET }])),
      ...commandLines.map((text, index) => line(`register-${lane.name}-${index}`, [{ key: `register-${lane.name}-${index}-text`, text: `${indent}${fit(text, view.width - cells(indent))}` }])),
    ]
  }
  return detailsOf(lane, board.holds, view.now, here.length > 0).flatMap((detail, index) => {
    const key = `detail-${lane.name}-${index}`
    const pieces = view.isDesktop ? [detail.text] : wrap(detail.text, room)
    const link = detail.link ? [{ key: `${key}-link`, text: ' · open on GitHub ↗', link: detail.link, color: QUIET }] : []
    return pieces.map((text, piece) =>
      line(`${key}-${piece}`, [
        { key: `${key}-${piece}-label`, text: `${indent}${padCells(piece === 0 ? detail.label : '', LABEL_CELLS)}`, color: QUIET },
        { key: `${key}-${piece}-text`, text },
        ...(piece === pieces.length - 1 && (view.isDesktop || cells(indent) + LABEL_CELLS + cells(text) + cells(link[0]?.text ?? '') <= view.width) ? link : []),
      ]),
    )
  })
}

// The mark before an item: ▾ while its lane is open from here.
/** @param {View} view @param {string} name @param {Opened['from']} from */
const markOf = (view, name, from) => (isOpenAt(view, name, from) ? '▾ ' : INDENT)

/** @param {Board} board @param {View} view @returns {Line[]} */
export const paneLines = (board, view) => {
  const { width, isDesktop } = view
  /** @type {Line[]} */
  const out = []
  const since = view.refreshedAt === null ? null : view.now - view.refreshedAt
  const fresh = [since === null ? 'not read yet' : '', board.rows[0]?.lane.mainMovedAt ? `main as of ${view.clock(board.rows[0].lane.mainMovedAt)}` : '', since === null ? '' : `↻ ${since < 60000 ? `${Math.max(0, Math.round(since / 1000))}s` : minutesText(Math.floor(since / 60000))}`].filter(Boolean).join(' · ')
  out.push(spread('header', [{ key: 'header-label', text: isDesktop ? 'LANES' : spaced('lanes'), color: INK, bold: true }], { key: 'refresh', text: isDesktop ? `${fresh} · ↻ Refresh` : fresh || '↻', color: QUIET, press: { kind: 'refresh' }, hotkey: isDesktop ? undefined : 'r' }, width))
  for (const [index, error] of view.errors.entries()) out.push(line(`error-${index}`, [{ key: `error-${index}-text`, text: fit(error, width * 2), color: QUIET }]))

  if (board.forYou.length === 0 && board.look.length === 0) out.push(line('nothing', [{ key: 'nothing-text', text: 'Nothing needs you.', color: INK }], 1))

  if (board.forYou.length > 0) {
    const count = plural(decisionCount(board), 'decision')
    out.push(spread('you', [{ key: 'you-label', text: isDesktop ? 'FOR YOU' : spaced('for you'), color: LIME, bold: true }], { key: 'you-count', text: count, color: LIME }, width, 1))
    for (const { lane, decisions } of board.forYou) {
      if (isDesktop) out.push(line(`you-${lane.name}`, [{ key: `you-${lane.name}-name`, text: lane.name, bold: true, press: laneAt(lane.name, 'you') }, ...(isHere(board, lane) ? [{ key: `you-${lane.name}-here`, text: `  ${HERE}`, color: QUIET }] : [])]))
      for (const [index, call] of decisions.entries()) {
        const lead = isDesktop ? '' : `${index === decisions.length - 1 ? markOf(view, lane.name, 'you') : INDENT}${padCells(index === 0 ? fit(lane.name, NAME_CELLS - 2) : '', NAME_CELLS)}`
        out.push(marked(`you-${lane.name}-${call.id}`, [{ key: `you-${lane.name}-${call.id}-press`, text: fit(`${lead}${padCells(call.id, 5)}${call.title}`, width), press: laneAt(lane.name, 'you') }], !isDesktop && index === 0 && isHere(board, lane), width))
      }
      if (isOpenAt(view, lane.name, 'you')) out.push(...openedLines(lane, board, view))
    }
  }

  if (board.look.length > 0) {
    out.push(spread('look', [{ key: 'look-label', text: isDesktop ? 'A LOOK' : spaced('a look'), color: INK, bold: true }], { key: 'look-count', text: String(board.look.length), color: INK }, width, 1))
    for (const { lane, reasons } of board.look) {
      const lead = isDesktop ? lane.name : `${markOf(view, lane.name, 'look')}${padCells(fit(lane.name, NAME_CELLS - 2), NAME_CELLS)}`
      const words = reasons.map(one => one.text).join(' · ')
      const why = { key: `look-${lane.name}-why`, text: isDesktop ? `  ${words}` : fit(words, width - cells(lead)), color: AMBER }
      const here = isHere(board, lane)
      out.push(isDesktop ? line(`look-${lane.name}`, [{ key: `look-${lane.name}-press`, text: lead, press: laneAt(lane.name, 'look'), bold: true }, ...(here ? [{ key: `look-${lane.name}-here`, text: `  ${HERE}`, color: QUIET }] : []), why]) : marked(`look-${lane.name}`, [{ key: `look-${lane.name}-press`, text: lead, press: laneAt(lane.name, 'look') }, why], here, width))
      if (isOpenAt(view, lane.name, 'look')) out.push(...openedLines(lane, board, view))
    }
  }

  out.push(...foldLines(board, view))
  if (!isDesktop) out.push(spread('hint', [], { key: 'hint-text', text: 'enter opens a lane or the fold · r ↻', color: QUIET }, width))
  return out
}

/** @param {Board} board @param {View} view @returns {Line[]} */
const foldLines = (board, view) => {
  const { width, isDesktop } = view
  if (!view.isFoldOpen) {
    if (!isDesktop) return [line('fold', [{ key: 'fold-press', text: fit(`▸ ${foldText(board)}`, width), color: QUIET, press: { kind: 'fold' } }], 1)]
    const editor = board.editor ? `Editor slot: ${holdText(board.editor)}` : 'Editor slot: free'
    return [line('fold', [{ key: 'fold-press', text: `All ${plural(board.count, 'lane')} · pool ${poolText(board.pool)}`, press: { kind: 'fold' } }], 1), line('fold-editor', [{ key: 'fold-editor-text', text: editor, color: QUIET }])]
  }
  /** @type {Line[]} */
  const out = [line('fold', [{ key: 'fold-press', text: fit(`▾ all ${plural(board.count, 'lane')} · pool ${poolText(board.pool)}`, width), color: QUIET, press: { kind: 'fold' } }], 1)]
  for (const row of board.rows) {
    const { lane } = row
    const isOpen = isOpenAt(view, lane.name, 'fold')
    const phrase = phraseOf(row)
    const age = lane.lastMoved ? ageText(lane.lastMoved.at, view.now) || '0m' : ''
    const right = [isHere(board, lane) ? HERE : '', age].filter(Boolean).join(' · ')
    const lead = `${isOpen ? '▾ ' : INDENT}${glyphOf(lane)} ${padCells(fit(lane.name, NAME_CELLS - 2), NAME_CELLS)}`
    out.push(spread(`row-${lane.name}`, [{ key: `row-${lane.name}-press`, text: isDesktop ? `${glyphOf(lane)} ${lane.name}` : lead, press: laneAt(lane.name, 'fold') }, { key: `row-${lane.name}-phrase`, text: isDesktop ? `  ${phrase}` : fit(phrase, Math.max(0, width - cells(lead) - Math.max(6, cells(right) + 2))) }], { key: `row-${lane.name}-age`, text: right, color: QUIET }, width))
    if (isOpen) out.push(...openedLines(lane, board, view))
  }
  if (board.pool.ready + board.pool.building > 0) out.push(line('row-pool', [{ key: 'row-pool-text', text: fit(`${INDENT}  ${padCells('pool', NAME_CELLS)}${board.pool.ready} ready · ${board.pool.building} building`, width), color: QUIET }]))
  if (board.holds.length === 0) out.push(line('holds-none', [{ key: 'holds-none-text', text: `${INDENT}all slots free`, color: QUIET }]))
  for (const hold of board.holds) out.push(line(`hold-${hold.ids[0]}`, [{ key: `hold-${hold.ids[0]}-text`, text: fit(`${INDENT}${padCells(hold.label, 9)}${holdText(hold)}`, width), color: QUIET }]))
  return out
}

// ---------------------------------------------------------------- drawing

/** @param {any} el @param {Line[]} lines @param {{ isDesktop: boolean, onPress: (press: Press) => void }} draw */
export const drawPane = (el, lines, { isDesktop, onPress }) =>
  el.Box({
    key: 'lanes',
    flexDirection: 'column',
    width: '100%',
    children: lines.map(one =>
      el.Box({
        key: one.key,
        flexDirection: 'row',
        width: '100%',
        ...(one.marginTop ? { marginTop: one.marginTop } : {}),
        ...(isDesktop ? { flexWrap: 'wrap' } : {}),
        children: one.segments.map(segment => {
          const press = segment.press
          if (segment.link) return el.Link({ key: segment.key, href: segment.link, label: segment.text })
          if (press) return el.Button({ key: segment.key, label: segment.text, plain: true, hotkey: segment.hotkey, dimColor: segment.color === QUIET ? true : undefined, onPress: () => onPress(press) })
          return el.Text({ key: segment.key, color: segment.color, bold: segment.bold ? true : undefined, wrap: isDesktop ? 'wrap' : undefined, children: segment.text })
        }),
      }),
    ),
  })

// A line's width in cells, as the terminal draws it.
/** @param {Line} one */
export const lineCells = one => one.segments.reduce((sum, segment) => sum + segmentCells(segment), 0)
