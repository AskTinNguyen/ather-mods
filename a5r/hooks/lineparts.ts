// A28/A30: the compact line's parts (moved out of register.ts for a5r-hosts S-d, F-d4): the Editor holder and until, free
// RAM, main's behind count or the planned sync's time, and (a5r-hosts decision 4) a hand-off part only while a hand-off
// this session created needs a person (declined, failed, returned, lost, preempt). Pure: register.ts gives the facts and
// draws each icon through `mark` (its icon, colour and motion).
import { hhmm as clockOf, isOpenPhase, type Phase, type SyncFile } from './coord.ts'
import { STATUS } from './theme.ts'
import { editorTile, ramBand, type LinePart, type LockView } from './watch.ts'

/** What the line reads this render. `sync`: main's behind count (null: unknown; absent: not read yet). */
export type LineFacts = {
  lock: LockView | undefined
  me8: string
  nowMin: number
  place: string
  isMine: boolean
  justGranted: boolean
  stopped: number
  freeGb: number | undefined
  nopieGb: number
  syncFile: SyncFile | null
  phase: Phase
  /** The freeze's short countdown for an open sync (freezehost.ts shortNow). */
  shortNow: (s: SyncFile) => string
  behind: number | null | undefined
  ink: string
  /** a5r-hosts: hand-offs of this session that need a person, as one short value (e.g. `1 lost`); '' for none. */
  handoffs: string
}
/** One icon drawn: its name, colour, and the motion's key and signature (null: still; `running`: the frozen sweep). */
export type Mark = (name: 'editor' | 'memory' | 'branch', color: string, motion: { key: string; sig: string; color: string; running: boolean } | null) => unknown

export const lineParts = (f: LineFacts, mark: Mark): LinePart[] => {
  const t = editorTile({ lock: f.lock, me8: f.me8, nowMin: f.nowMin, place: f.place, waiting: 0 })
  const l = f.lock
  // A30: values only: the holder (★ for this session) and until; "free"; "?" for a missing lock.
  const editorName = !l || l.isMissing || l.isFree ? undefined : f.isMine ? '★' : (l.who ?? 'held')
  const editorValue = `${!l || l.isMissing ? '?' : l.isFree ? 'free' : l.until ? ` →${l.until}` : ''}${f.stopped > 0 ? ` · ${f.stopped} stopped` : ''}` // A139
  const editorWarn = t.dot === STATUS.bad || f.justGranted || !l || l.isMissing
  const free = f.freeGb
  const under = free !== undefined && (free < f.nopieGb || ramBand(free) !== 'ok')
  const open = f.syncFile && isOpenPhase(f.phase) ? f.syncFile : null
  // A30: main's behind count as −N (0 when level), or the planned sync's time (❄ in its freeze, ⚠ at its cutoff).
  const syncText = open ? `${clockOf(open.at)}${f.phase === 'frozen' ? ' ❄' : f.phase === 'cutoff' ? ' ⚠' : ''}${f.phase === 'planned' ? '' : ` ${f.shortNow(open)}`}` : f.behind === undefined ? '…' : f.behind === null ? '?' : f.behind > 0 ? `−${f.behind}` : '0'
  const syncWarn = Boolean(open && (f.phase === 'cutoff' || f.phase === 'frozen'))
  const tint = (warn: boolean, base: string) => (warn ? STATUS.warn : base)
  return [
    { key: 'editor', icon: mark('editor', tint(editorWarn, t.dot ?? f.ink), { key: 'editor', sig: `${t.value}|${t.dot}`, color: t.dot ?? f.ink, running: false }), ...(editorName ? { name: editorName } : {}), value: editorValue, isWarn: editorWarn },
    { key: 'memory', icon: mark('memory', tint(under, STATUS.ok), null), value: free === undefined ? '? GB' : `${free} GB${under ? ' ⚠' : ''}`, isWarn: under },
    { key: 'main', icon: mark('branch', tint(syncWarn, f.ink), { key: 'main', sig: syncText, color: f.ink, running: f.phase === 'frozen' }), value: syncText, isWarn: syncWarn },
    ...(f.handoffs ? [{ key: 'handoff', icon: mark('branch', STATUS.warn, null), value: f.handoffs, isWarn: true }] : []),
  ]
}
