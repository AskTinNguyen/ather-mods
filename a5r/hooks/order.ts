// A117 (rev 40): the person's own hold on the Editor queue: the order he set and the minutes he gave, kept in the shared
// Saved/A5R/queue-order.json, which every session reads, so every session computes the same queue (coord.ts queueOf and
// decide read it as a ManualOrder); and the end he gives a holder's lease, written into its HELD line. Only a person
// changes either, through whichever session's A5R he presses or types in: a press on the A5R panel or an `/a5r editor …`
// command of his own. The editor tool has no such action and a model's edit of the file is refused (register.ts). Pure:
// no `$`.
import { READERS, isAbs, isDotNetWrite, norm, placeTracker, programs, writeDestinations, writesFiles } from './a5r.ts'
import { claimIn, freeLine, hash, heldLineAt, hhmm, isStandardHeld, livenessOf, noticeText, oneLine, phaseIn, queueOf, syncLimit, type GrantInput, type ManualOrder, type Notice, type SessionFile, type Want } from './coord.ts'
import { queueView, type HolderRow } from './lease.ts'

export const ORDER_FILE = 'queue-order.json'
/** An entry lasts at most this long, whatever its request does. */
export const ORDER_KEEP_MS = 12 * 3_600_000
/** The minutes a queued request may be given (as the editor tool's request: 5-180). */
export const SIZE_MIN = 5
export const SIZE_MAX = 180
/** A holder's lease, resized, ends at least 5 min from now and at most 12 h after its grant (the line says HH:MM). */
export const LEFT_MIN = 5
export const LEASE_MAX_MS = 12 * 3_600_000
/** A change is told to the sessions it moved within an hour (a session reloaded later does not hear an old one). */
const TELL_WITHIN_MS = 60 * 60_000
const CHANGES_KEEP = 10
const MIN = 60_000

/** The request an entry lasts for: that session's request asked at `requestedAt` (A104: a kept place is another turn). */
export type Turn = { id8: string; requestedAt: number; isKept: boolean }
export type Placed = Turn & { at: number; by: string }
export type Sized = Placed & { minutes: number }
/** One change of the order, for the sessions it moved (each tells itself once). */
export type OrderChange = { at: number; by: string; what: string; moved: string[] }
export type QueueOrder = { v: 1; placed: Placed[]; sized: Sized[]; changes: OrderChange[] }
export const NO_ORDER: QueueOrder = { v: 1, placed: [], sized: [], changes: [] }
type Entries = Pick<QueueOrder, 'placed' | 'sized'>

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const turnFrom = (v: Record<string, unknown>): Placed | null =>
  typeof v.id8 === 'string' && isNum(v.requestedAt) && isNum(v.at) ? { id8: v.id8.toLowerCase(), requestedAt: v.requestedAt, isKept: v.isKept === true, at: v.at, by: String(v.by ?? '') } : null

/** The file as written, each entry read field by field (a half write or another version's entry is skipped). */
export const parseOrder = (text: string | null): QueueOrder => {
  try {
    const v = JSON.parse(text ?? '') as Record<string, unknown>
    const list = (k: string): Record<string, unknown>[] => (Array.isArray(v[k]) ? (v[k] as unknown[]).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object') : [])
    return {
      v: 1,
      placed: list('placed').flatMap(x => turnFrom(x) ?? []),
      sized: list('sized').flatMap(x => {
        const t = turnFrom(x)
        return t && isNum(x.minutes) ? [{ ...t, minutes: x.minutes }] : []
      }),
      changes: list('changes').flatMap(x => (isNum(x.at) && typeof x.what === 'string' && Array.isArray(x.moved) ? [{ at: x.at, by: String(x.by ?? ''), what: x.what, moved: x.moved.map(String) }] : [])),
    }
  } catch {
    return NO_ORDER
  }
}

const turnOf = (id8: string, w: Want): Turn => ({ id8, requestedAt: w.requestedAt, isKept: w.isKept === true })
/** An entry lasts while its session still asks with the same request, 12 h at most: its turn ends with that request (the
 * lease it was granted released, the request withdrawn, or a forced release's kept place, which is a new turn). */
const lasts = (e: Placed, files: readonly SessionFile[], now: number): boolean =>
  now - e.at < ORDER_KEEP_MS && files.some(f => f.id8 === e.id8 && f.want?.requestedAt === e.requestedAt && (f.want.isKept === true) === e.isKept)

/** The order as the queue reads it: the entries whose requests still last. */
export const manualOf = (o: QueueOrder, files: readonly SessionFile[], now: number): ManualOrder => ({
  pins: o.placed.filter(p => lasts(p, files, now)).map(p => p.id8),
  minutes: Object.fromEntries(o.sized.filter(s => lasts(s, files, now)).map(s => [s.id8, s.minutes])),
})

// ---------- what the person asks ----------
export type Move = 'up' | 'down' | 'top'
/** `add`: minutes more (or fewer); `set`: minutes in all (a queued request) or minutes left (the holder). */
export type TimeChange = { add: number } | { set: number }
/** `who`: the row a panel press was on (its id8), or the name the person typed (an app title, lane or id8: pickByName). */
export type Who = { id8: string } | { name: string }
export type OrderAction = { kind: 'move'; how: Move; who: Who } | { kind: 'time'; who: Who; change: TimeChange } | { kind: 'reset' } | { kind: 'release'; who: Who } // release: Fable review S3
/** What one action changes: the order file (a move, a queued request's minutes, a reset), or the holder's HELD line (a
 * resize: its new line; the holder adopts its end and tells itself, lease.ts adoptLockEnd); `text` says it. */
export type OrderResult = { refusal: string } | { kind: 'order'; order: QueueOrder; moved: string[]; text: string } | { kind: 'resize'; line: string; text: string } | { kind: 'free'; line: string; holder: HolderRow; text: string }
/** The press's own facts: who pressed (for the record: "the person (panel in <lane>)"), and the app's titles. */
export type Presser = { by: string; titleOf: (id8: string) => string }

export const ORDER_GATE = 'Editor order'
const refuse = (why: string, next: string): { refusal: string } => ({ refusal: noticeText(ORDER_GATE, why, next) })

/** The result of one action of the person's on the queue every session computes from `g` (its files, lanes, sync and
 * lock), or why not. A move pins the queue's new prefix through the farthest row it changed (and every row pinned before
 * it), so the rows below stay first-asked-first-served; a time change on a queued request is kept here (never in that
 * session's own file); a time change on the holder gives its HELD line a new end. Each order change names the sessions
 * it moved. */
export const applyOrder = (g: GrantInput, order: QueueOrder, a: OrderAction, p: Presser): OrderResult => {
  const idsWith = (o: Entries): string[] => queueOf(g.files, g.lanes, g.now, claimIn(g), manualOf({ v: 1, ...o, changes: [] }, g.files, g.now)).map(f => f.id8)
  const before = idsWith(order)
  const live: Entries = { placed: order.placed.filter(e => lasts(e, g.files, g.now)), sized: order.sized.filter(e => lasts(e, g.files, g.now)) }
  const done = (o: Entries, what: string, moved: string[]): OrderResult => ({
    kind: 'order',
    order: { v: 1, ...o, changes: [...order.changes.filter(c => g.now - c.at < ORDER_KEEP_MS), { at: g.now, by: p.by, what, moved }].slice(-CHANGES_KEEP) },
    moved,
    text: `${what} (by ${p.by})`,
  })
  const movedBy = (o: Entries): string[] => idsWith(o).filter((id, i) => before.indexOf(id) !== i)
  if (a.kind === 'reset') {
    if (live.placed.length === 0 && live.sized.length === 0) return refuse('the queue has no order or minutes set by hand', 'nothing to reset: it is first asked, first served')
    const o = { placed: [], sized: [] }
    return done(o, 'the queue is first asked, first served again (the order and minutes set by hand are cleared)', [...new Set([...movedBy(o), ...live.sized.map(s => s.id8)])])
  }
  const holder = queueView(g).holder
  const laneOf = (id8: string) => g.files.find(f => f.id8 === id8)?.lane ?? (holder?.id8 === id8 ? holder.lane : id8)
  const rows = [...(holder ? [holder.id8] : []), ...before]
  const picked = 'id8' in a.who ? a.who : pickByName(a.who.name, rows.map(id8 => ({ id8, names: [p.titleOf(id8), laneOf(id8), id8] })))
  if ('refusal' in picked) return picked
  const { id8 } = picked
  const name = p.titleOf(id8) || laneOf(id8)
  if (holder?.id8 === id8) {
    if (a.kind === 'move') return refuse(`${name} holds the Editor, so it has no place in the queue`, 'move a queued session, or give the holder more time')
    return a.kind === 'release' ? release(g, holder, name, p) : resize(g, holder, name, a.change, p)
  }
  if (a.kind === 'release') return refuse(`${name} does not hold the Editor`, 'release the holder (the ▶ row)')
  const i = before.indexOf(id8)
  const f = g.files.find(x => x.id8 === id8)
  if (i < 0 || !f?.want) return refuse(`${name} is not in the Editor queue`, 'pick a queued session (the A5R panel lists them)')
  if (a.kind === 'time') {
    const was = live.sized.find(s => s.id8 === id8)?.minutes ?? f.want.minutes
    const next = Math.max(SIZE_MIN, Math.min(SIZE_MAX, 'add' in a.change ? was + a.change.add : a.change.set))
    if (next === was) return refuse(`${name} already asks ${was} min${'add' in a.change ? ` (${SIZE_MIN}-${SIZE_MAX})` : ''}`, 'nothing to change')
    const o = { placed: live.placed, sized: [...live.sized.filter(s => s.id8 !== id8), { ...turnOf(id8, f.want), at: g.now, by: p.by, minutes: next }] }
    return done(o, `${name} gets ${next} min when it is granted (it asked ${f.want.minutes})`, [id8])
  }
  const to = a.how === 'top' ? 0 : a.how === 'up' ? i - 1 : i + 1
  if (to < 0 || to >= before.length || to === i) return refuse(`${name} is already ${a.how === 'down' ? 'last' : 'first'} in the queue`, 'nothing to move')
  const moved = [...before]
  moved.splice(i, 1)
  moved.splice(to, 0, id8)
  const pinnedBefore = Math.max(0, ...live.placed.map(e => before.indexOf(e.id8) + 1))
  const placed: Placed[] = []
  for (const q of moved.slice(0, Math.max(i, to, pinnedBefore - 1) + 1)) {
    const had = live.placed.find(e => e.id8 === q)
    const w = g.files.find(x => x.id8 === q)?.want
    if (q !== id8 && had) placed.push(had)
    else if (w) placed.push({ ...turnOf(q, w), at: g.now, by: p.by })
  }
  // Fable review D2: a placed session not in the queue this minute keeps its entry unchanged, after the new prefix (it comes
  // back after the rows placed now)
  placed.push(...live.placed.filter(e => !before.includes(e.id8)))
  const o = { placed, sized: live.sized }
  const place = idsWith(o).indexOf(id8) + 1
  const syncFirst = place - 1 > to ? `; ${g.sync?.holder.lane ?? 'the sync holder'} stays first while its sync is in its cutoff or freeze` : ''
  return done(o, `${name} moved ${a.how === 'top' ? 'to the top of' : `${a.how} in`} the Editor queue: now ${place} of ${before.length}${syncFirst}`, movedBy(o))
}

/** The holder's HELD line with its new end, or why not: a hand-written line (its own A5R turns it into a standard line
 * first), the sync's own slot (it ends with the sync), another session's sync in its cutoff or freeze (the Editor is the
 * sync's), an end past a planned sync's cutoff, under 5 min from now or 12 h past its grant. No cap of the editor tool
 * applies (the one-extension limit, the 45-min build window, A113's 30-min pass): those bound a model's extend, not the
 * person. */
const resize = (g: GrantInput, h: HolderRow, name: string, c: TimeChange, p: Presser): OrderResult => {
  const claim = claimIn(g)
  if (claim?.kind === 'focus' && claim.id8 === h.id8) return refuse(`${name} holds the Editor for a Focus until ${hhmm(claim.end)}`, 'the Focus box is the person\'s: +30 / +60 or End on the panel\'s EDITOR line, or /a5r focus +30|+60|end') // A118
  if (!isStandardHeld(g.lock)) return refuse(`${name}'s lock line is not a standard HELD line naming one session`, 'its holder\'s A5R turns it into one at its next request; resize it then')
  if (livenessOf(h.id8, g.files, g.lanes, g.now) === 'gone') return refuse(`${name}: its session is gone`, 'its lease lapses by itself once nothing runs')
  if (h.isSyncSlot) return refuse(`${name} holds the Editor for the sync, and that slot ends with the sync`, 'move the sync or end it with the sync tool')
  const was = h.end ?? g.now
  const end = 'add' in c ? Math.max(was, g.now) + c.add * MIN : g.now + c.set * MIN
  const limit = syncLimit(g.sync, phaseIn(g), h.id8, end)
  if (limit) return refuse(`${name}: ${limit.why}`, limit.kind === 'claim' ? `the Editor is the sync's: ${name} releases it by ${hhmm(limit.releaseBy)}; give it time after the sync` : 'move the sync first, or give less time')
  if (end < g.now + LEFT_MIN * MIN) return refuse(`${name}'s lease would end at ${hhmm(end)}, under ${LEFT_MIN} min from now`, 'let it release instead')
  if (end - (h.grantedAt ?? g.now) > LEASE_MAX_MS) return refuse(`${name}'s lease would run past 12 h from its grant`, 'give less time')
  if (Math.floor(end / MIN) === Math.floor(was / MIN)) return refuse(`${name}'s lease already ends at ${hhmm(was)}`, 'nothing to change') // the line says whole minutes
  return { kind: 'resize', line: heldLineAt(g.lock, end), text: `${name}'s lease now ends at ${hhmm(end)} (it ended at ${hhmm(was)}) (by ${p.by})` }
}

/** Fable review S3: the person frees a holder's lock past its lease's end (a live session that keeps it idle is never lapsed:
 * S2 §2): the FREE line, or why not: a running Focus (its End is the person's), the sync's own slot (it ends with the sync), a
 * hand-written line, a lease that has not ended. */
const release = (g: GrantInput, h: HolderRow, name: string, p: Presser): OrderResult => {
  const claim = claimIn(g)
  if (claim?.kind === 'focus' && claim.id8 === h.id8) return refuse(`${name} holds the Editor for a Focus until ${hhmm(claim.end)}`, 'end the Focus first (End on the panel\'s EDITOR line, or /a5r focus end)')
  if (h.isSyncSlot) return refuse(`${name} holds the Editor for the sync, and that slot ends with the sync`, 'end the sync with the sync tool')
  if (!isStandardHeld(g.lock)) return refuse(`${name}'s lock line is not a standard HELD line naming one session`, 'its holder\'s A5R turns it into one at its next request; or it lapses by itself once its end passes and nothing runs')
  if (h.end === null || g.now < h.end) return refuse(`${name}'s lease runs to ${h.end === null ? 'an end it does not say' : hhmm(h.end)}`, 'give it less time (−15 on its row, or /a5r editor time <name> <minutes left>), or release it once its end has passed')
  const text = `${name}'s lock is free (its lease ended at ${hhmm(h.end)}), released by ${p.by}`
  return { kind: 'free', line: freeLine({ since: g.now, by: 'the-person', note: `released by the person past its end: ${h.lane} (session-${h.id8}), ended ${hhmm(h.end)}`, background: 'none' }), holder: h, text }
}

/** The notices of the changes that moved this session (its place or its minutes), each once (the caller's ids), within an
 * hour of the change. */
export const noticesFor = (o: QueueOrder, me8: string, now: number): Notice[] =>
  o.changes
    .filter(c => c.moved.includes(me8) && now - c.at < TELL_WITHIN_MS)
    .map(c => ({ id: `editor:manual:${c.at}:${hash(c.what)}`, text: noticeText(ORDER_GATE, `${c.what}, set by ${c.by} at ${hhmm(c.at)}`, 'nothing to do: A5R grants in that order (it lasts until that turn ends); keep working as before'), isActionable: false }))

// ---------- A117 (Fable review D1): only the person writes his files (A118: the queue order and the Focus) ----------
const ORDER_NAME = /(?<![\w.-])(?:queue-order|editor-focus)\.json(?![\w.-])/i
const A5R_DIR = /saved\/+a5r(?![\w.-])/i // the folder itself, not Saved/A5Rx or Saved/A5R.bak
/** Interpreters whose one-liner may write any file: refused when it names the order file or the Saved/A5R folder. */
const INTERPRETERS = new Set(['python', 'python3', 'py', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'powershell', 'pwsh'])
const slashed = (t: string): string => t.replace(/\\/g, '/')
const inA5R = (t: string): boolean => A5R_DIR.test(`${norm(t).replace(/\/+$/, '')}/`)

/** An Edit/Write path that is one of the person's files: the queue order or (A118) the Focus (Saved/A5R/queue-order.json,
 * Saved/A5R/editor-focus.json; `.` and `..` resolved). */
export const isPersonPath = (path: string): boolean => /(^|\/)Saved\/A5R\/(queue-order|editor-focus)\.json$/i.test(norm(path ?? ''))

/** A shell command that may write one of the person's files, guarded the other way round from the lock's writer list: a
 * segment that names the file is refused unless its verb only reads (a5r.ts READERS, and jq, diff, a git read) and it does
 * not redirect into the file; a copy, move or rename whose destination is the file or lies in Saved/A5R (after a cd there,
 * any relative destination; popd returns) is refused; so is an interpreter one-liner (python -c, node -e, pwsh -c, …) that
 * names the file or the Saved/A5R folder. A path held in a variable (`$p='…queue-order.json'`) names it too. */
export const writesPersonFile = (command: string): boolean => {
  const cwd = placeTracker((_raw: string, target: string, here: true | null) => (inA5R(target) || (here && !isAbs(slashed(target))) ? true : null)) // a relative cd stays there
  return programs(command).some(({ raw, verb, args }) => {
    if (cwd.step(verb, args, raw)) return false
    const text = slashed(raw)
    if (INTERPRETERS.has(verb) && (ORDER_NAME.test(text) || A5R_DIR.test(text))) return true
    const to = writeDestinations(verb, args) ?? []
    if (to.some(d => ORDER_NAME.test(d) || inA5R(d) || (cwd.here() !== null && !isAbs(slashed(d))))) return true
    if (!ORDER_NAME.test(text)) return false
    const reads = READERS.has(verb) || verb === 'jq' || verb === 'diff' || (verb === 'git' && !writesFiles(raw, verb, args))
    return !reads || writesFiles(raw, verb, args, t => ORDER_NAME.test(t)) || isDotNetWrite(raw)
  })
}

// ---------- the person's commands and names ----------
export const EDITOR_USAGE = '/a5r editor · the Editor list · /a5r editor up|down|top <name> · /a5r editor time <name> <+minutes|-minutes|minutes> (a queued request: its minutes; the holder: more time, or minutes left) · /a5r editor release <name> (a holder past its end) · /a5r editor order reset · <name>: a row\'s title, lane or first 8 hex (a unique start is enough)'

/** A117 / A118: a person's command read: his action, `show` (the list), or its usage. */
export type Parsed<A> = A | { kind: 'show' } | { usage: string }
export const isUsage = <A>(c: Parsed<A>): c is { usage: string } => typeof c === 'object' && c !== null && 'usage' in c
export const isShow = <A>(c: Parsed<A>): c is { kind: 'show' } => typeof c === 'object' && c !== null && 'kind' in c && c.kind === 'show'

/** `/a5r editor …` read into the person's action (or `show`, the list), or its usage. */
export const parseEditorCommand = (args: string): Parsed<OrderAction> => {
  const words = oneLine(args).split(' ').filter(Boolean)
  const [verb = '', ...rest] = words
  const v = verb.toLowerCase()
  if (!v) return { kind: 'show' }
  if (v === 'order' && rest.join(' ').toLowerCase() === 'reset') return { kind: 'reset' }
  if ((v === 'up' || v === 'down' || v === 'top') && rest.length) return { kind: 'move', how: v, who: { name: rest.join(' ') } }
  if (v === 'release' && rest.length) return { kind: 'release', who: { name: rest.join(' ') } }
  const m = /^([+\-−]?)(\d{1,3})$/.exec(rest.at(-1) ?? '')
  if (v === 'time' && rest.length >= 2 && m) {
    const n = Number(m[2])
    return { kind: 'time', who: { name: rest.slice(0, -1).join(' ') }, change: m[1] === '+' ? { add: n } : m[1] ? { add: -n } : { set: n } }
  }
  return { usage: noticeText(ORDER_GATE, `"/a5r editor ${oneLine(args)}" is not a command`, EDITOR_USAGE) }
}

/** A row the person can name: its id8 and the names it goes by (its app title, its lane, its id8). */
export type Named = { id8: string; names: readonly string[] }
/** The one row a name picks: an exact name (any case) first, else a unique start; two rows matching are refused. */
export const pickByName = (spec: string, rows: readonly Named[]): { id8: string } | { refusal: string } => {
  const want = oneLine(spec).toLowerCase()
  const norm = (n: string) => oneLine(n).toLowerCase()
  const hits = (ok: (n: string) => boolean) => rows.filter(r => r.names.some(n => norm(n) && ok(norm(n))))
  const exact = hits(n => n === want)
  const [one, ...more] = exact.length ? exact : hits(n => n.startsWith(want))
  if (want && one && more.length === 0) return { id8: one.id8 }
  const listOf = (rs: readonly Named[]) => rs.map(r => `${r.names[0] || r.id8} (${r.id8})`).join(', ')
  if (want && one) return refuse(`"${spec}" names ${more.length + 1} rows: ${listOf([one, ...more])}`, 'give more of the name, or its first 8 hex')
  return refuse(`no row of the Editor list is named "${spec}"`, rows.length ? `name one of: ${listOf(rows)}` : 'nobody holds or waits for the Editor now')
}

/** Only the person's own command changes the queue: his Enter (`composer`) or his remote client (`bridge`); a plugin's,
 * a peer's, a scheduled or a coordinator's run, and one with no origin stamped, are refused. */
export const isPersonOrigin = (origin: { kind: string } | undefined): boolean => origin?.kind === 'composer' || origin?.kind === 'bridge'

// ---------- the panel's controls ----------
/** The controls a selected row offers on the A5R panel, each one press, with its one-key hotkey (the terminal draws
 * `u: Up`). */
export type Control = { id: string; label: string; hotkey: string; action: (id8: string) => OrderAction }
export const QUEUED_CONTROLS: readonly Control[] = [
  { id: 'up', label: 'Up', hotkey: 'u', action: id8 => ({ kind: 'move', how: 'up', who: { id8 } }) },
  { id: 'down', label: 'Down', hotkey: 'd', action: id8 => ({ kind: 'move', how: 'down', who: { id8 } }) },
  { id: 'top', label: 'To top', hotkey: 't', action: id8 => ({ kind: 'move', how: 'top', who: { id8 } }) },
  { id: 'less', label: '−15 min', hotkey: 'm', action: id8 => ({ kind: 'time', who: { id8 }, change: { add: -15 } }) },
  { id: 'more', label: '+15 min', hotkey: 'p', action: id8 => ({ kind: 'time', who: { id8 }, change: { add: 15 } }) },
]
export const HOLDER_CONTROLS: readonly Control[] = [...([[15, '1'], [30, '3'], [60, '6']] as const).map(([n, hotkey]) => ({ id: `add${n}`, label: `+${n} min`, hotkey, action: (id8: string): OrderAction => ({ kind: 'time', who: { id8 }, change: { add: n } }) })), { id: 'release', label: 'Release', hotkey: 'r', action: id8 => ({ kind: 'release', who: { id8 } }) }]
