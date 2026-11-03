// Ather Automata: auto-track (docs/intent/auto-track). A session tracks the intent it works on by itself: a write
// into the intent's folder, by its main thread or a worker, or a commit whose message starts with `intent(<slug>)`.
// When such work may take the pin from another intent, and what the person is told. Pure: no `$`, no store (state.mjs
// autoTrack asks it, after its stops and the intent already tracked, and before what blocks one).

// How long the tracked intent must go without work from this session before work on another takes the pin.
export const AUTO_SWITCH_MS = 30 * 60 * 1000

/**
 * What the session's pin carries beside the intent (absent on a pin from before 0.7.0): when this session last
 * worked on it, and whether auto-track set it (a deliberate track is not auto: auto-untrack leaves it alone). An auto
 * pin also keeps its checkout's branch when it was taken (`branch`, '' unknown: auto-untrack reads the status only
 * on that branch) and the deliberate pin it replaced (`back`, put back when it is let go).
 * @typedef {{ at: number, isAuto: boolean, branch?: string, back?: { slug: string, root: string } }} PinMeta
 */

/**
 * Whether work on an intent that is not the tracked one may take the pin (what blocks the intent itself is
 * state.mjs's, read after this). Never while an away window runs (`isAway`: its mandate and ledger were set up for
 * the session's intent, and untrack is refused then); with no pin, yes; an intent this session just started
 * (`isNew`), yes; else once the tracked one has had no work from this session for AUTO_SWITCH_MS (a pin from before
 * 0.7.0 has no time and counts as idle).
 * @param {{ hasPin: boolean, meta: PinMeta | null, isAway: boolean, isNew: boolean, now: number }} at
 */
export const mayTake = ({ hasPin, meta, isAway, isNew, now }) => {
  if (isAway) return false
  if (!hasPin || isNew) return true
  return now - (meta?.at ?? 0) >= AUTO_SWITCH_MS
}

// What the person is told when auto-track takes an intent, and when auto-untrack lets one go (and which came back).
/** @param {string} slug */
export const autoTrackText = slug => `Now tracking ${slug}: this session works on it. /ather untrack stops that.`
/** @param {{ slug: string, back: string }} left */
export const autoUntrackText = ({ slug, back }) => `Stopped tracking ${slug}: it is completed or parked.${back ? ` Back to ${back}.` : ''}`
