// @ts-check
// Ather Lanes: what the pane shows (D7, design.md), from the lane records and the held slots. Pure: the pane
// (pane.mjs) only draws what this returns. At rest: For you (each waiting decision under its lane), A look (one
// line per lane in trouble, its reasons worst first) and the fold (all lanes, the pool, the Editor's holder).
// Opened, the fold lists every lane one line each and the held slots.

import { ageText } from './ather/worklist.mjs'
import { plural } from './ather/model.mjs'
import { KIND_LANE, KIND_LANE_0, isPool, isPoolReady } from './sources.mjs'

/**
 * @typedef {import('./records.mjs').LaneRecord} LaneRecord
 * @typedef {import('./records.mjs').Decision} Decision
 * @typedef {import('./sources.mjs').Slot} Slot
 * @typedef {{ text: string, short: string }} Reason one trouble: its words in A look, and its short form in the opened fold
 * @typedef {{ ids: string[], label: string, holder: string, kind: string, until: string, pastMinutes: number, leftMinutes: number, waiting: string[] }} Hold
 *   one hold: a slot, or every slot a perf capture took (`label` "every slot"); `waiting`: the lanes that need a slot of its
 *   kind and hold none (design.md: "needs a slot that another lane holds"; how many slots there are is F-8's to report)
 * @typedef {{ lane: LaneRecord, reasons: Reason[] }} Row
 * @typedef {{ forYou: { lane: LaneRecord, decisions: Decision[] }[], look: Row[], rows: Row[],
 *   pool: { ready: number, building: number }, count: number, holds: Hold[], editor: Hold | null, here: LaneRecord | null }} Board
 *   `rows`: every lane but the pool's, lane 0 first, then this session's lane, then by name (D10); `look`: those of them
 *   with a reason, in Status' order; `here`: this session's lane, null for none
 */

// A lane this far behind `main` or more is worth a look (design.md: one constant in one place).
export const BEHIND_LIMIT = 25

// The kind of slot an id names ("light-1" is a light slot, whoever took it and why).
/** @param {string} id */
const slotKindOf = id => id.replace(/-\d+$/, '')

// "6m", "2h", "3d": a span of minutes, in the steps Ather's ages take (worklist.mjs ageText).
/** @param {number} minutes */
export const minutesText = minutes => (minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`)

// The Editor slot, in the words the board uses for a slot's kind.
/** @param {string} kind */
export const kindWord = kind => (kind === 'full' ? 'editor' : kind)

// The held slots, a perf capture's as one hold, each with the lanes that wait for it: the one place that rule lives.
/** @param {readonly Slot[]} slots @param {readonly LaneRecord[]} records @returns {Hold[]} */
const holdsOf = (slots, records) => {
  /** @type {Hold[]} */
  const holds = []
  for (const slot of [...slots].sort((a, b) => a.id.localeCompare(b.id))) {
    const perf = slot.kind === 'perf' ? holds.find(one => one.kind === 'perf' && one.holder === slot.holder) : undefined
    if (perf) perf.ids.push(slot.id)
    else holds.push({ ids: [slot.id], label: slot.kind === 'perf' ? 'every slot' : slot.id, holder: slot.holder, kind: slot.kind || slotKindOf(slot.id), until: slot.until, pastMinutes: slot.pastMinutes, leftMinutes: slot.leftMinutes, waiting: [] })
  }
  for (const hold of holds) {
    const kinds = new Set(hold.ids.map(slotKindOf))
    hold.waiting = records.filter(one => one.name !== hold.holder && kinds.has(one.slotNeed) && !one.slotHeld.some(slot => slotKindOf(slot.id) === one.slotNeed)).map(one => one.name)
  }
  return holds
}

// A lane's reasons for A look, worst first (D7, design.md's list and nothing else); none for a pool lane.
/** @param {LaneRecord} lane @param {readonly Hold[]} holds @returns {Reason[]} */
const reasonsOf = (lane, holds) => {
  if (isPool(lane.kind)) return []
  /** @type {Reason[]} */
  const reasons = []
  if (lane.pr && lane.pr.state === 'open' && lane.pr.checks === 'failing') reasons.push({ text: `#${lane.pr.number} checks failing`, short: 'checks failing' })
  if (lane.behind !== null && lane.behind >= BEHIND_LIMIT) reasons.push({ text: `${lane.behind} behind main`, short: `${lane.behind} behind main` })
  for (const hold of holds.filter(one => one.holder === lane.name && one.pastMinutes > 0)) reasons.push({ text: `${hold.kind === 'perf' ? 'perf hold on every slot' : hold.label} past its end ${minutesText(hold.pastMinutes)}`, short: 'slot past its end' })
  const holders = [...new Set(holds.filter(hold => hold.waiting.includes(lane.name)).map(hold => hold.holder))]
  if (holders.length > 0) reasons.push({ text: `needs ${kindWord(lane.slotNeed)}, held by ${holders.join(', ')}`, short: `waits for ${kindWord(lane.slotNeed)}` })
  if (lane.kind === KIND_LANE && lane.sidecar === 'unregistered') reasons.push({ text: 'unregistered, so no intent or claims', short: 'unregistered' })
  return reasons
}

// The opened fold's order (D10): lane 0, then this session's lane, then the rest.
/** @param {LaneRecord} lane @param {string} hereName */
const rankOf = (lane, hereName) => (lane.kind === KIND_LANE_0 ? 0 : hereName !== '' && lane.name === hereName ? 1 : 2)

/** @param {readonly LaneRecord[]} records @param {readonly Slot[]} slots @param {string} [hereName] this session's lane (records.mjs laneOf), '' for none @returns {Board} */
export const boardOf = (records, slots, hereName = '') => {
  const holds = holdsOf(slots, records)
  const oldest = (/** @type {Decision[]} */ list) => Math.min(...list.map(one => one.since || Number.MAX_SAFE_INTEGER))
  const forYou = records
    .filter(lane => lane.decisions.length > 0)
    .map(lane => ({ lane, decisions: lane.decisions }))
    .sort((a, b) => oldest(a.decisions) - oldest(b.decisions) || a.lane.name.localeCompare(b.lane.name))
  const lanes = records.filter(lane => !isPool(lane.kind)).map(lane => ({ lane, reasons: reasonsOf(lane, holds) }))
  const pools = records.filter(lane => isPool(lane.kind))
  return {
    forYou,
    look: lanes.filter(one => one.reasons.length > 0),
    rows: [...lanes].sort((a, b) => rankOf(a.lane, hereName) - rankOf(b.lane, hereName) || a.lane.name.localeCompare(b.lane.name)),
    pool: { ready: pools.filter(lane => isPoolReady(lane.kind)).length, building: pools.filter(lane => !isPoolReady(lane.kind)).length },
    count: lanes.length,
    holds,
    editor: holds.find(hold => hold.ids.some(id => slotKindOf(id) === 'full')) ?? null,
    here: hereName === '' ? null : (records.find(lane => lane.name === hereName) ?? null),
  }
}

// ---------------------------------------------------------------- words

// The quiet mark on this session's lane (D10).
export const HERE = 'this session'

/** @param {Board} board @param {LaneRecord} lane */
export const isHere = (board, lane) => board.here?.name === lane.name

// The section a lane is first listed in (For you, A look, else the opened fold), for lanes_open (D9); null for a lane
// the board does not list (an unknown name, a pool lane).
/** @param {Board} board @param {string} name @returns {'you' | 'look' | 'fold' | null} */
export const sectionOf = (board, name) => {
  const listed = (/** @type {{ lane: LaneRecord }[]} */ rows) => rows.some(one => one.lane.name === name)
  return listed(board.forYou) ? 'you' : listed(board.look) ? 'look' : listed(board.rows) ? 'fold' : null
}

/** @param {Board} board */
export const decisionCount = board => board.forYou.reduce((sum, one) => sum + one.decisions.length, 0)

// The status line (D8): this session's lane, then For you's and A look's counts, each only when not zero.
/** @param {Board} board */
export const lineText = board => {
  const decisions = decisionCount(board)
  return [whereText(board.here), decisions > 0 ? `◆ ${decisions} for you` : '', board.look.length > 0 ? `${board.look.length} to look at` : ''].filter(Boolean).join(' · ')
}

// Where this session is, in the status line's and the summary's words.
/** @param {LaneRecord | null} lane */
const whereText = lane => (lane === null ? 'not in a lane' : lane.kind === KIND_LANE_0 ? 'lane 0' : `lane ${lane.name}`)

/** @param {{ ready: number, building: number }} pool */
export const poolText = pool => `${pool.ready} ready, ${pool.building} building`

// "34m left", "past its end 6m", '' when the end is unknown.
/** @param {Hold} hold */
export const timeText = hold => (hold.pastMinutes > 0 ? `past its end ${minutesText(hold.pastMinutes)}` : hold.leftMinutes > 0 ? `${minutesText(hold.leftMinutes)} left` : hold.until ? `until ${hold.until}` : '')

// The fold's line (design.md): how many lanes, the pool, and the Editor slot's holder with its time.
/** @param {Board} board */
export const foldText = board => {
  const editor = board.editor ? `Editor: ${board.editor.holder}${timeText(board.editor) ? `, ${timeText(board.editor).replace(/ left$/, '')}` : ''}` : 'Editor free'
  return `all ${plural(board.count, 'lane')} · pool ${poolText(board.pool)} · ${editor}`
}

// One held slot in the opened fold: holder, kind, time, and who waits for it.
/** @param {Hold} hold */
export const holdText = hold => [hold.holder, kindWord(hold.kind), timeText(hold), hold.waiting.length > 0 ? `then ${hold.waiting.join(', ')}` : ''].filter(Boolean).join(' · ')

// A lane's one phrase in the opened fold: its decisions, else its first reason, else nothing (F-10: in ink).
/** @param {Row} row */
export const phraseOf = ({ lane, reasons }) => (lane.decisions.length > 0 ? plural(lane.decisions.length, 'decision') : (reasons[0]?.short ?? ''))

// The glyph before a lane in the opened fold: lane 0, a registered lane, any other worktree.
/** @param {LaneRecord} lane */
export const glyphOf = lane => (lane.kind === KIND_LANE_0 ? '◆' : lane.sidecar === 'registered' ? '●' : '○')

// ---------------------------------------------------------------- an opened lane (D4: its order)

/** @typedef {{ label: string, text: string, link?: string }} Detail */

/** @param {import('./sources.mjs').Pr | null | undefined} pr */
const prText = pr => (pr === undefined ? 'not read yet' : pr === null ? 'none yet' : `#${pr.number} ${pr.isDraft ? 'draft' : pr.state}${pr.checks === 'none' ? '' : ` · checks ${pr.checks}`}`)

/** @param {LaneRecord} lane */
const mainText = lane => {
  if (lane.isDetached) return 'detached, no count'
  if (lane.behind === null || lane.ahead === null) return 'not read yet'
  return `${lane.behind === 0 ? 'up to date' : `${lane.behind} behind`}${lane.ahead > 0 ? ` · ${lane.ahead} ahead` : ''}`
}

/** @param {LaneRecord} lane @param {Hold[]} holds */
const slotText = (lane, holds) => {
  const mine = holds.filter(hold => hold.holder === lane.name)
  const held = mine.map(hold => `${hold.kind === 'perf' ? 'perf hold on every slot' : `holds ${hold.label}`}${timeText(hold) ? ` · ${timeText(hold)}` : ''}`)
  const need = lane.slotNeed ? `needs ${kindWord(lane.slotNeed)}` : 'needs none'
  const blocking = mine.length === 0 && lane.slotNeed ? holds.filter(hold => hold.waiting.includes(lane.name)).map(hold => `${hold.label} held by ${hold.holder}${timeText(hold) ? `, ${timeText(hold)}` : ''}`) : []
  return [...held, need, ...blocking].join(' · ')
}

/** @param {LaneRecord} lane @param {number} now */
const movedText = (lane, now) => {
  const parts = [...lane.beats.map(beat => ({ label: beat.source, at: beat.at, state: beat.state })), ...(lane.lastCommit ? [{ label: 'last commit', at: lane.lastCommit, state: '' }] : [])].sort((a, b) => b.at - a.at)
  const words = parts.map(one => `${one.label} ${ageText(one.at, now) || '0m'} ago${one.state ? ` (${one.state})` : ''}`)
  return [...words, ...(lane.beats.length === 0 ? ['no heartbeat here'] : [])].join(' · ')
}

// The register line an unregistered worktree's owner copies (design.md); the scripts write the sidecar, never the mod.
/** @param {LaneRecord} lane */
export const registerLine = lane => `lanes.ps1 -Action Register -Name ${lane.name} -Intent <slug> -Tier <T0|T1|T2>`

// The lane's decisions, full titles, and where to answer them; none for a lane with none.
/** @param {LaneRecord} lane @returns {Detail[]} */
const decisionDetails = lane => (lane.decisions.length > 0 ? [...lane.decisions.map(one => ({ label: one.id, text: one.full || one.title })), { label: '', text: `answer them in the session that tracks ${lane.intent}` }] : [])

// The lane's own lines: PR, main, slot, moved, lane (this session's marked, D10).
/** @param {LaneRecord} lane @param {Board} board @param {number} now @returns {Detail[]} */
export const laneDetails = (lane, board, now) => [
  { label: 'PR', text: prText(lane.pr), ...(lane.pr ? { link: lane.pr.url } : {}) },
  { label: 'main', text: mainText(lane) },
  { label: 'slot', text: slotText(lane, board.holds) },
  { label: 'moved', text: movedText(lane, now) },
  { label: 'lane', text: [isHere(board, lane) ? HERE : '', lane.branch, lane.intentTitle ? `${lane.intent} (${lane.intentTitle})` : lane.intent, lane.tier, lane.path].filter(Boolean).join(' · ') },
]

// The opened lane's lines, in design.md's order: decisions, PR, main, slot, moved, lane.
/** @param {LaneRecord} lane @param {Board} board @param {number} now @returns {Detail[]} */
export const detailsOf = (lane, board, now) => [...decisionDetails(lane), ...laneDetails(lane, board, now)]

// ---------------------------------------------------------------- the summary a tool gives (D9)

// lanes_summary's text: this session's lane with its details (the opened lane's lines), then every For you and A
// look item, or "Nothing needs you."; `readAt`: when git and gh were last read (the PR and behind-main reasons), null
// for never.
/** @param {Board} board @param {{ now: number, readAt: number | null, clock: (ms: number) => string }} at */
export const summaryText = (board, { now, readAt, clock }) => {
  const { here } = board
  const lines = [`This session: ${whereText(here)}${here?.sidecar === 'unregistered' ? `, unregistered (register it with: ${registerLine(here)})` : ''}.`]
  if (here) lines.push(...laneDetails(here, board, now).map(one => `  ${one.label}: ${one.text}`))
  if (board.forYou.length > 0) {
    lines.push('', `For you (${plural(decisionCount(board), 'decision')}):`)
    for (const { lane, decisions } of board.forYou) for (const call of decisions) lines.push(`- ${lane.name} ${call.id}: ${call.full || call.title}`)
  }
  if (board.look.length > 0) {
    lines.push('', `A look (${plural(board.look.length, 'lane')}):`)
    for (const { lane, reasons } of board.look) lines.push(`- ${lane.name}: ${reasons.map(one => one.text).join(' · ')}`)
  }
  if (board.forYou.length === 0 && board.look.length === 0) lines.push('', 'Nothing needs you.')
  lines.push('', `${foldText(board)}.`, readAt === null ? 'PR checks and behind-main counts are not read yet: the pane reads them while it is open.' : `PR checks and behind-main counts as of ${clock(readAt)}.`, 'The pane: /lanes, or the lanes_open tool.')
  return lines.join('\n')
}
