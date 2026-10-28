// A116 (rev 40): the A5R panel's one Editor list (the holder, then the queue in the order every session computes, lease.ts
// queueView), the other sessions (coord.ts sessionsView without the list's rows) and NEEDS A LOOK, as Hai's approved mockup
// (2026-10-22) lays them out: rows named by the app's titles, reasons in plain words, never the queue's codes. Pure: no
// `$`; watch.ts draws them, register.ts reads the files.
import { appTitleOf, claimIn, hhmm, sessionsView, ymd, type AppFacts, type GrantInput, type LookRow, type Phase, type SessionsView } from './coord.ts'
import type { Verdict, VerdictRow } from './judge.ts'
import { focusHead } from './focus.ts'
import { holderLine, leftText, queuedLine, queueView, todayLine, type LeaseSummary } from './lease.ts'

/** One row of the Editor list: its mark (▶ the holder, the place, ★ with the place for this session), its name, one
 * quiet line. */
export type EditorRow = { id8: string; mark: string; name: string; isMe: boolean; isHolder: boolean; line: string }
/** `isFocus`: a Focus runs (A118: its head, the person's controls on the head line, no row controls for its holder). */
export type EditorList = { head: string; rows: EditorRow[]; today: string; isFocus: boolean }

/** The panel's two lists from what every session reads: the Editor list (the holder and the queue in the order every
 * session computes, A117's order included) and the other sessions (sessionsView without the Editor list's rows); the
 * Editor list's rows are named by the app's titles (appTitleOf), else their lanes. */
export const editorPanel = (x: { grant: GrantInput; app: AppFacts; phase: Phase; summary: LeaseSummary }): { list: EditorList; others: SessionsView } => {
  const view = queueView(x.grant)
  const inEditor = new Set([...(view.holder ? [view.holder.id8] : []), ...view.rows.map(r => r.id8)])
  const titleOf = appTitleOf(x.app)
  const h = view.holder
  const focus = claimIn(x.grant)?.kind === 'focus' ? x.grant.focus : null // A118: the EDITOR line's head names the Focus while it runs
  const holder: EditorRow[] = h ? [{ id8: h.id8, mark: '▶', name: `${titleOf(h.id8) || h.lane}${h.isMe ? ' ★' : ''}`, isMe: h.isMe, isHolder: true, line: holderLine(h) }] : []
  const queued = view.rows.map((r): EditorRow => ({ id8: r.id8, mark: r.isMe ? `★${r.place}` : String(r.place), name: titleOf(r.id8) || r.lane, isMe: r.isMe, isHolder: false, line: queuedLine(r) }))
  return {
    list: { head: focus ? focusHead(focus, titleOf) : h ? [`${h.lane} has it`, leftText(h)].filter(Boolean).join(' · ') : 'free', rows: [...holder, ...queued], today: todayLine(x.summary), isFocus: focus !== null },
    others: sessionsView({ ...x.app, lanes: x.grant.lanes, sync: x.grant.sync, phase: x.phase, inEditor }),
  }
}

/** A117: the list as `/a5r editor` answers it. */
export const listText = (list: EditorList, usage: string): string => [`A5R · Editor · ${list.head}`, ...list.rows.map(r => `${r.mark} ${r.name} · ${r.line}`), ...(list.today ? [list.today] : []), usage].join('\n')

/** A65 / A89: a verdict's time, with its date when it is not today. */
const verdictTime = (at: number, now: number): string => (ymd(at) === ymd(now) ? hhmm(at) : `${ymd(at)} ${hhmm(at)}`)

/** A116: the verdicts that need the person: a holder likely stuck, or one waiting for his answer. */
const NEEDS_PERSON: readonly Verdict[] = ['stuck-or-crashed', 'waiting-on-Hai']
/** NEEDS A LOOK: the current verdicts that need the person (at most three), each its one-line reason and next step; none
 * means the block is left out (`working`, `done`, `unsure` stay in /a5r status and orchestrate.log). */
export const needsLook = (current: readonly VerdictRow[], now: number): LookRow[] =>
  current
    .filter(r => NEEDS_PERSON.includes(r.verdict))
    .slice(0, 3)
    .map(r => ({ what: `${verdictTime(r.at, now)} ${r.lane || r.id8}: ${r.evidence || 'no evidence given'}, ${r.verdict === 'stuck-or-crashed' ? 'likely stuck' : 'waiting for your answer'}`, next: r.recommendation }))
