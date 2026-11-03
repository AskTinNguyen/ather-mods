// Ather Automata: auto-track (docs/intent/auto-track). A session tracks the intent it works on by itself: a write
// into the intent's folder, by its main thread or a worker, or a commit whose message starts with `intent(<slug>)`.
// When such work takes the pin from another intent, and what the person is told. Pure: no `$`, no store (state.mjs
// autoTrack asks it, after its stops, the intent already tracked, and what blocks one).

// How long the tracked intent must go without work from this session before work on another takes the pin.
export const AUTO_SWITCH_MS = 30 * 60 * 1000

// What the session's pin carries beside the intent: when this session last worked on it, and whether auto-track
// set it (a deliberate track is not auto: auto-untrack leaves it alone). Absent on a pin from before 0.7.0.
/** @typedef {{ at: number, isAuto: boolean }} PinMeta */

/**
 * Whether work on an intent that is not the tracked one takes the pin. Never one that is closed or another live
 * session tracks (`isBlocked`); with no pin, yes; never while an away window runs (`isAway`: its mandate and ledger
 * were set up for the tracked intent, as untrack is refused then); an intent this session just started (`isNew`),
 * yes; else once the tracked one has had no work from this session for AUTO_SWITCH_MS (a pin from before 0.7.0 has no
 * time and counts as idle).
 * @param {{ hasPin: boolean, meta: PinMeta | null, isBlocked: boolean, isAway: boolean, isNew: boolean, now: number }} at
 */
export const mayTake = ({ hasPin, meta, isBlocked, isAway, isNew, now }) => {
  if (isBlocked) return false
  if (!hasPin) return true
  if (isAway) return false
  return isNew || now - (meta?.at ?? 0) >= AUTO_SWITCH_MS
}

// What the person is told when auto-track takes an intent, and when auto-untrack lets one go.
/** @param {string} slug */
export const autoTrackText = slug => `Now tracking ${slug}: this session works on it. /ather untrack stops that.`
/** @param {string} slug */
export const autoUntrackText = slug => `Stopped tracking ${slug}: it is completed or parked.`
