// a5r-hosts S-b: a host's state (prompt.md "Data structures" 1b, D20) and its link record (D16). State lives in
// `<coordinationRoot>/Saved/A5R/hosts/<id>/state.json` (one per machine, D19, shared by every checkout of it), written
// only by the host tool; the level is derived from the checks (`levelOf`), never edited. `link.jsonl` holds the link's
// failures and successes; the backoff and the storm cap are pure functions of it. A storm, once seen, is kept in
// state.json (`link.state`) and holds until `/a5r host resume`. Pure: no `$`.
import { noticeText } from './coord.ts'
import { isObj } from './shape.ts'
import type { LinkPolicy } from './adapters/types.ts'

export const HOSTS_DIR = 'hosts'
export const CHECK_IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13'] as const
export type CheckId = (typeof CHECK_IDS)[number]
/** `ms`: the number a check measured, kept beside its text (C4: the skew, host minus here; S-c reads it for card
 * freshness, never the text). */
export type CheckResult = { status: 'pass' | 'fail' | 'skip'; value?: string; checkedAt: number; ms?: number }
export type Checks = Partial<Record<CheckId, CheckResult>>
export type HostState = {
  v: 1
  checks: Checks
  level: 0 | 1 | 2
  /** The sum of the declaration the checks ran against (hosts.ts sumOf): a changed declaration is re-checked. */
  declSum?: string
  os?: { os: 'windows' | 'posix'; shell: 'cmd' | 'sh' | 'other' }
  engineDetected?: string
  labSizeGb?: number
  pausedUntil?: number
  pauseReason?: string
  /** Section 1b's link fields: `failures` is the count that set off the storm (0 without one), `minutes` its window, for
   * the refusal; `windowStart` is the last resume (failures before it are not counted). */
  link: { failures: number; windowStart: number; state?: 'link-storm'; minutes?: number }
}
/** `pausedUntil` of a host paused by hand: until `/a5r host resume`. */
export const UNTIL_RESUMED = Number.MAX_SAFE_INTEGER
export const blankState = (): HostState => ({ v: 1, checks: {}, level: 0, link: { failures: 0, windowStart: 0 } })

export const statePath = (root: string, id: string): string => `${root}/${HOSTS_DIR}/${id}/state.json`
export const linkPath = (root: string, id: string): string => `${root}/${HOSTS_DIR}/${id}/link.jsonl`
export const cardPath = (root: string, id: string): string => `${root}/${HOSTS_DIR}/${id}/card.json`

export const parseState = (raw: string | null): HostState => {
  let v: unknown
  try {
    v = JSON.parse(raw ?? '')
  } catch {
    return blankState()
  }
  if (!isObj(v) || v.v !== 1) return blankState()
  const checks: Checks = {}
  if (isObj(v.checks))
    for (const id of CHECK_IDS) {
      const c = v.checks[id]
      if (isObj(c) && (c.status === 'pass' || c.status === 'fail' || c.status === 'skip') && typeof c.checkedAt === 'number') checks[id] = { status: c.status, checkedAt: c.checkedAt, ...(typeof c.value === 'string' ? { value: c.value } : {}), ...(typeof c.ms === 'number' && Number.isFinite(c.ms) ? { ms: c.ms } : {}) }
    }
  const link = isObj(v.link) ? v.link : {}
  const os = isObj(v.os) && (v.os.os === 'windows' || v.os.os === 'posix') && (v.os.shell === 'cmd' || v.os.shell === 'sh' || v.os.shell === 'other') ? ({ os: v.os.os, shell: v.os.shell } as NonNullable<HostState['os']>) : undefined
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
  return {
    v: 1,
    checks,
    level: v.level === 1 || v.level === 2 ? v.level : 0,
    ...(typeof v.declSum === 'string' ? { declSum: v.declSum } : {}),
    ...(os ? { os } : {}),
    ...(typeof v.engineDetected === 'string' ? { engineDetected: v.engineDetected } : {}),
    ...(num(v.labSizeGb) !== undefined ? { labSizeGb: num(v.labSizeGb) } : {}),
    ...(num(v.pausedUntil) !== undefined ? { pausedUntil: num(v.pausedUntil) } : {}),
    ...(typeof v.pauseReason === 'string' ? { pauseReason: v.pauseReason } : {}),
    link: { failures: typeof link.failures === 'number' ? link.failures : 0, windowStart: typeof link.windowStart === 'number' ? link.windowStart : 0, ...(link.state === 'link-storm' ? { state: 'link-storm' as const, minutes: typeof link.minutes === 'number' ? link.minutes : 10 } : {}) },
  }
}

/** Whether a check stands as passed: passed, and not older than `staleMs`. */
export const passed = (checks: Checks, id: CheckId, now: number, staleMs: number): boolean => checks[id]?.status === 'pass' && now - (checks[id]?.checkedAt ?? 0) <= staleMs

/** Prompt.md "Health checks": L1 = C1 and C2 pass (and C4 when availability windows are used); L2 adds C3, C7, C8, C9,
 * C12 (and C11 when a role builds). A check older than `staleMs` (or run against another declaration) counts as not
 * passed, which lowers the level without deleting the host (D14). */
export const levelOf = (checks: Checks, o: { now: number; staleMs: number; windows?: boolean; builds?: boolean; fresh?: boolean }): 0 | 1 | 2 => {
  if (o.fresh === false) return 0
  const pass = (id: CheckId) => passed(checks, id, o.now, o.staleMs)
  const l1: CheckId[] = ['C1', 'C2', ...(o.windows ? (['C4'] as const) : [])]
  if (!l1.every(pass)) return 0
  const l2: CheckId[] = ['C3', 'C7', 'C8', 'C9', 'C12', ...(o.builds ? (['C11'] as const) : [])]
  return l2.every(pass) ? 2 : 1
}

/** One line of link.jsonl: a link use that failed (its code) or worked. */
export type LinkLine = { at: number; ok: boolean; op: string; code?: string }
export const parseLink = (raw: string | null): LinkLine[] =>
  (raw ?? '').split(/\r?\n/).flatMap(l => {
    try {
      const v = JSON.parse(l) as unknown
      return isObj(v) && typeof v.at === 'number' && typeof v.ok === 'boolean' ? [{ at: v.at, ok: v.ok, op: String(v.op ?? ''), ...(typeof v.code === 'string' ? { code: v.code } : {}) }] : []
    } catch {
      return []
    }
  })
/** The file after one more line (the last 200 kept). */
export const linkText = (lines: readonly LinkLine[], add: LinkLine): string => `${[...lines, add].slice(-200).map(l => JSON.stringify(l)).join('\n')}\n`

export const STORM_WINDOW_MS = 10 * 60_000
export const STORM_COUNT = 12
export type LinkNow = { failures10: number; failuresHour: number; storm: { count: number; minutes: number } | null; retryAt: number }
/** D16 over link.jsonl since the last resume (`since`): failures in 10 min and in the hour, the storm (12 in 10 min, or
 * more than the adapter's hourly cap), and the backoff's next allowed try after consecutive failures. */
export const linkNow = (lines: readonly LinkLine[], now: number, since: number, p: LinkPolicy): LinkNow => {
  const xs = lines.filter(l => l.at >= since && l.at <= now)
  const fails = (ms: number) => xs.filter(l => !l.ok && now - l.at < ms).length
  const failures10 = fails(STORM_WINDOW_MS)
  const failuresHour = fails(60 * 60_000)
  const storm = failures10 >= STORM_COUNT ? { count: failures10, minutes: 10 } : failuresHour > p.maxReconnectsPerHour ? { count: failuresHour, minutes: 60 } : null
  let run = 0
  for (let i = xs.length - 1; i >= 0 && !xs[i]?.ok; i--) run++
  const last = xs[xs.length - 1]
  const retryAt = run > 0 && last ? last.at + Math.min(p.maxMs, p.minMs * p.factor ** (run - 1)) : 0
  return { failures10, failuresHour, storm, retryAt }
}

/** D16's refusal, verbatim. */
export const stormText = (id: string, s: { count: number; minutes: number }): string => noticeText(`host ${id}`, `link failed ${s.count} times in ${s.minutes} min`, `fix the link (C2), then /a5r host resume ${id}`)
export const pausedText = (id: string, reason: string): string => noticeText(`host ${id}`, `paused${reason ? ` (${reason})` : ''}`, `/a5r host resume ${id} when it should be used again`)

/** D16 and a pause together: whether a host may be used now, and the refusal when not. A storm on file holds until a
 * resume; one the link record shows now is a storm too (the caller keeps it: `stormed`). */
export type HostPhase = { kind: 'ok' } | { kind: 'paused' | 'storm'; text: string }
export const hostPhase = (id: string, st: HostState, lines: readonly LinkLine[], now: number, p: LinkPolicy): HostPhase => {
  if (st.link.state === 'link-storm') return { kind: 'storm', text: stormText(id, { count: st.link.failures, minutes: st.link.minutes ?? 10 }) }
  if (st.pausedUntil && st.pausedUntil > now) return { kind: 'paused', text: pausedText(id, st.pauseReason ?? '') }
  const storm = linkNow(lines, now, st.link.windowStart, p).storm
  return storm ? { kind: 'storm', text: stormText(id, storm) } : { kind: 'ok' }
}
/** The state with a storm kept (D16: the host pauses past the cap). */
export const stormed = (st: HostState, storm: { count: number; minutes: number }): HostState => ({ ...st, link: { ...st.link, state: 'link-storm', failures: storm.count, minutes: storm.minutes } })
