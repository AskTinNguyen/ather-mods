// A5R rev 41 (L-45: "Editor orchestration should serve delivery, not only share out slots"): A118 a Focus, the person's
// gift of the Editor to one session for a 2-3 h milestone; A119 the other sessions' turns re-planned around it; A120 the
// others keep working without touching the focus Editor. Kept in the shared Saved/A5R/editor-focus.json, written only by
// the person (a press on the A5R panel or his own /a5r focus command, through whichever session's A5R he used) and by the
// focus session's own `focus_done`; every session computes the same answers from it here. Pure: no `$`; register.ts reads,
// writes and delivers.
import { CUTOFF_MS, FREE_RAM_READ, hhmm, livenessOf, lockTimes, noticeText, oneLine, ordinal, ownersOf, samePath, type Claim, type FocusLease, type Gates, type GrantInput, type LaneBeat, type LookRow, type Notice, type Phase, type SessionFile, type SyncFile, type Touch, type Want } from './coord.ts'
import { isUnrealBuild, projectsOf, type EditorKind } from './editor.ts'
import { expectedStarts } from './lease.ts'
import { pickByName, type Parsed, type Who } from './order.ts'

export const FOCUS_FILE = 'editor-focus.json'
export const FOCUS_GATE = 'Focus'
/** A118: a box lasts 30 min to 3 h (default 3 h), counted from the press; an extension adds 5-120 min, 12 h in all at most. */
export const BOX_MIN = 30
export const BOX_MAX = 180
export const ADD_MIN = 5
export const ADD_MAX = 120
const FOCUS_MAX_MS = 12 * 3_600_000
/** A118: ended early (done, or the person's end), the focus session's lease ends this long after, to reach a checkpoint. */
export const END_GRACE_MS = 10 * 60_000
/** A118: no turn and no agent this long puts a running Focus in NEEDS A LOOK. */
export const QUIET_MS = 30 * 60_000
/** A118: a box that ran out unfinished is shown in NEEDS A LOOK this long. */
const RAN_OUT_SHOWN_MS = 30 * 60_000
/** A119: a queued session is told again when its expected start moved this much; re-planned until this long after the end. */
export const PLAN_MOVE_MS = 15 * 60_000
const PLAN_AFTER_MS = 60 * 60_000
const MIN = 60_000

export type FocusEnd = { at: number; how: 'done' | 'ended'; by: string }
export type Focus = { v: 1; id8: string; session: string; lane: string; milestone: string; startedAt: number; endsAt: number; setBy: string; extensions: { at: number; add: number; by: string }[]; ended: FocusEnd | null }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** The file as written, field by field (a half write or another version's file is no Focus). */
export const parseFocus = (text: string | null): Focus | null => {
  try {
    const v = JSON.parse(text ?? '') as Record<string, unknown>
    if (typeof v.id8 !== 'string' || !isNum(v.startedAt) || !isNum(v.endsAt)) return null
    const e = (v.ended ?? null) as Record<string, unknown> | null
    const ended: FocusEnd | null = e && isNum(e.at) && (e.how === 'done' || e.how === 'ended') ? { at: e.at, how: e.how, by: String(e.by ?? '') } : null
    const extensions = Array.isArray(v.extensions) ? (v.extensions as Record<string, unknown>[]).flatMap(x => (x && isNum(x.at) && isNum(x.add) ? [{ at: x.at, add: x.add, by: String(x.by ?? '') }] : [])) : []
    return { v: 1, id8: v.id8.toLowerCase(), session: String(v.session ?? v.id8), lane: String(v.lane ?? v.id8), milestone: String(v.milestone ?? ''), startedAt: v.startedAt, endsAt: v.endsAt, setBy: String(v.setBy ?? ''), extensions, ended }
  } catch {
    return null
  }
}

/** A Focus as the clock reads it: running to its box end unless it ended (done, or the person's end); `over` past the box
 * end unfinished (nothing is written: every reader sees it at once). */
export type FocusState = 'running' | 'done' | 'ended' | 'over'
export const stateOf = (f: Focus, now: number): FocusState => (f.ended ? f.ended.how : now < f.endsAt ? 'running' : 'over')

/** The lease a Focus gives its session (coord.ts FocusLease): while it runs, the Editor to the box end; ended early, its
 * lease cut to 10 min after the end (never past the box end); a box that ran out gives none (the lease is an ordinary one
 * that ended at the box end). */
export const focusLease = (f: Focus | null, now: number): FocusLease | null => {
  const state = f ? stateOf(f, now) : 'over'
  if (!f || state === 'over') return null
  const end = state === 'running' ? f.endsAt : Math.min(f.endsAt, (f.ended?.at ?? now) + END_GRACE_MS)
  return { id8: f.id8, lane: f.lane, milestone: f.milestone, startedAt: f.startedAt, end, isRunning: state === 'running' }
}

/** A118: this session's lease (granted at `since`) is the one a Focus gave or kept: the Focus names it and the lease began
 * before that Focus ended (a lease held when the Focus was given counts; a later ordinary lease does not). */
export const isFocusLeaseOf = (f: Focus | null, id8: string, since: number): boolean => f !== null && f.id8 === id8 && since <= (f.ended?.at ?? f.endsAt)

const nameOf = (f: Pick<Focus, 'id8' | 'lane'>, titleOf: (id8: string) => string): string => titleOf(f.id8) || f.lane
const milestoneText = (f: Pick<Focus, 'milestone'>): string => f.milestone || 'no milestone named'

// ---------- what the person (and the focus session) asks ----------
/** `start`: the person gives `who` the Editor for `minutes`; `extend` / `end`: his; `done`: the focus session's own report. */
export type FocusAction = { kind: 'start'; who: Who; minutes: number; milestone: string } | { kind: 'extend'; add: number } | { kind: 'end' } | { kind: 'done'; note: string }
export type FocusInput = { focus: Focus | null; me8: string; files: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number; sync: SyncFile | null; phase: Phase; titleOf: (id8: string) => string }
export type FocusResult = { refusal: string } | { focus: Focus; text: string }
const refuse = (why: string, next: string): { refusal: string } => ({ refusal: noticeText(FOCUS_GATE, why, next) })

/** A118: a Focus may not cross a planned sync's cutoff (the person chooses: move the sync, or a shorter box) and may not
 * start in a sync's cutoff or freeze. */
const syncProblem = (s: SyncFile | null, phase: Phase, now: number, end: number, name: string): { refusal: string } | null => {
  if (s && (phase === 'cutoff' || phase === 'frozen')) return refuse(`the sync at ${hhmm(s.at)} is in its ${phase}`, 'give the Focus after the sync is done')
  if (!s || phase !== 'planned' || end <= s.at - CUTOFF_MS) return null
  const room = Math.floor((s.at - CUTOFF_MS - now) / MIN)
  return refuse(`the Focus would end at ${hhmm(end)}, past the cutoff ${hhmm(s.at - CUTOFF_MS)} of the sync at ${hhmm(s.at)}`, `your choice: move the sync to ${hhmm(end + CUTOFF_MS)} or later (/a5r sync move HH:MM in ${s.holder.lane}), or ${room >= BOX_MIN ? `a shorter box that ends by the cutoff (/a5r focus ${name} ${room}m: …)` : 'give the Focus after the sync'}`)
}

/** A118: the result of one action on the Focus every session reads, or why not. Only one Focus runs at a time; the target
 * is a live session running 0.25.0 or later; `done` is the focus session's own. */
export const applyFocus = (x: FocusInput, a: FocusAction, by: string): FocusResult => {
  const f = x.focus && stateOf(x.focus, x.now) === 'running' ? x.focus : null
  if (a.kind === 'start') {
    if (f) return refuse(`${nameOf(f, x.titleOf)} has a Focus until ${hhmm(f.endsAt)}`, 'one Focus at a time: end it first (End on the panel, or /a5r focus end), then give the new one')
    if (!(a.minutes >= BOX_MIN && a.minutes <= BOX_MAX)) return refuse(`a box of ${a.minutes} min`, `give ${BOX_MIN} min to ${BOX_MAX / 60} h (default 3 h)`)
    const live = x.files.filter(s => livenessOf(s.id8, x.files, x.lanes, x.now) === 'alive')
    const picked = 'id8' in a.who ? a.who : pickByName(a.who.name, live.map(s => ({ id8: s.id8, names: [x.titleOf(s.id8), s.lane, s.id8] })))
    if ('refusal' in picked) return picked
    const t = live.find(s => s.id8 === picked.id8)
    if (!t) return refuse(`session ${picked.id8} is not a live A5R session`, 'give the Focus to a session that runs now')
    const name = nameOf(t, x.titleOf)
    if (t.knowsFocus !== true) return refuse(`${name} runs an A5R older than 0.25.0, which does not know Focus (it would never take the Editor)`, 'reload that session on 0.25.0 or later, then give the Focus')
    const endsAt = x.now + a.minutes * MIN
    const crossing = syncProblem(x.sync, x.phase, x.now, endsAt, name)
    if (crossing) return crossing
    const focus: Focus = { v: 1, id8: t.id8, session: t.session, lane: t.lane, milestone: oneLine(a.milestone).slice(0, 140), startedAt: x.now, endsAt, setBy: by, extensions: [], ended: null }
    return { focus, text: `${name} has the Editor for a Focus until ${hhmm(endsAt)} (${milestoneText(focus)}), given by ${by}; the queue pauses behind it and runs on after` }
  }
  if (!f) return refuse('no Focus runs', a.kind === 'done' ? 'release the Editor with the editor tool (action release)' : 'give one with /a5r focus <name> <2h|3h>: <milestone>, or Focus… on a row of the panel')
  const name = nameOf(f, x.titleOf)
  if (a.kind === 'extend') {
    if (!(a.add >= ADD_MIN && a.add <= ADD_MAX)) return refuse(`+${a.add} min`, `add ${ADD_MIN} to ${ADD_MAX} min`)
    const endsAt = f.endsAt + a.add * MIN
    if (endsAt - f.startedAt > FOCUS_MAX_MS) return refuse(`${name}'s Focus would run past 12 h from its start`, 'give less time')
    const crossing = syncProblem(x.sync, x.phase, x.now, endsAt, name)
    if (crossing) return crossing
    return { focus: { ...f, endsAt, extensions: [...f.extensions, { at: x.now, add: a.add, by }] }, text: `${name}'s Focus now ends at ${hhmm(endsAt)} (it ended at ${hhmm(f.endsAt)}), extended by ${by}` }
  }
  if (a.kind === 'end') return { focus: { ...f, ended: { at: x.now, how: 'ended', by } }, text: `${name}'s Focus ended at ${hhmm(x.now)} by ${by}; its lease ends by ${hhmm(Math.min(f.endsAt, x.now + END_GRACE_MS))} and the queue runs on in its order` }
  if (x.me8 !== f.id8) return refuse(`the Focus is ${name}'s, not this session's`, 'only the focus session reports its own milestone; release your own lease with the editor tool (action release)')
  return { focus: { ...f, ended: { at: x.now, how: 'done', by } }, text: `Focus done at ${hhmm(x.now)}: ${oneLine(a.note) || milestoneText(f)}` }
}

/** A118: a sync planned or moved while a Focus runs starts its cutoff after the Focus end (refusal text, or null). */
export const syncWhileFocus = (f: Focus | null, now: number, at: number): { why: string; next: string } | null =>
  f && stateOf(f, now) === 'running' && at - CUTOFF_MS < f.endsAt ? { why: `${f.lane} has a Focus until ${hhmm(f.endsAt)}, and the sync's cutoff ${hhmm(at - CUTOFF_MS)} falls inside it`, next: `plan the sync at ${hhmm(f.endsAt + CUTOFF_MS)} or later (its cutoff after the Focus), or the person ends the Focus first` } : null

// ---------- the person's command ----------
export const FOCUS_USAGE = '/a5r focus · what runs · /a5r focus <name> [30m…3h, default 3h][: <milestone>] · /a5r focus end · /a5r focus +30 | +60 (any +5…+120) · <name>: a session\'s title, lane or first 8 hex (a unique start is enough) · the focus session ends it with the editor tool\'s focus_done'
/** `/a5r focus …` read into the person's action, `show`, or its usage. */
export const parseFocusCommand = (args: string): Parsed<FocusAction> => {
  const text = oneLine(args)
  const add = /^\+(\d{1,3})$/.exec(text)
  if (!text) return { kind: 'show' }
  if (text.toLowerCase() === 'end') return { kind: 'end' }
  if (add) return { kind: 'extend', add: Number(add[1]) }
  const [head = '', ...rest] = text.split(':')
  const words = head.trim().split(' ').filter(Boolean)
  const box = boxMinutes(words.at(-1) ?? '')
  const name = (box === null ? words : words.slice(0, -1)).join(' ')
  if (!name) return { usage: noticeText(FOCUS_GATE, `"/a5r focus ${text}" names no session`, FOCUS_USAGE) }
  return { kind: 'start', who: { name }, minutes: box ?? BOX_MAX, milestone: rest.join(':').trim() }
}
/** A box as the person writes it: 3h, 2h30, 2h30m, 2.5h, 150m, 150min (null: not a box). */
export const boxMinutes = (word: string): number | null => {
  const m = /^(?:(\d+(?:\.\d+)?)h(?:(\d{1,2})m?(?:in)?)?|(\d{1,3})m(?:in)?)$/i.exec(word.trim())
  if (!m) return null
  return m[3] ? Number(m[3]) : Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0))
}

// ---------- the panel ----------
/** A118: the EDITOR line's head while a Focus runs. */
export const focusHead = (f: FocusLease, titleOf: (id8: string) => string): string => `FOCUS ${nameOf(f, titleOf)} until ${hhmm(f.end)}${f.milestone ? ` · ${f.milestone}` : ''}`
/** A118: the person's controls on the EDITOR line while a Focus runs (one key each), and the one a selected row offers when
 * none runs (it asks the box in one dialog). */
export type FocusControl = { id: string; label: string; hotkey: string }
export const HEAD_CONTROLS: readonly (FocusControl & { action: FocusAction })[] = [
  { id: 'end', label: 'End focus', hotkey: 'e', action: { kind: 'end' } },
  { id: 'add30', label: '+30 min', hotkey: '3', action: { kind: 'extend', add: 30 } },
  { id: 'add60', label: '+60 min', hotkey: '6', action: { kind: 'extend', add: 60 } },
]
export const ROW_CONTROL: FocusControl = { id: 'focus', label: 'Focus…', hotkey: 'f' }
/** The press's dialog: the question and the boxes it offers (free text under Other reads as `<box>: <milestone>`). */
export const askBox = (name: string): { question: string; options: string[] } => ({ question: `Give ${name} a Focus: how long? (under Other, type <2h|3h>: <milestone> to name the milestone)`, options: ['3 h', '2 h 30 min', '2 h'] })
/** The dialog's answer as a box and a milestone: a label, or `<box>: <milestone>` typed under Other (null: not readable). */
export const boxAnswer = (answer: string): { minutes: number; milestone: string } | null => {
  const label = { '3 h': 180, '2 h 30 min': 150, '2 h': 120 }[answer.trim()]
  if (label) return { minutes: label, milestone: '' }
  const [box = '', ...rest] = answer.split(':')
  const minutes = boxMinutes(box.replace(/\s+/g, ''))
  return minutes === null ? null : { minutes, milestone: rest.join(':').trim() }
}

/** A118: NEEDS A LOOK for a Focus: its session gone (said apart, so the person ends it: only the box end ends a Focus by
 * itself), its session quiet 30 min (no turn, no agent), or its box run out unfinished (for 30 min). */
export const focusLook = (f: Focus | null, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number, titleOf: (id8: string) => string): LookRow[] => {
  if (!f) return []
  const state = stateOf(f, now)
  const head = `${hhmm(now)} ${nameOf(f, titleOf)}'s Focus (until ${hhmm(f.endsAt)})`
  if (state === 'over') return now - f.endsAt < RAN_OUT_SHOWN_MS ? [{ what: `${nameOf(f, titleOf)}'s Focus ran out at ${hhmm(f.endsAt)} with its milestone not reported (${milestoneText(f)})`, next: 'its lease is an ordinary one now, ended: it is told to release; give a new Focus if the milestone needs more (/a5r focus <name> …)' }] : []
  if (state !== 'running') return []
  const file = files.find(s => s.id8 === f.id8)
  if (livenessOf(f.id8, files, lanes, now) === 'gone') return [{ what: `${head}: its session is gone (no heartbeat since ${file ? hhmm(file.heartbeatAt) : 'its start'})`, next: 'end the Focus (End, or /a5r focus end): only the box end ends it by itself' }]
  const quiet = now - Math.max(file?.lastTurnAt ?? f.startedAt, f.startedAt)
  return quiet >= QUIET_MS && (file?.agents ?? 0) === 0 ? [{ what: `${head}: no turn and no agent for ${Math.round(quiet / MIN)} min`, next: 'look at it: end the Focus (End, or /a5r focus end), or extend it if it is working' }] : []
}

// ---------- what each session is told ----------
/** A119: the told-start notices' id prefix for one Focus; the start follows, so a reload reads what was last told. */
const PLAN_ID = (f: Focus): string => `editor:focus-plan:${f.startedAt}:`
const lastTold = (f: Focus, ids: Iterable<string>): number | null => {
  let told: number | null = null
  for (const id of ids) if (id.startsWith(PLAN_ID(f))) told = Number(id.slice(PLAN_ID(f).length)) || told
  return told
}

/** What this session is told of the Focus now (each notice once, by its id): the focus session at the start, an extension,
 * the person's end, the box end; a holder from before the start, to release; a queued session (A119) its expected start
 * when the Focus starts and again when it moved by 15 min or more, until 60 min after the end. `told`: the notice ids
 * this session has delivered or queued. */
export const focusNotices = (f: Focus | null, x: GrantInput & { holds: boolean; told: Iterable<string>; titleOf: (id8: string) => string }): Notice[] => {
  if (!f) return []
  const state = stateOf(f, x.now)
  const me = x.files.find(s => s.id8 === x.me8)
  const name = nameOf(f, x.titleOf)
  const out: Notice[] = []
  if (f.id8 === x.me8) {
    if (state === 'running') out.push({ id: `focus:given:${f.startedAt}`, text: noticeText(FOCUS_GATE, `the person gave this session the Editor for a Focus until ${hhmm(f.endsAt)}: ${milestoneText(f)}`, `work to that milestone through as many close, build, reopen, compile and PIE cycles as it needs: the lock stays this session's while the box runs (the Editor may be closed), and A5R takes it for you when it comes free; when the milestone is reached call the editor tool with action focus_done (a plain release keeps the lock)`), isActionable: true })
    if (state === 'running' && f.extensions.length > 0) out.push({ id: `focus:extended:${f.startedAt}:${f.endsAt}`, text: noticeText(FOCUS_GATE, `the person extended your Focus: it now ends at ${hhmm(f.endsAt)}`, 'nothing to do: keep working to the milestone'), isActionable: false })
    if (state === 'ended' && (x.holds || me?.want)) out.push({ id: `focus:ended:${f.startedAt}`, text: noticeText(FOCUS_GATE, `the person ended your Focus at ${hhmm(f.ended?.at ?? x.now)}; your lease ends by ${hhmm(Math.min(f.endsAt, (f.ended?.at ?? x.now) + END_GRACE_MS))}`, 'stop at the nearest checkpoint (PIE stopped, your own assets saved), then release with the editor tool'), isActionable: true })
    if (state === 'over' && (x.holds || me?.want)) out.push({ id: `focus:over:${f.startedAt}`, text: noticeText(FOCUS_GATE, `your Focus box ended at ${hhmm(f.endsAt)} and the milestone was not reported done`, 'stop at the nearest checkpoint (PIE stopped, your own assets saved) and release with the editor tool now; the person can give a new Focus'), isActionable: true })
    return out
  }
  if (state === 'running' && x.holds) out.push({ id: `focus:yield:${f.startedAt}`, text: noticeText(FOCUS_GATE, `the person gave ${name} the Editor for a Focus until ${hhmm(f.endsAt)}`, 'finish to a checkpoint (PIE stopped, your own assets saved) and release with the editor tool within 10 min; your next request keeps its place'), isActionable: true })
  const endedAt = state === 'running' ? null : (f.ended?.at ?? f.endsAt)
  if (!me?.want || x.holds || (endedAt !== null && x.now - endedAt > PLAN_AFTER_MS)) return out
  // The Editor comes back to the queue at the box end while it runs; after it, at the end of the lease the lock names.
  const held = x.lock.kind === 'held' || x.lock.kind === 'handed' ? lockTimes(x.lock, x.now)?.end ?? x.now : x.now
  const starts = expectedStarts(x, state === 'running' ? f.endsAt : held)
  const start = starts.get(x.me8)
  const told = lastTold(f, x.told)
  if (start === undefined || (told !== null && Math.abs(start - told) < PLAN_MOVE_MS)) return out
  const place = [...starts.keys()].indexOf(x.me8) + 1
  const why = state === 'running' ? `the person gave ${name} a Focus until ${hhmm(f.endsAt)} (${milestoneText(f)}); the queue pauses behind it` : `${name}'s Focus ended at ${hhmm(endedAt ?? x.now)}; the queue runs on in its order`
  out.push({ id: `${PLAN_ID(f)}${start}`, text: noticeText('Editor', `${why}: your turn is expected about ${hhmm(start)} (${ordinal(place)} ${state === 'running' ? 'after the Focus' : 'in the queue'})`, `batch your Editor needs into that one turn; meanwhile do what needs no Editor (edits on disk outside the focus session's files, builds and tests in your own worktree while free RAM is above the no-PIE launch gate); you are told again if it moves by 15 min or more`), isActionable: false })
  return out
}

/** A118: the request A5R makes for the focus session (when it had none, or to mark its own): until the box end, a build
 * lease that is not pausable (so an A5R before 0.25.0 never lapses, passes on or asks to yield it), kept in its place. */
export const focusWant = (f: FocusLease, now: number, had: Want | null): Want => ({
  minutes: Math.max(5, Math.ceil((f.end - now) / MIN)),
  pie: false,
  mode: 'interactive',
  nextSafe: 'after save',
  ...had,
  requestedAt: had?.requestedAt ?? f.startedAt,
  build: true,
  pausable: false,
  what: `Focus: ${f.milestone || 'milestone'}`.slice(0, 120),
  focus: f.startedAt,
})

// ---------- A120: the others around the focus Editor ----------
/** What a call of another session does to an Unreal Editor or build: an Unreal MCP write, PIE, stop or save-all; a windowed
 * launch; a headless run or a build, with the .uproject paths it names. */
export type EditorUse = { kind: 'drive' } | { kind: 'launch' } | { kind: 'headless' | 'build'; projects: readonly string[] }
/** A120: a call's use, from its Editor kind (editor.ts) and its shell command (`cwd` resolves a relative .uproject); null: it
 * neither drives nor launches an Editor nor builds (an MCP read is no use). */
export const editorUseOf = (kind: EditorKind, command: string, cwd: string): EditorUse | null =>
  kind === 'launch' ? { kind: 'launch' } : kind === 'headless' ? { kind: 'headless', projects: projectsOf(command, cwd) } : kind && kind !== 'read' ? { kind: 'drive' } : command && isUnrealBuild(command) ? { kind: 'build', projects: projectsOf(command, cwd) } : null
/** A120: why a session other than the focus session may not do this while the Focus runs (null: it may), with what to do
 * instead: MCP writes and PIE, a windowed Editor of any project, a headless run or build of the shared project (or naming
 * none) are refused; a headless run or build of another project (a worktree) runs while free RAM is at least the no-PIE
 * launch gate. */
export const focusRefusal = (f: Pick<Claim, 'lane' | 'end'>, u: EditorUse, x: { sharedProject: string; freeGb: number | null; gateGb: number }): { why: string; next: string } | null => {
  const has = `${f.lane} has the Editor for a Focus until ${hhmm(f.end)}`
  const meanwhile = 'meanwhile edit on disk outside its files, build and test in your own worktree, read the Editor through MCP reads; your turn comes after the Focus'
  if (u.kind === 'drive') return { why: `${has}: Unreal MCP writes, PIE and stops are its alone`, next: meanwhile }
  if (u.kind === 'launch') return { why: `${has}: a second Unreal Editor beside it would take the memory it needs`, next: `run headless tests or builds in your own worktree (name its .uproject); ${meanwhile}` }
  const what = u.kind === 'build' ? 'build' : 'headless Unreal run'
  if (u.projects.length === 0 || u.projects.some(p => samePath(p, x.sharedProject))) return { why: `${has}: this ${what} ${u.projects.length === 0 ? 'names no .uproject, so it is taken for' : 'uses'} the shared checkout's project${u.kind === 'build' ? ', whose binaries the focus Editor loads' : ''}`, next: `run it in your own worktree and name that worktree's .uproject (-project=<worktree>/<name>.uproject); ${meanwhile}` }
  if (x.freeGb === null) return { why: `${has}, and there is no memory reading for this ${what}`, next: `read free RAM with ${FREE_RAM_READ}; it runs once a reading shows at least ${x.gateGb} GB free (the no-PIE launch gate)` }
  if (x.freeGb < x.gateGb) return { why: `${has}: free RAM is ${x.freeGb} GB, under the ${x.gateGb} GB no-PIE launch gate, and the focus Editor needs it`, next: `run this ${what} when free RAM is back at ${x.gateGb} GB or more, or after the Focus` }
  return null
}

/** A120: an edit by another session inside the focus session's touch paths in the shared checkout (`rel`: the path relative
 * to the checkout) is refused while the Focus runs: those are its milestone's files. */
export const touchRefusal = (f: Pick<Claim, 'id8' | 'lane' | 'end'>, rel: string, touches: readonly Touch[]): { why: string; next: string } | null =>
  ownersOf(rel, touches).some(t => t.id8 === f.id8) ? { why: `${rel} is one of the files ${f.lane} edits in its Focus (until ${hhmm(f.end)})`, next: 'leave it until the Focus ends, or make your change in your own worktree and merge it after' } : null

/** A118: what a Focus's grant says of memory (it takes the lock with no launch gate): free RAM against the gate ('' with no
 * reading). */
export const grantMemoryNote = (freeGb: number | null, gates: Gates): string =>
  freeGb === null ? '' : `free RAM ${freeGb} GB against the launch gate of ${gates.nopieGb} GB (${gates.pieGb} with PIE)${freeGb < gates.nopieGb ? ': free memory before you launch' : ''}`
