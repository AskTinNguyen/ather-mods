// @ts-check
// Ather Lanes: what the pane shows (D7, design.md), from the lane records and the held slots. Pure: the pane
// (pane.mjs) only draws what this returns. At rest: For you (each waiting decision under its lane), A look (one
// line per lane in trouble, its reasons worst first) and the fold (all lanes, the pool, the Editor's holder).
// Opened, the fold lists every lane one line each and the held slots.

import { ageText } from './ather/worklist.mjs'
import { plural } from './ather/model.mjs'
import { KIND_LANE_0, isPool, isPoolReady } from './sources.mjs'

/**
 * @typedef {import('./records.mjs').LaneRecord} LaneRecord
 * @typedef {import('./records.mjs').Decision} Decision
 * @typedef {import('./sources.mjs').Slot} Slot
 * @typedef {{ text: string, short: string }} Reason one trouble: its words in A look, and its short form in the opened fold
 * @typedef {{ ids: string[], label: string, holder: string, kind: string, until: string, pastMinutes: number, leftMinutes: number, waiting: string[] }} Hold
 *   one hold: a slot, or every slot a perf capture took (`label` "every slot"); `waiting`: the lanes that need it and hold none of its kind
 * @typedef {{ forYou: { lane: LaneRecord, decisions: Decision[] }[], look: { lane: LaneRecord, reasons: Reason[] }[], rows: LaneRecord[],
 *   pool: { ready: number, building: number }, count: number, holds: Hold[], editor: Hold | null }} Board
 */

// A lane this far behind `main` or more is worth a look (design.md: one constant in one place).
export const BEHIND_LIMIT = 25

// The kind of slot an id names ("light-1" is a light slot, whoever took it and why).
/** @param {string} id */
const slotKindOf = id => id.replace(/-\d+$/, '')

// "6m", "2h": a span of minutes in ageText's words.
/** @param {number} minutes */
const spanText = minutes => ageText(1, 1 + minutes * 60000)

// The Editor slot, in the words the board uses for a slot's kind.
/** @param {string} kind */
export const kindWord = kind => (kind === 'full' ? 'editor' : kind)

/** @param {readonly Slot[]} slots @param {readonly LaneRecord[]} records @returns {Hold[]} */
export const holdsOf = (slots, records) => {
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

// A lane that needs a slot kind no free slot of is left of: every one of its kind is held by another lane.
/** @param {LaneRecord} lane @param {readonly Slot[]} slots @param {Record<string, number> | null} counts */
const waitsFor = (lane, slots, counts) => {
  const need = lane.slotNeed
  if (need === '' || lane.slotHeld.some(slot => slotKindOf(slot.id) === need)) return []
  const others = slots.filter(slot => slotKindOf(slot.id) === need && slot.holder !== lane.name)
  // Unread counts: one slot of each kind, as the skill ships them for the Editor.
  return others.length >= (counts?.[need] ?? 1) && others.length > 0 ? [...new Set(others.map(slot => slot.holder))] : []
}

// A lane's reasons for A look, worst first; none for a pool lane (D7, design.md's list and nothing else).
/** @param {LaneRecord} lane @param {readonly Slot[]} slots @param {Record<string, number> | null} counts @param {Hold[]} holds @returns {Reason[]} */
export const reasonsOf = (lane, slots, counts, holds) => {
  if (isPool(lane.kind)) return []
  /** @type {Reason[]} */
  const reasons = []
  if (lane.pr && lane.pr.state === 'open' && lane.pr.checks === 'failing') reasons.push({ text: `#${lane.pr.number} checks failing`, short: 'checks failing' })
  if (lane.behind !== null && lane.behind >= BEHIND_LIMIT) reasons.push({ text: `${lane.behind} behind main`, short: `${lane.behind} behind main` })
  for (const hold of holds.filter(one => one.holder === lane.name && one.pastMinutes > 0)) reasons.push({ text: `${hold.kind === 'perf' ? 'perf hold on every slot' : hold.label} past its end ${spanText(hold.pastMinutes)}`, short: 'slot past its end' })
  const holders = waitsFor(lane, slots, counts)
  if (holders.length > 0) reasons.push({ text: `needs ${kindWord(lane.slotNeed)}, held by ${holders.join(', ')}`, short: `waits for ${kindWord(lane.slotNeed)}` })
  if (lane.kind === 'lane' && lane.sidecar === 'unregistered') reasons.push({ text: 'unregistered, so no intent or claims', short: 'unregistered' })
  return reasons
}

/** @param {readonly LaneRecord[]} records @param {readonly Slot[]} slots @param {Record<string, number> | null} counts @returns {Board} */
export const boardOf = (records, slots, counts) => {
  const holds = holdsOf(slots, records)
  const oldest = (/** @type {Decision[]} */ list) => Math.min(...list.map(one => one.since || Number.MAX_SAFE_INTEGER))
  const forYou = records
    .filter(lane => lane.decisions.length > 0)
    .map(lane => ({ lane, decisions: lane.decisions }))
    .sort((a, b) => oldest(a.decisions) - oldest(b.decisions) || a.lane.name.localeCompare(b.lane.name))
  const look = records.map(lane => ({ lane, reasons: reasonsOf(lane, slots, counts, holds) })).filter(one => one.reasons.length > 0)
  const quiet = records.filter(lane => !isPool(lane.kind))
  const pools = records.filter(lane => isPool(lane.kind))
  return {
    forYou,
    look,
    rows: [...quiet].sort((a, b) => Number(b.kind === KIND_LANE_0) - Number(a.kind === KIND_LANE_0) || a.name.localeCompare(b.name)),
    pool: { ready: pools.filter(lane => isPoolReady(lane.kind)).length, building: pools.filter(lane => !isPoolReady(lane.kind)).length },
    count: quiet.length,
    holds,
    editor: holds.find(hold => hold.ids.some(id => slotKindOf(id) === 'full')) ?? null,
  }
}

// ---------------------------------------------------------------- words

/** @param {{ ready: number, building: number }} pool */
export const poolText = pool => `${pool.ready} ready, ${pool.building} building`

// "34m left", "past its end 6m", '' when the end is unknown.
/** @param {Hold} hold */
export const timeText = hold => (hold.pastMinutes > 0 ? `past its end ${spanText(hold.pastMinutes)}` : hold.leftMinutes > 0 ? `${spanText(hold.leftMinutes)} left` : hold.until ? `until ${hold.until}` : '')

// The fold's line (design.md): how many lanes, the pool, and the Editor slot's holder with its time.
/** @param {Board} board */
export const foldText = board => {
  const editor = board.editor ? `Editor: ${board.editor.holder}${timeText(board.editor) ? `, ${timeText(board.editor).replace(/ left$/, '')}` : ''}` : 'Editor free'
  return `all ${plural(board.count, 'lane')} · pool ${poolText(board.pool)} · ${editor}`
}

// One held slot in the opened fold: holder, kind, time, and who waits for it.
/** @param {Hold} hold */
export const holdText = hold => [hold.holder, kindWord(hold.kind), timeText(hold), hold.waiting.length > 0 ? `then ${hold.waiting.join(', ')}` : ''].filter(Boolean).join(' · ')

// A lane's one phrase in the opened fold: its decisions, else its first reason, else nothing.
/** @param {LaneRecord} lane @param {Reason[]} reasons */
export const phraseOf = (lane, reasons) => (lane.decisions.length > 0 ? plural(lane.decisions.length, 'decision') : (reasons[0]?.short ?? ''))

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

// The opened lane's lines, in design.md's order: decisions, PR, main, slot, moved, lane.
/** @param {LaneRecord} lane @param {Hold[]} holds @param {number} now @returns {Detail[]} */
export const detailsOf = (lane, holds, now) => [
  ...(lane.decisions.length > 0 ? [...lane.decisions.map(one => ({ label: one.id, text: one.full || one.title })), { label: '', text: `answer them in the session that tracks ${lane.intent}` }] : []),
  { label: 'PR', text: prText(lane.pr), ...(lane.pr ? { link: lane.pr.url } : {}) },
  { label: 'main', text: mainText(lane) },
  { label: 'slot', text: slotText(lane, holds) },
  { label: 'moved', text: movedText(lane, now) },
  { label: 'lane', text: [lane.branch, lane.intentTitle ? `${lane.intent} (${lane.intentTitle})` : lane.intent, lane.tier, lane.path].filter(Boolean).join(' · ') },
]
