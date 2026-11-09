// a5r-hosts S-c (D11): "this would fit better on another machine", a pure function of the request, this machine's
// facts and the hosts' cards. A trigger (RAM, LONG, READONLY_WAIT, FREEZE) makes a host that passes every check qualify;
// IDLE only joins a host that already qualifies (it never suggests alone: no nagging). The pick is the qualifying host
// with the most free RAM, ties by label. It only suggests: a hand-off is always an explicit call. Pure: no `$`.
import { isStale, type HostCard } from './hostcard.ts'
import type { HostsOptions } from './hosts.ts'
import { isStrs } from './shape.ts'

/** What is asked: an Editor request's facts, or the host tool's suggest inputs. */
export type SuggestRequest = { minutes: number; pie: boolean; build: boolean; readOnly?: boolean; needGb?: number; wants?: string[]; waitedMin?: number; editorHeldByOther?: boolean }
/** This machine now: free RAM (null: unread), the launch gates in force, the sync's cutoff-to-hard-end window if one is
 * open, and this machine's origin id (null until made). */
export type SuggestLocal = { now: number; freeGb: number | null; gates: { pieGb: number; nopieGb: number }; freeze: { from: number; to: number } | null; originId: string | null }
/** One declared host as read: its level (from its checks), the card stored for it, and whether the link is held (paused
 * or a storm: D16), which makes it unavailable whatever its card says. */
export type SuggestHost = { id: string; label: string; level: number; card: HostCard | null; isHeld?: boolean }
export type SuggestOptions = Pick<HostsOptions, 'longMinutes' | 'readOnlyWaitMin' | 'staleCardMin'>

export const REASONS = ['RAM', 'LONG', 'READONLY_WAIT', 'FREEZE', 'IDLE'] as const
export type Reason = (typeof REASONS)[number]
/** NO_ADAPTER_OP is slice S-d's (a hand-off needs an op the adapter lacks); suggest never says it. */
export const WHY_NOT = ['UNCHECKED', 'STALE_CARD', 'UNAVAILABLE', 'FROZEN', 'NO_ROLE', 'NO_TRUST', 'NO_RAM'] as const
export type WhyNot = (typeof WHY_NOT)[number]
export type Picked = { host: string; label: string; reasons: Reason[]; notes?: string[] }
export type Suggestion = { suggestion: 'none' | Picked; whyNot: { host: string; codes: WhyNot[]; notes?: string[] }[] }

/** The request fields an Editor request and the host tool's suggest share, read one way for both (the tool's values, or
 * the command's flags as text): a positive `needGb`, `readOnly`, the wanted roles (a list, or comma-separated text). */
export const askFields = (e: Record<string, unknown>): Pick<SuggestRequest, 'needGb' | 'readOnly' | 'wants'> => {
  const gb = Number(e.needGb)
  const wants = (isStrs(e.wants) ? e.wants : typeof e.wants === 'string' ? e.wants.split(',') : []).map(w => w.trim()).filter(Boolean)
  return { ...(e.needGb !== undefined && e.needGb !== '' && Number.isFinite(gb) && gb > 0 ? { needGb: gb } : {}), ...(e.readOnly === true || e.readOnly === 'true' ? { readOnly: true } : {}), ...(wants.length ? { wants } : {}) }
}

/** The RAM a request needs: its own figure, else the launch gate in force for it (with PIE or without). */
export const needOf = (r: SuggestRequest, local: SuggestLocal): number => r.needGb ?? (r.pie ? local.gates.pieGb : local.gates.nopieGb)

/** Why one host cannot take the request (in WHY_NOT's order) and what could not be read; with no code, the card and its
 * free RAM (`room`). With no card at all only UNCHECKED and STALE_CARD can be said. */
const judge = (h: SuggestHost, r: SuggestRequest, local: SuggestLocal, need: number, o: SuggestOptions): { codes: WhyNot[]; notes: string[]; room: { card: HostCard; free: number } | null } => {
  const head: WhyNot[] = [...(h.level < 1 ? (['UNCHECKED'] as const) : []), ...(isStale(h.card, local.now, o.staleCardMin) ? (['STALE_CARD'] as const) : [])]
  const c = h.card
  if (!c) return { codes: head, notes: [], room: null }
  const free = c.machine.freeRamGb
  const trust = c.acceptsFrom
  const onCard: [WhyNot, boolean][] = [
    ['UNAVAILABLE', c.availability.state === 'no' || h.isHeld === true],
    ['FROZEN', c.freeze !== null],
    ['NO_ROLE', (r.wants ?? []).some(w => !(c.roles ?? []).includes(w))],
    ['NO_TRUST', trust !== undefined && !trust.includes('*') && !(local.originId !== null && trust.includes(local.originId))],
    ['NO_RAM', free === null || free < need],
  ]
  const codes = [...head, ...onCard.filter(([, isSo]) => isSo).map(([k]) => k)]
  const notes = [...(trust === undefined ? ['trust unknown'] : []), ...(free === null ? ['RAM unknown'] : [])]
  return { codes, notes, room: codes.length === 0 && free !== null ? { card: c, free } : null }
}

/** D11: the suggestion and, per host that cannot take it, its why-not codes. */
export const suggest = (r: SuggestRequest, local: SuggestLocal, hosts: readonly SuggestHost[], o: SuggestOptions): Suggestion => {
  const need = needOf(r, local)
  const end = local.now + r.minutes * 60_000
  // The triggers, in REASONS' order. RAM's host side (free >= need) is NO_RAM's opposite, so a host that passes has it.
  const triggers: Reason[] = [
    ...(local.freeGb !== null && local.freeGb < need ? (['RAM'] as const) : []),
    ...(r.minutes >= o.longMinutes ? (['LONG'] as const) : []),
    ...(r.readOnly && r.editorHeldByOther && (r.waitedMin ?? 0) >= o.readOnlyWaitMin ? (['READONLY_WAIT'] as const) : []),
    ...(local.freeze && local.now < local.freeze.to && end > local.freeze.from ? (['FREEZE'] as const) : []),
  ]
  const whyNot: Suggestion['whyNot'] = []
  const fits: (Picked & { free: number })[] = []
  for (const h of hosts) {
    const { codes, notes, room } = judge(h, r, local, need, o)
    if (!room) {
      whyNot.push({ host: h.id, codes, ...(notes.length ? { notes } : {}) })
      continue
    }
    if (!triggers.length) continue // IDLE alone never suggests
    const idle = room.card.editor.running === false && room.card.editor.queue === 0
    fits.push({ host: h.id, label: h.label, reasons: [...triggers, ...(idle ? (['IDLE'] as const) : [])], ...(notes.length ? { notes } : {}), free: room.free })
  }
  const best = fits.sort((a, b) => b.free - a.free || a.label.localeCompare(b.label))[0]
  if (!best) return { suggestion: 'none', whyNot }
  const { free: _f, ...picked } = best
  return { suggestion: picked, whyNot }
}

/** The hint's words (D17): `fits <label> (<reasons>)`. */
export const fitsText = (p: Picked): string => `fits ${p.label} (${p.reasons.join(', ')})`
