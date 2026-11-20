// Super Focus (intent a5r-superfocus): the person parks every other session, works with one until its milestone, then
// restores the others. Kept in the shared Saved/A5R/superfocus.json, written by the person's own /a5r superfocus command
// (register.ts, through personChange) and by each listed session's own `parked` report; every session reads it. Pure: no
// `$`. A5R cannot stop, archive or unarchive a session: the conductor's model does that with the desktop app's session
// tools, from the exact list this module hands it.
import { hhmm, livenessOf, noticeText, oneLine, ymd, type LaneBeat, type Phase, type SessionFile, type SyncFile, type Touch } from './coord.ts'
import { str, isNum } from './lease.ts'
import { BOX_MAX, applyFocus, type Focus } from './focus.ts'
import { pickByName, type Parsed } from './order.ts'

export const SUPERFOCUS_FILE = 'superfocus.json'
export const SUPERFOCUS_GATE = 'Super Focus'

/** wip: uncommitted paths in the shared checkout; busy: holds or waits for the Editor, or runs agents; clean: nothing local. */
export type SfKind = 'wip' | 'busy' | 'clean'
export type Parked = { branch: string; sha: string; note: string; at: number }
export type SfSession = { id8: string; session: string; title: string; lane: string; kind: SfKind; paths: string[]; parked: Parked | null }
export type SfStage = 'parking' | 'focus' | 'ended'
/** How a Super Focus ended: restored (the person is done with the focus session) or cancelled (no focus session chosen). */
export type SfEnd = { at: number; how: 'restore' | 'cancel' }
export type SuperFocus = { v: 1; startedAt: number; by: string; conductor: string; stage: SfStage; sessions: SfSession[]; chosen: string | null; kept: string[]; ended: SfEnd | null }

const STAGES: readonly SfStage[] = ['parking', 'focus', 'ended']
const KINDS: readonly SfKind[] = ['wip', 'busy', 'clean']

/** The file as written, field by field (a half write or another version's file is no Super Focus). */
export const parseSuperFocus = (text: string | null): SuperFocus | null => {
  try {
    const v = JSON.parse(text ?? '') as Record<string, unknown>
    if (!isNum(v.startedAt) || !STAGES.includes(v.stage as SfStage) || !Array.isArray(v.sessions)) return null
    const sessions = (v.sessions as Record<string, unknown>[]).flatMap((s): SfSession[] => {
      if (!s || typeof s.id8 !== 'string') return []
      const p = s.parked as Record<string, unknown> | null
      const parked = p && typeof p.branch === 'string' && typeof p.sha === 'string' && isNum(p.at) ? { branch: p.branch, sha: p.sha, note: str(p.note), at: p.at } : null
      return [{ id8: s.id8.toLowerCase(), session: str(s.session) || s.id8, title: str(s.title), lane: str(s.lane) || s.id8, kind: KINDS.find(k => k === s.kind) ?? 'clean', paths: Array.isArray(s.paths) ? s.paths.map(String) : [], parked }]
    })
    const e = (v.ended ?? null) as Record<string, unknown> | null
    const ended: SfEnd | null = e && isNum(e.at) && (e.how === 'restore' || e.how === 'cancel') ? { at: e.at, how: e.how } : null
    return { v: 1, startedAt: v.startedAt, by: str(v.by), conductor: str(v.conductor).toLowerCase(), stage: v.stage as SfStage, sessions, chosen: typeof v.chosen === 'string' ? v.chosen.toLowerCase() : null, kept: Array.isArray(v.kept) ? v.kept.map(String) : [], ended }
  } catch {
    return null
  }
}

/** The world a Super Focus is computed from (every session computes the same from the same files). */
export type SfWorld = { me8: string; files: readonly SessionFile[]; lanes: readonly LaneBeat[]; touches: readonly Touch[]; now: number; sync: SyncFile | null; phase: Phase; isMerging: boolean; titleOf: (id8: string) => string }

const nameOf = (s: Pick<SfSession, 'id8' | 'title' | 'lane'>): string => s.title || s.lane || s.id8
const isRunning = (sf: SuperFocus | null): sf is SuperFocus => sf !== null && sf.stage !== 'ended'
/** The sessions still to park (the conductor's own entry counts: it parks too). */
export const unparked = (sf: SuperFocus): SfSession[] => sf.sessions.filter(s => s.parked === null)

/** One session's record from its A5R file and its touch file (either may be missing). */
const sessionOf = (w: SfWorld, id8: string): SfSession => {
  const f = w.files.find(x => x.id8 === id8)
  const t = w.touches.find(x => x.id8 === id8)
  const paths = t?.paths ?? []
  const kind: SfKind = paths.length > 0 ? 'wip' : f && (f.holding || f.want || (f.agents ?? 0) > 0) ? 'busy' : 'clean'
  return { id8, session: f?.session ?? t?.session ?? id8, title: w.titleOf(id8) || f?.title || '', lane: f?.lane ?? t?.lane ?? id8, kind, paths, parked: null }
}

/** S1: every other session A5R knows, live or with touch paths in the shared checkout, with its kind; never this session
 * (the conductor, listed apart) and never the sync holder. */
export const scan = (w: SfWorld): SfSession[] => {
  const holder = w.sync && (w.phase === 'planned' || w.phase === 'cutoff' || w.phase === 'frozen') ? w.sync.holder.id8 : ''
  const ids = new Set<string>()
  for (const f of w.files) if (livenessOf(f.id8, w.files, w.lanes, w.now) === 'alive') ids.add(f.id8)
  for (const t of w.touches) if (t.paths.length > 0) ids.add(t.id8)
  ids.delete(w.me8)
  ids.delete(holder)
  return [...ids].sort().map(id8 => sessionOf(w, id8))
}

// ---------- the person's command ----------
export type SfAction = { kind: 'start' } | { kind: 'choose'; name: string; force: boolean } | { kind: 'restore' } | { kind: 'cancel' }
export const SUPERFOCUS_USAGE = '/a5r superfocus · what runs · /a5r superfocus start (park every other session) · /a5r superfocus <name>[!] (the focus session, once all parked; ! keeps the unparked) · /a5r superfocus restore · /a5r superfocus cancel'
export const parseSuperFocusCommand = (args: string): Parsed<SfAction> => {
  const text = oneLine(args)
  const word = text.toLowerCase()
  if (!text) return { kind: 'show' }
  if (word === 'start' || word === 'restore' || word === 'cancel') return { kind: word }
  const force = text.endsWith('!')
  const name = (force ? text.slice(0, -1) : text).trim()
  return name ? { kind: 'choose', name, force } : { usage: noticeText(SUPERFOCUS_GATE, `"/a5r superfocus ${text}" names no session`, SUPERFOCUS_USAGE) }
}

/** What one action produces: the file to write, a line for the person, the messages to other sessions (by session id),
 * a prompt for this session's model (the steps only a model can take: the app's session tools), and the session to give
 * the Focus (written in the same change as the file). */
export type SfSend = { session: string; text: string }
export type SfResult = { refusal: string } | { sf: SuperFocus; text: string; sends: SfSend[]; prompt: string | null; focusFor: string | null }
const refuse = (why: string, next: string): { refusal: string } => ({ refusal: noticeText(SUPERFOCUS_GATE, why, next) })

/** D2: no start or choice inside a sync's cutoff or freeze, or over a merge, revert or cherry-pick. */
const syncProblem = (w: SfWorld): { refusal: string } | null => {
  if (w.isMerging) return refuse('a merge, revert or cherry-pick is in progress in the shared checkout', 'let its owner finish or abort it, then run /a5r superfocus again')
  if (w.sync && (w.phase === 'cutoff' || w.phase === 'frozen')) return refuse(`the sync at ${hhmm(w.sync.at)} is in its ${w.phase}`, 'run /a5r superfocus after the sync is done')
  return null
}

export const branchOf = (id8: string, at: number): string => `park/${id8}/${ymd(at).replace(/-/g, '')}`

/** S2: the park message one session gets (the conductor gets it as a prompt). */
export const parkText = (id8: string, paths: readonly string[], at: number): string => {
  const branch = branchOf(id8, at)
  const own = paths.length ? `your uncommitted paths in the shared checkout (your touch file lists: ${paths.join(', ')})` : 'your uncommitted paths in the shared checkout, if any'
  return noticeText(SUPERFOCUS_GATE, `the person parks every session before a Super Focus`, [
    `1. commit ${own} to ${branch} WITHOUT moving the shared tree: a temporary index (GIT_INDEX_FILE=<a file of yours outside the repo> git read-tree HEAD; git update-index --add --remove -- <your paths>; git write-tree; git commit-tree <tree> -p HEAD -m "park: <what>"; git update-ref refs/heads/${branch} <commit>), then check git diff --stat HEAD ${branch} shows exactly your paths`,
    `2. only then restore those paths in the shared tree: git checkout HEAD -- <your tracked paths>, and remove the new files you committed (they are in ${branch})`,
    '3. write your resume note in Saved/LANE_NOTES/<your session id>.md (what is done, what is next, open PRs)',
    '4. stop PIE, release the Editor with the editor tool, and stop every background process and agent of yours',
    `5. call the superfocus tool: action parked, branch ${branch} (or "none" when you had nothing to park), sha, note (one line: where you stopped)`,
  ].join('; '))
}

/** How a parked session's work comes back onto today's main: only what its park commit changed, applied three-way, and left
 * uncommitted as it was. */
export const bringBack = (branch: string, paths: readonly string[]): string =>
  `git cherry-pick --no-commit ${branch} (it applies only what the park commit changed, three-way, onto today's main; resolve a conflict in your own paths), then git restore --staged -- ${paths.join(' ') || '<those paths>'} so they stay uncommitted as before`

/** S5: the conductor's clean-up prompt once the focus session is chosen. */
export const focusPrompt = (chosen: SfSession | null, archive: readonly SfSession[], kept: readonly SfSession[], now: number): string => {
  const row = (s: SfSession) => `- "${nameOf(s)}" (session ${s.session}, ${s.id8})`
  return [
    `${SUPERFOCUS_GATE}: the person chose ${chosen ? `"${nameOf(chosen)}"` : 'this session'} as the focus session. Do these steps in order, with the desktop app's session tools (list_sessions to match each title, then stop_session and archive_session):`,
    archive.length ? `1. Stop, then archive, each of these parked sessions (never any other):\n${archive.map(row).join('\n')}` : '1. No session to archive.',
    kept.length ? `Keep these, they did not park (never stop or archive them):\n${kept.map(row).join('\n')}` : '',
    `2. Plan a sync of main with the sync tool: action plan, at ${hhmm(now + 5 * 60_000)}, build true, holder this session; let it run to done.`,
    chosen?.parked && chosen.parked.branch !== 'none' ? `3. After the sync is done, bring the focus session's work back in the shared checkout: ${bringBack(chosen.parked.branch, chosen.paths)}, then send "${nameOf(chosen)}" a message that its paths are back on today's main and it has a Focus.` : `3. After the sync is done, tell ${chosen ? `"${nameOf(chosen)}"` : 'yourself'} it has a Focus and works alone.`,
    'Super Focus keeps every name, branch and note in Saved/A5R/superfocus.json; /a5r superfocus restore brings them back.',
  ].filter(Boolean).join('\n')
}

/** S6: the conductor's restore prompt: every archived session unarchived and told where its work is, and its own paths. */
export const restorePrompt = (sf: SuperFocus): string => {
  const archived = sf.sessions.filter(s => s.id8 !== sf.chosen && s.id8 !== sf.conductor && !sf.kept.includes(s.id8) && s.parked)
  const line = (s: SfSession) => {
    const p = s.parked as Parked
    const back = p.branch === 'none' ? 'it parked nothing' : `bring your paths back from ${p.branch} (${p.sha.slice(0, 12)}) onto today's main: ${bringBack(p.branch, s.paths)}`
    return `- unarchive "${nameOf(s)}" (session ${s.session}), then send it: "${noticeText(SUPERFOCUS_GATE, `the person restored you after a Super Focus; you parked at ${hhmm(p.at)}: ${oneLine(p.note) || 'no note'}`, `${back}; read Saved/LANE_NOTES/<your session id>.md and go on`)}"`
  }
  const me = sf.sessions.find(s => s.id8 === sf.conductor)
  const own = me?.parked && me.parked.branch !== 'none' ? [`- this session: bring your own paths back: ${bringBack(me.parked.branch, me.paths)}`] : []
  return [`${SUPERFOCUS_GATE}: restore. With the desktop app's session tools (unarchive_session, then send_message to each, by its session id):`, ...(archived.length ? archived.map(line) : ['- no session was archived.']), ...own].join('\n')
}

/** The result of one action of the person's, or why not. `by`: who typed it (for the record). */
export const applySuperFocus = (sf: SuperFocus | null, w: SfWorld, a: SfAction, by: string): SfResult => {
  if (a.kind === 'start') {
    if (isRunning(sf)) return refuse(`a Super Focus runs since ${hhmm(sf.startedAt)} (${sf.stage})`, 'one at a time: /a5r superfocus restore or cancel first')
    const problem = syncProblem(w)
    if (problem) return problem
    const sessions = scan(w)
    const conductor = sessionOf(w, w.me8)
    const next: SuperFocus = { v: 1, startedAt: w.now, by, conductor: w.me8, stage: 'parking', sessions: [conductor, ...sessions], chosen: null, kept: [], ended: null }
    const counts = KINDS.map(k => `${sessions.filter(s => s.kind === k).length} ${k}`).join(', ')
    return { sf: next, text: `Super Focus started at ${hhmm(w.now)}: ${sessions.length} other session${sessions.length === 1 ? '' : 's'} told to park (${counts}); this session parks too. When all have reported: /a5r superfocus <name>`, sends: sessions.map(s => ({ session: s.session, text: parkText(s.id8, s.paths, w.now) })), prompt: parkText(w.me8, conductor.paths, w.now), focusFor: null }
  }
  if (!isRunning(sf)) return refuse('no Super Focus runs', 'start one with /a5r superfocus start')
  if (a.kind === 'restore' || a.kind === 'cancel') {
    const done: SuperFocus = { ...sf, stage: 'ended', ended: { at: w.now, how: a.kind } }
    return { sf: done, text: `Super Focus ${a.kind === 'restore' ? 'restored' : 'cancelled'} at ${hhmm(w.now)}: this session brings the parked sessions back`, sends: [], prompt: restorePrompt(done), focusFor: null }
  }
  if (sf.stage !== 'parking') return refuse(`the focus session is already ${nameOf(sf.sessions.find(s => s.id8 === sf.chosen) ?? { id8: sf.chosen ?? '', title: '', lane: '' })}`, 'restore first (/a5r superfocus restore), then start again')
  const problem = syncProblem(w)
  if (problem) return problem
  const picked = pickByName(a.name, sf.sessions.map(s => ({ id8: s.id8, names: [nameOf(s), s.lane, s.id8] })))
  if ('refusal' in picked) return refuse(`"${a.name}" names no single session of this Super Focus`, `name one of: ${sf.sessions.map(s => `${nameOf(s)} (${s.id8})`).join(', ')}`)
  const waiting = unparked(sf)
  if (waiting.length > 0 && !a.force) return refuse(`${waiting.length} session${waiting.length === 1 ? ' has' : 's have'} not parked: ${waiting.map(nameOf).join(', ')}`, `wait for their reports (/a5r superfocus shows them), or /a5r superfocus ${a.name}! to keep them as they are`)
  const chosen = sf.sessions.find(s => s.id8 === picked.id8) ?? null
  const kept = waiting.filter(s => s.id8 !== picked.id8 && s.id8 !== sf.conductor)
  const archive = sf.sessions.filter(s => s.parked && s.id8 !== picked.id8 && s.id8 !== sf.conductor)
  const next: SuperFocus = { ...sf, stage: 'focus', chosen: picked.id8, kept: kept.map(s => s.id8) }
  return { sf: next, text: `Super Focus on ${chosen ? nameOf(chosen) : picked.id8} from ${hhmm(w.now)}: ${archive.length} to archive${kept.length ? `, ${kept.length} kept` : ''}; this session runs the clean-up`, sends: [], prompt: focusPrompt(chosen, archive, kept, w.now), focusFor: picked.id8 }
}

/** S5: the person's change with its Focus: a choice gives the focus session a Focus (focus.ts) in the same change, and is
 * refused when that Focus cannot be given (another runs, or its box would cross a sync's cutoff). */
export const planSuperFocus = (sf: SuperFocus | null, w: SfWorld, focus: Focus | null, a: SfAction, by: string): { refusal: string } | { r: Exclude<SfResult, { refusal: string }>; focus: Focus | null } => {
  const r = applySuperFocus(sf, w, a, by)
  if ('refusal' in r) return r
  if (!r.focusFor) return { r, focus: null }
  const f = applyFocus({ ...w, focus }, { kind: 'start', who: { id8: r.focusFor }, minutes: BOX_MAX, milestone: 'Super Focus' }, by)
  return 'refusal' in f ? f : { r, focus: f.focus }
}

/** S4: a listed session's own report through the superfocus tool. */
export const applyParked = (sf: SuperFocus | null, me8: string, p: { branch: string; sha: string; note: string }, now: number): { refusal: string } | { sf: SuperFocus; text: string } => {
  if (!sf || sf.stage !== 'parking') return refuse('no Super Focus is parking sessions', 'nothing to report; go on with your work')
  if (!sf.sessions.some(s => s.id8 === me8)) return refuse('this session is not listed in the Super Focus', 'nothing to report; go on with your work')
  const branch = oneLine(p.branch) || 'none'
  if (branch !== 'none' && !/^[0-9a-f]{7,40}$/i.test(p.sha.trim())) return refuse(`sha "${p.sha}" is no commit id`, `give the commit ${branch} points at (git rev-parse ${branch})`)
  const parked: Parked = { branch, sha: p.sha.trim(), note: oneLine(p.note).slice(0, 200), at: now }
  const next = { ...sf, sessions: sf.sessions.map(s => (s.id8 === me8 ? { ...s, parked } : s)) }
  const left = unparked(next).length
  return { sf: next, text: `parked at ${hhmm(now)} (${branch}); ${left ? `${left} still to park` : 'every session has parked: the person chooses the focus session'}. Stay idle until the person restores you.` }
}

/** `/a5r superfocus` with no words: what runs, one session a line. */
export const showSuperFocus = (sf: SuperFocus | null): string => {
  if (!sf) return `No Super Focus has run. ${SUPERFOCUS_USAGE}`
  const head = `Super Focus ${sf.ended ? (sf.ended.how === 'restore' ? 'restored' : 'cancelled') : sf.stage} since ${hhmm(sf.startedAt)}${sf.chosen ? `, focus on ${sf.chosen}` : ''}${sf.ended ? `, ended ${hhmm(sf.ended.at)}` : ''}:`
  const rows = sf.sessions.map(s => `- ${nameOf(s)} (${s.id8}${s.id8 === sf.conductor ? ', this conductor' : ''}) ${s.kind}: ${s.parked ? `parked ${hhmm(s.parked.at)} → ${s.parked.branch}` : sf.kept.includes(s.id8) ? 'kept (did not park)' : 'not parked'}`)
  return [head, ...rows].join('\n')
}
