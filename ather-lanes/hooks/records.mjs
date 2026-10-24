// @ts-check
// Ather Lanes: the lane records (A1). One pure function turns what the sources gave (sources.mjs) into one record
// per worktree Status lists, in Status' order, its `kind` and `sidecar` as Status gave them. Nothing here decides
// what a lane is: the S2 scripts do (D2.1); a field no source gave is unknown (null), never guessed.

import { directorCalls, parseIntent } from './ather/model.mjs'
import { KIND_LANE_0, isPool, readLaneBeat, readSessionBeat } from './sources.mjs'

/**
 * @typedef {import('./sources.mjs').Status} Status
 * @typedef {import('./sources.mjs').Slot} Slot
 * @typedef {import('./sources.mjs').Beat} Beat
 * @typedef {import('./sources.mjs').Ref} Ref
 * @typedef {import('./sources.mjs').Pr} Pr
 * @typedef {import('./ather/model.mjs').Intent} Intent
 * @typedef {{ id: string, title: string, full: string, since: number }} Decision `since`: the date in its heading (ms), 0 for none
 * @typedef {{
 *   name: string, path: string, kind: string, sidecar: string, branch: string, head: string, isDetached: boolean, isMissing: boolean,
 *   intent: string, intentTitle: string, tier: string, slotNeed: string, slotHeld: Slot[],
 *   ahead: number | null, behind: number | null, lastCommit: number, mainMovedAt: number,
 *   beats: Beat[], lastMoved: { source: string, at: number } | null,
 *   pr: Pr | null | undefined, decisions: Decision[],
 * }} LaneRecord
 * `pr`: undefined while gh has not been read, null for no PR; `beats`: newest first; `lastMoved`: the newest of the
 * last commit and the beats, with its source.
 * @typedef {{
 *   status: Status | null, slots: readonly Slot[], laneBeats: ReadonlyMap<string, Beat>, sessionBeats: ReadonlyMap<string, Beat>,
 *   refs: ReadonlyMap<string, Ref> | null, prs: ReadonlyMap<string, Pr> | null, intents: ReadonlyMap<string, Intent | null>, mainMovedAt: number,
 * }} Sources
 * `sessionBeats` and `intents` are keyed by worktree path and lane name; an intent's null is a sidecar intent with no folder.
 */

/** A source that gave nothing: what a session with no machine folder, or before its first refresh, has. */
/** @type {Sources} */
export const NO_SOURCES = Object.freeze({ status: null, slots: [], laneBeats: new Map(), sessionBeats: new Map(), refs: null, prs: null, intents: new Map(), mainMovedAt: 0 })

// A lane's intent folder read through Ather's parser (D2.5); null when the sidecar names an intent with no folder
// (no prompt.md). The fields Ather's list reads from git (age, first author) have no meaning here.
/** @param {string} slug @param {{ prompt: string | null, progress: string | null, findings: string | null }} files @returns {Intent | null} */
export const intentOf = (slug, files) => (files.prompt === null ? null : parseIntent({ slug, prompt: files.prompt, progress: files.progress ?? '', findings: files.findings ?? '', files: [], hasDebrief: false, updatedAt: 0, source: 'local', firstAuthor: '' }))

// The heartbeats from their files' text (D2.2): each lane's `_machine` heartbeat by its name, and each worktree's
// newest Ather session heartbeat on its own branch, by its path.
/** @param {Status | null} status @param {ReadonlyMap<string, string | null>} laneTexts @param {ReadonlyMap<string, readonly (string | null)[]>} sessionTexts */
export const beatsOf = (status, laneTexts, sessionTexts) => {
  /** @type {Map<string, Beat>} */
  const laneBeats = new Map()
  /** @type {Map<string, Beat>} */
  const sessionBeats = new Map()
  for (const lane of status?.lanes ?? []) {
    const own = readLaneBeat(laneTexts.get(lane.name) ?? null)
    if (own) laneBeats.set(lane.name, own)
    const newest = (sessionTexts.get(lane.path) ?? []).map(text => readSessionBeat(text, lane.branch)).filter(/** @returns {one is Beat} */ one => one !== null).sort((a, b) => b.at - a.at)[0]
    if (newest) sessionBeats.set(lane.path, newest)
  }
  return { laneBeats, sessionBeats }
}

// "## F-2 (2026-10-24, rev 1) | ..." gives 2026-10-24; 0 for a heading with no date.
/** @param {string} source */
const sinceOf = source => {
  const day = /\((\d{4}-\d{2}-\d{2})\b/.exec(source.split(/\r?\n/)[0] ?? '')?.[1]
  const at = day ? Date.parse(`${day}T00:00:00Z`) : NaN
  return Number.isFinite(at) ? at : 0
}

/** @param {Intent | null | undefined} intent @returns {Decision[]} */
const decisionsOf = intent => directorCalls(intent ?? undefined).map(one => ({ id: one.id, title: one.title, full: one.full, since: sinceOf(one.source) }))

/** @param {Sources} sources @returns {LaneRecord[]} */
export const laneRecords = sources => {
  const lanes = sources.status?.lanes ?? []
  return lanes.map(lane => {
    const isDetached = lane.branch === '(detached)' || lane.branch === ''
    const ref = isDetached ? undefined : sources.refs?.get(lane.branch)
    const beats = [sources.laneBeats.get(lane.name), sources.sessionBeats.get(lane.path)].filter(/** @returns {one is Beat} */ one => one !== undefined).sort((a, b) => b.at - a.at)
    const lastCommit = ref?.committedAt ?? 0
    const newest = beats[0]
    const lastMoved = newest && newest.at > lastCommit ? { source: newest.source, at: newest.at } : lastCommit > 0 ? { source: 'last commit', at: lastCommit } : null
    const intent = sources.intents.get(lane.name)
    return {
      name: lane.name,
      path: lane.path,
      kind: lane.kind,
      sidecar: lane.sidecar,
      branch: lane.branch,
      head: lane.head,
      isDetached,
      isMissing: lane.missing,
      intent: lane.intent,
      intentTitle: intent?.title ?? '',
      tier: lane.tier,
      slotNeed: lane.slotNeed === 'none' ? '' : lane.slotNeed,
      slotHeld: sources.slots.filter(slot => slot.holder === lane.name),
      ahead: ref ? ref.ahead : null,
      behind: ref ? ref.behind : null,
      lastCommit,
      mainMovedAt: sources.mainMovedAt,
      beats,
      lastMoved,
      pr: isDetached ? null : sources.prs === null ? undefined : (sources.prs.get(lane.branch) ?? null),
      decisions: decisionsOf(intent),
    }
  })
}

// The branches the `for-each-ref` and gh ask about (D2.3, D2.4): every worktree's named branch but the pool's;
// gh leaves lane 0's out too (`head:main` matches every fork's main).
/** @param {Status | null} status @param {{ forPrs?: boolean }} [options] */
export const laneBranches = (status, { forPrs = false } = {}) => [
  ...new Set(
    (status?.lanes ?? [])
      .filter(lane => !isPool(lane.kind) && !(forPrs && lane.kind === KIND_LANE_0))
      .map(lane => lane.branch)
      .filter(branch => branch !== '' && branch !== '(detached)' && /^[\w./-]+$/.test(branch)),
  ),
]
