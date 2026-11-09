// a5r-hosts S-b: the probe-built host card (prompt.md "Data structures" 2, `source: "probe"`), written by the origin into
// its own Saved/A5R/hosts/<id>/card.json on the minute tick when the last one is older than `staleCardMin`. Built from a
// C1 probe, C10's RAM reading and an Editor-running read (the process list); a field that cannot be read is null (or
// `unknown`), never guessed. Card publishing by an A5R host itself is slice S-c. Pure.
import { callOp, type Adapter, type RemoteOs } from './adapters/types.ts'
import type { Availability, HostDecl } from './hosts.ts'
import { isObj } from './shape.ts'

export type HostCard = {
  v: 1
  at: number
  source: 'a5r' | 'probe'
  hostId?: string
  machine: { label?: string; os?: RemoteOs; freeRamGb: number | null; totalRamGb: number | null; freeDiskGb: number | null; engine?: string }
  editor: { holder: { lane: string; end: number } | null; queue: number; running: boolean | 'unknown' }
  availability: { state: 'yes' | 'no' | 'unknown'; reason?: string; until?: number }
  freeze: null | { kind: 'sync'; until?: number }
  lanes: { id: string; slug: string; state: 'idle' | 'busy'; branch?: string }[]
  jobs: { running: number; queued: number }
  account: { shared: 'yes' | 'no' | 'unknown' }
  skew: { ms: number | null }
}

export const parseCard = (raw: string | null): HostCard | null => {
  try {
    const v = JSON.parse(raw ?? '') as unknown
    return isObj(v) && v.v === 1 && typeof v.at === 'number' && isObj(v.machine) && isObj(v.editor) ? (v as HostCard) : null
  } catch {
    return null
  }
}
export const isStale = (card: HostCard | null, now: number, staleCardMin: number): boolean => !card || now - card.at > staleCardMin * 60_000

/** The Unreal Editor's process name on each OS. */
const EDITOR = /^UnrealEditor(\.exe)?$/i
/** Whether an Unreal Editor runs on the host, from its process list; `unknown` when the list cannot be read. */
export const editorRunning = async (a: Adapter, os: RemoteOs): Promise<boolean | 'unknown'> => {
  const r = await callOp(a, 'run', os === 'windows' ? ['tasklist', '/fo', 'csv', '/nh', '/fi', 'IMAGENAME eq UnrealEditor.exe'] : ['ps', '-A', '-o', 'comm='])
  if (!r.ok || r.value.exitCode !== 0) return 'unknown'
  return r.value.stdout.split(/\r?\n/).some(l => EDITOR.test((/^"([^"]*)"/.exec(l.trim())?.[1] ?? l.trim().split('/').pop() ?? '').trim()))
}

/** A probe card from what was read (null where it was not); availability is the declaration's `assumed` one, if any. */
export const probeCard = (id: string, decl: HostDecl, now: number, read: { os: RemoteOs | null; totalRamGb: number | null; freeRamGb: number | null; running: boolean | 'unknown'; skewMs?: number | null }): HostCard => {
  const assumed: Availability | undefined = decl.assumed?.availability
  return {
    v: 1,
    at: now,
    source: 'probe',
    hostId: id,
    machine: { label: decl.label, ...(read.os ? { os: read.os } : {}), freeRamGb: read.freeRamGb, totalRamGb: read.totalRamGb, freeDiskGb: null },
    editor: { holder: null, queue: 0, running: read.running },
    availability: assumed ? { state: assumed.state, ...(assumed.reason ? { reason: assumed.reason } : {}) } : { state: 'unknown' },
    freeze: null,
    lanes: [],
    jobs: { running: 0, queued: 0 },
    account: { shared: 'unknown' },
    skew: { ms: read.skewMs ?? null },
  }
}
