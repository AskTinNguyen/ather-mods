// The panel's overview of the sessions on this machine (A16, A127), moved out of coord.ts in rev 45. Pure: no `$`.
import { CLIENT_ACTIVE_MS, HEARTBEAT_STALE_MS, LANE_STALE_MS, hhmm, isOpenPhase, queueIn, type ClientRow, type LaneBeat, type LockLine, type ManualOrder, type Phase, type SessionFile, type SyncFile, type FocusLease, type NoMod } from './coord.ts'

export type Overview = { active: number | null; s2: number; elsewhere: number | null; intents: [string, number][]; editor: string; waiting: string[]; sync: string; withoutMod: NoMod[] }

/** Live S2 sessions that run without a5r 0.4: a fresh Ather lane whose a5r session file is missing or as stale as a gone lane (A127: 10 min, not 3). */
export const withoutModOf = (me8: string, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): NoMod[] => {
  const fresh = new Set(files.filter(f => now - f.heartbeatAt <= LANE_STALE_MS).map(f => f.id8))
  return lanes
    .filter(l => !l.hasEnded && now - l.mtimeMs <= LANE_STALE_MS)
    .map(l => ({ sessionId: l.sessionId, id8: l.sessionId.slice(0, 8).toLowerCase(), intent: l.intent || 'no intent', branch: l.branch ?? '' }))
    .filter(l => l.id8 !== me8 && !fresh.has(l.id8))
}

/** What the panel says about the sessions on this machine: how many run (the client's list), how many in S2 (Ather's
 * lanes and a5r's files), by intent, who holds or waits for the Editor, who holds the sync, and the live S2
 * sessions without a5r 0.4. */
export const overviewOf = (x: { me8: string; files: readonly SessionFile[]; lanes: readonly LaneBeat[]; clients: readonly ClientRow[] | null; isS2Cwd: (cwd: string) => boolean; lock: LockLine; sync: SyncFile | null; now: number; phase: Phase; manual: ManualOrder; focus: FocusLease | null }): Overview => {
  const { now } = x
  const liveLanes = x.lanes.filter(l => !l.hasEnded && now - l.mtimeMs <= LANE_STALE_MS)
  const ids = new Set<string>([x.me8, ...liveLanes.map(l => l.sessionId.slice(0, 8).toLowerCase()), ...x.files.filter(f => now - f.heartbeatAt <= HEARTBEAT_STALE_MS).map(f => f.id8)].filter(Boolean))
  const intentOf = (id8: string) => liveLanes.find(l => l.sessionId.toLowerCase().startsWith(id8))?.intent || 'no intent'
  const counts = new Map<string, number>()
  for (const id8 of ids) counts.set(intentOf(id8), (counts.get(intentOf(id8)) ?? 0) + 1)
  const active = x.clients?.filter(r => !r.isArchived && (r.isRunning || now - r.lastActivityAt <= CLIENT_ACTIVE_MS)) ?? null
  const laneOf = (id8: string) => x.files.find(f => f.id8 === id8)?.lane ?? id8
  const editor = x.lock.kind === 'free' ? 'free' : x.lock.kind === 'missing' ? 'lock missing' : `${x.lock.lane || 'held'}${x.lock.id8 === x.me8 ? ' (this session)' : ''}`
  return {
    active: active ? active.length + 1 : null, // the list leaves out the session reading it
    s2: ids.size,
    elsewhere: active ? active.filter(r => !x.isS2Cwd(r.cwd)).length : null,
    intents: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    editor,
    waiting: queueIn(x).map(f => laneOf(f.id8)),
    sync: x.sync && isOpenPhase(x.phase) ? `${x.sync.holder.id8 === x.me8 ? 'this session' : x.sync.holder.lane} ${hhmm(x.sync.at)} ${x.phase}` : 'none',
    withoutMod: withoutModOf(x.me8, x.files, x.lanes, now),
  }
}

/** The overview in one line (the terminal) or the same words wrapped (the desktop). */
export const overviewLine = (o: Overview): string =>
  [
    o.active === null ? `Sessions: S2 ${o.s2} live (client list unavailable)` : `Sessions: ${o.active} active · S2 ${o.s2} · elsewhere ${o.elsewhere ?? 0}`,
    o.intents.length ? `by intent: ${o.intents.map(([i, n]) => `${i} ${n}`).join(', ')}` : '',
    `Editor: ${o.editor}${o.waiting.length ? ` (waiting: ${o.waiting.join(', ')})` : ''}`,
    `Sync: ${o.sync}`,
    o.withoutMod.length ? `without a5r 0.4: ${o.withoutMod.map(n => `${n.intent} (session ${n.id8})`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

