// a5r-hosts S-a (L0): the host side of hand-offs and claims on closures (no `$`: register.ts hands it this session's
// facts once and the engine's file reads, writes and git per call, as freezehost.ts does). The model tool `host` (only its
// handoff actions in this slice), `/a5r handoff`, the claim check at the edit, the pane's rows and status.json's list.
import { DIR, noticeText } from './coord.ts'
import { CLAIM_GATE, claimedBy, claimsOf, claimsText, claimWhy, exclusiveGlobs } from './claims.ts'
import { HANDOFFS_DIR, HANDOFF_GATE, HANDOFF_USAGE, ORIGIN_FILE, checkBase, fieldsOf, fieldsProblem, handoffId, handoffLine, isOpen, newHandoff, parseHandoff, parseHandoffCommand, resultKindOf, statusRows, writeProblem, type Handoff, type RecordFields } from './handoff.ts'
import type { Recorded } from './acts.ts'
import type { FileIo } from './hostio.ts'
import type { StatusHandoff } from './syncplan.ts'
import { STATUS, V2 } from './theme.ts'

export const HOST_TOOL = 'mcp__a5r__host'
/** The calls' io: the engine's files and git, the claimExclusiveGlobs and originId options and the rules' secret patterns. */
export type DeskIo = FileIo & { claimGlobs?: string; originId?: string; secrets: () => Promise<readonly string[]> }
/** This session's facts as register.ts last read them. */
export type DeskState = { dir: () => string; root: () => string; me8: () => string; lane: () => string }
/** One recorded action (acts.ts Recorded, before its time and session are added). */
export type ClaimTouch = Omit<Recorded, 'at' | 'id8' | 'lane'> & { kind: 'claim-touch' }

/** Actions a later slice adds: answered, never thrown. */
export const NOT_YET = { packet: noticeText('host', 'not in this version', 'slice S-d adds the hand-off packet') }
type El = { Box: (p: Record<string, unknown>) => unknown; Text: (p: Record<string, unknown>) => unknown }

export const handoffDesk = (h: DeskState) => {
  let all: Handoff[] = [] // the hand-off files as last read (the minute, a call, an edit)
  const folder = () => `${h.dir()}/${HANDOFFS_DIR}`
  const pathOf = (id: string) => `${folder()}/${id}.json`

  /** Every hand-off file here; a missing folder is none (A1: nothing changes without one). */
  const read = async (io: FileIo): Promise<Handoff[]> => {
    const names = (await io.list(folder())).map(f => f.name).filter(n => n.endsWith('.json'))
    all = (await Promise.all(names.map(async n => parseHandoff(await io.read(`${folder()}/${n}`))))).filter((x): x is Handoff => x !== null).sort((a, b) => a.createdAt - b.createdAt)
    return all
  }

  /** F4: this machine's origin id: the option `originId` when set, else the one made once (8 hex) beside the hand-offs;
   * null when neither exists yet. */
  const knownOrigin = async (io: DeskIo): Promise<string | null> => {
    if (io.originId?.trim()) return io.originId.trim()
    try {
      const id = (JSON.parse((await io.read(`${h.dir()}/${ORIGIN_FILE}`)) ?? '') as { originId?: unknown }).originId
      return typeof id === 'string' && /^[0-9a-f]{8}$/.test(id) ? id : null
    } catch {
      return null // none yet
    }
  }
  const originId = async (io: DeskIo): Promise<string> => {
    const known = await knownOrigin(io)
    if (known) return known
    const path = `${h.dir()}/${ORIGIN_FILE}`
    const id = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    await io.write(path, JSON.stringify({ v: 1, originId: id }))
    return id
  }

  /** The one writer (D5): checked by writeProblem, then written; the refusal, or null once written. */
  const write = async (io: DeskIo, prev: Handoff | null, next: Handoff): Promise<string | null> => {
    const bad = writeProblem(prev, next, await originId(io), await io.secrets())
    if (bad) return noticeText(HANDOFF_GATE, ...bad)
    await io.write(pathOf(next.id), JSON.stringify(next))
    await read(io)
    return null
  }

  const find = async (io: FileIo, id: string): Promise<Handoff | null> => (await read(io)).find(x => x.id === id.trim()) ?? null
  const missing = (id: string) => noticeText(HANDOFF_GATE, `no hand-off ${id} here`, 'list them (handoff list) and name one by its id')

  const record = async (io: DeskIo, f: RecordFields): Promise<string> => {
    const globs = exclusiveGlobs(io.claimGlobs)
    const bad = fieldsProblem(f, globs)
    if (bad) return noticeText(HANDOFF_GATE, ...bad)
    const base = await checkBase(args => io.run(['git', '-C', h.root(), ...args], 30_000), { remote: f.remote, ref: f.base, sha: f.sha })
    if ('why' in base) return noticeText(HANDOFF_GATE, ...base.why)
    const from = await originId(io)
    const now = await io.now()
    const ids = new Set((await read(io)).map(x => x.id))
    let n = 1
    while (ids.has(handoffId(from, now, n))) n += 1
    const next = newHandoff(f, { id: handoffId(from, now, n), from, by: { id8: h.me8(), lane: h.lane() }, sha: base.sha, now, globs })
    return (await write(io, null, next)) ?? `A5R · hand-off recorded: ${handoffLine(next)}. Its claims hold for every session here until it is cancelled or merged.`
  }

  const change = async (io: DeskIo, id: string, edit: (x: Handoff, now: number) => Handoff, done: (x: Handoff) => string): Promise<string> => {
    const prev = await find(io, id)
    if (!prev) return missing(id)
    const next = edit(prev, await io.now())
    return (await write(io, prev, next)) ?? done(next)
  }
  const cancel = (io: DeskIo, id: string) => change(io, id, (x, now) => ({ ...x, state: 'cancelled', updatedAt: now }), x => `A5R · hand-off ${x.id} cancelled: its claims are released.`)
  const result = (io: DeskIo, id: string, ref: string) =>
    change(io, id, (x, now) => ({ ...x, result: { ...x.result, kind: resultKindOf(ref), ref }, updatedAt: now }), x => `A5R · hand-off ${x.id}: result ${ref} recorded (${x.result.kind}); its claims hold until it is merged or cancelled.`)
  const list = async (io: FileIo): Promise<string> => {
    const xs = await read(io)
    return xs.length ? ['Hand-offs here (newest last):', ...xs.map(handoffLine)].join('\n') : `No hand-offs here. Record one with ${HANDOFF_USAGE.split(' · ')[0]}`
  }

  /** The tool's `update`: label, task, note, claims, or state merged once a result is in (base and branch stay: D7). */
  const update = async (io: DeskIo, e: Record<string, unknown>): Promise<string> => {
    const prev = await find(io, String(e.id ?? ''))
    if (!prev) return missing(String(e.id ?? ''))
    const globs = exclusiveGlobs(io.claimGlobs)
    const f = fieldsOf({ ...e, label: e.label ?? prev.host, task: e.task ?? prev.task, claims: e.claims ?? prev.claims })
    const bad = fieldsProblem(f, globs)
    if (bad) return noticeText(HANDOFF_GATE, ...bad)
    const now = await io.now()
    const next: Handoff = { ...prev, host: f.label, task: f.task, claims: claimsOf(f.claims, globs).claims, ...(f.note ? { note: f.note } : {}), ...(e.state === 'merged' ? { state: 'merged' as const } : {}), updatedAt: now }
    return (await write(io, prev, next)) ?? `A5R · hand-off updated: ${handoffLine(next)}`
  }

  return {
    read,
    origin: knownOrigin,
    /** The open hand-offs as last read. */
    open: (): Handoff[] => all.filter(isOpen),
    /** `/a5r handoff …` */
    command: async (io: DeskIo, args: string): Promise<string> => {
      const c = parseHandoffCommand(args)
      if (!c) return noticeText(HANDOFF_GATE, `"${args.trim()}" is not a handoff command`, HANDOFF_USAGE)
      if (c.op === 'list') return list(io)
      if (c.op === 'cancel') return cancel(io, c.id)
      if (c.op === 'result') return result(io, c.id, c.ref)
      return record(io, c.fields)
    },
    /** The host tool's action `handoff` (create, update, cancel, result, list); hostdesk.ts routes the other actions. */
    tool: async (io: DeskIo, e: Record<string, unknown>): Promise<string> => {
      const op = String(e.op ?? 'list')
      if (op === 'list') return list(io)
      if (op === 'create') return record(io, fieldsOf(e))
      if (op === 'cancel') return cancel(io, String(e.id ?? ''))
      if (op === 'result') return result(io, String(e.id ?? ''), String(e.ref ?? ''))
      if (op === 'update') return update(io, e)
      if (op === 'packet') return NOT_YET.packet
      return noticeText(HANDOFF_GATE, `"${op}" is not a handoff op`, 'use create, update, cancel, result or list')
    },
    /** D9 at the edit: the shared checkout's repo-relative paths an edit writes. A hand-off file written by hand, or a
     * path inside another hand-off's exclusive claim, refuses it; a path inside a shared claim is recorded. */
    touch: async (io: FileIo, rels: readonly string[]): Promise<{ deny?: string; shared: ClaimTouch[] }> => {
      if (rels.length === 0) return { shared: [] }
      if (rels.some(r => r.toLowerCase().startsWith(`${DIR}/${HANDOFFS_DIR}/`.toLowerCase()) || r.toLowerCase() === `${DIR}/${ORIGIN_FILE}`.toLowerCase()))
        return { deny: noticeText(HANDOFF_GATE, `${DIR}/${HANDOFFS_DIR} is written by a5r alone (one writer)`, 'use /a5r handoff or the host tool (action handoff)'), shared: [] }
      const xs = await read(io)
      const hits = rels.map(rel => ({ rel, hit: claimedBy(rel, xs, h.me8()) }))
      const excl = hits.find(x => x.hit?.claim.exclusive)
      if (excl?.hit) return { deny: noticeText(CLAIM_GATE, ...claimWhy(excl.rel, excl.hit)), shared: [] }
      return { shared: hits.flatMap(({ rel, hit }) => (hit ? [{ kind: 'claim-touch' as const, rule: 'claim-touch' as const, path: rel, target: rel, root: h.root(), why: `shared claim ${hit.claim.path} of hand-off ${hit.id} on ${hit.host}` }] : [])) }
    },
    /** D17 in S-a: status.json's `handoffs`, only while one is open (A1: absent otherwise). */
    status: (): StatusHandoff[] | undefined => {
      const rows = statusRows(all)
      return rows.length ? rows : undefined
    },
  }
}

const age = (ms: number): string => (ms < 60 * 60_000 ? `${Math.max(0, Math.round(ms / 60_000))}m` : ms < 48 * 60 * 60_000 ? `${Math.round(ms / (60 * 60_000))}h` : `${Math.round(ms / (24 * 60 * 60_000))}d`)

/** D17 in S-a: one compact row group on the pane, only while a hand-off is open (no tile). */
export const handoffBox = (el: El, open: readonly Handoff[], now: number, look: { ink: string; quiet: string }): unknown =>
  el.Box({
    key: 'hai-handoffs',
    flexDirection: 'column',
    width: '100%',
    marginTop: 1,
    children: [
      el.Box({ key: 'hai-handoffs-head', children: [el.Text({ color: V2.label, children: `HAND-OFFS · ${open.length} OPEN` })] }),
      ...open.map(x =>
        el.Box({
          key: `hai-handoff-${x.id}`,
          flexDirection: 'row',
          width: '100%',
          columnGap: 1,
          children: [
            el.Box({ key: `hai-handoff-${x.id}-dot`, flexShrink: 0, children: [el.Text({ color: x.claims.some(c => c.exclusive) ? STATUS.warn : STATUS.ok, children: '●' })] }),
            el.Box({ key: `hai-handoff-${x.id}-what`, flexShrink: 1, flexGrow: 1, minWidth: 0, children: [el.Text({ color: look.ink, wrap: 'truncate-end', children: `${x.host} · ${x.intent.branch ?? x.base.ref} · ${claimsText(x.claims)}` })] }),
            el.Box({ key: `hai-handoff-${x.id}-age`, flexShrink: 0, children: [el.Text({ color: look.quiet, children: age(now - x.createdAt) })] }),
          ],
        }),
      ),
    ],
  })
