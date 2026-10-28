// A5R rev 42 (L-46, the week's audit): two NEEDS A LOOK rows that carry the person's one press. A121 a lane that keeps
// coming back for the Editor is offered a Focus (85 of 137 leases were re-requests within 60 min, 74 of them re-launched
// the Editor, Focus was used 0 times); A122 a lease 30 min past its end while others wait is shown with its overrun and the
// waiters, with the person's release (breakable-authoring-toolset held 433 and 791 min against 45-60 asked while 20.5
// session-hours waited, and the judge called it working because an Editor ran). Pure: no `$`; register.ts draws the rows
// and runs the presses through the person's own paths (focus.ts applyFocus, order.ts applyOrder).
import { claimIn, isStandardHeld, livenessOf, type GrantInput, type LookRow, type SessionFile } from './coord.ts'
import { OVERRUN_WAIT_MS, isReturnAsk, queueView, type LeaseRecord } from './lease.ts'

const MIN = 60_000
/** The person's press a NEEDS A LOOK row carries. */
export type LookPress = NonNullable<LookRow['press']>

// ---------- A121: a lane that keeps coming back ----------
/** A lane is offered a Focus once it re-requested the Editor this many times within the window. */
export const COMEBACK_N = 3
export const COMEBACK_WINDOW_MS = 2 * 3_600_000
/** The box the offer gives (the person's one press: a Focus of 2 h). */
export const COMEBACK_BOX_MIN = 120

export type Comeback = { id8: string; lane: string; n: number; launches: number; leases: number }
/** How often this session's lane asked for the Editor again within 60 min of its own previous lease's end (A100's return),
 * counted when that re-request fell in the last 2 h: each finished lease of the lane in leases.jsonl (the sync's own slots
 * left out) and the request its file holds now; `launches` of the finished ones counted re-launched an Editor (no reused
 * pid). Null when the session asks for nothing now. */
export const comebackOf = (f: SessionFile, records: readonly LeaseRecord[], now: number): Comeback | null => {
  if (!f.want) return null
  const past = records.filter(r => r.lane === f.lane && r.endReason !== 'sync' && r.endAt <= now).sort((a, b) => a.endAt - b.endAt)
  const asks: { at: number | null; lease: LeaseRecord | null }[] = [...past.map(r => ({ at: r.requestedAt, lease: r })), { at: f.want.requestedAt, lease: null }]
  const again = asks.filter((a, i) => {
    const prev = past[i - 1]
    return prev !== undefined && a.at !== null && isReturnAsk(a.at, prev.endAt) && Math.max(a.at, prev.endAt) >= now - COMEBACK_WINDOW_MS
  })
  const leases = again.flatMap(a => (a.lease ? [a.lease] : []))
  return { id8: f.id8, lane: f.lane, n: again.length, launches: leases.filter(r => r.firstEditorSeenAt !== null && r.reusedPid === null).length, leases: leases.length }
}

/** NEEDS A LOOK's offer (at most one: the lane that came back most): a live session that knows Focus (0.25.0 or later),
 * asking for the Editor now, that re-requested it 3 or more times in 2 h; none while a Focus runs (one at a time). */
export const comebackLook = (x: { records: readonly LeaseRecord[]; files: readonly SessionFile[]; lanes: GrantInput['lanes']; now: number; isFocusRunning: boolean; titleOf: (id8: string) => string }): LookRow[] => {
  if (x.isFocusRunning) return []
  const best = x.files
    .filter(f => f.knowsFocus === true && livenessOf(f.id8, x.files, x.lanes, x.now) === 'alive')
    .flatMap(f => comebackOf(f, x.records, x.now) ?? [])
    .filter(c => c.n >= COMEBACK_N)
    .sort((a, b) => b.n - a.n || a.id8.localeCompare(b.id8))[0]
  if (!best) return []
  const how = best.leases > 0 && best.launches === best.leases ? 're-launching each time' : `${best.launches} Editor launch${best.launches === 1 ? '' : 'es'}`
  return [{ what: `${x.titleOf(best.id8) || best.lane} asked for the Editor ${best.n} times in 2 h (${how})`, next: 'Focus it for 2 h?', press: { kind: 'focus', id8: best.id8, label: 'Focus 2 h' } }]
}

// ---------- A122: an overrun while others wait ----------
/** NEEDS A LOOK for a standard lease 30 min or more past its end (as its HELD line says, a resize included) while anyone is
 * queued: who, how far over, what it asked, how many wait and the longest live wait (A125), with the person's release.
 * Never the claim's lease (a running Focus, the sync's own slot): those end by their own rules. */
export const overrunLook = (x: GrantInput & { titleOf: (id8: string) => string }): LookRow[] => {
  const view = queueView(x)
  const h = view.holder
  if (!h || h.end === null || h.isSyncSlot || !isStandardHeld(x.lock) || claimIn(x)?.id8 === h.id8) return []
  const over = x.now - h.end
  const waiting = view.rows.filter(r => r.id8 !== h.id8)
  if (over < OVERRUN_WAIT_MS || waiting.length === 0) return []
  const asked = x.files.find(f => f.id8 === h.id8)?.want?.minutes ?? (h.grantedAt === null ? null : Math.round((h.end - h.grantedAt) / MIN))
  const name = x.titleOf(h.id8) || h.lane
  const n = waiting.length
  return [
    {
      what: `${name} is ${Math.round(over / MIN)} min past its lease end${asked === null ? '' : ` (asked ${asked} min)`}, and ${n} session${n === 1 ? '' : 's'} wait${n === 1 ? 's' : ''} (the longest ${Math.max(...waiting.map(r => r.waitedMin))} min)`,
      next: 'release it if its Editor work is done (a running Editor alone is no work past the end; it was woken with the overrun), or give it more time on its row',
      press: { kind: 'release', id8: h.id8, label: 'Release' },
    },
  ]
}
