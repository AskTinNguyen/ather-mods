// Rev 44 (L-48): git in the shared checkout one writer at a time. A128: before a git write there runs, a session's A5R
// claims the git turn in its own file Saved/A5R/git-turn/<id8>.json, and holds it only when no other live claim stands
// after its write (each session writes only its own claim, so no write is lost; two claims at once both step back);
// a second writer is refused at once and told when the turn frees. A129: such a call is never cut short (a long tool
// timeout; no pipe into head/tail, no timeout/kill around it). A130: an index.lock that git left behind is moved aside,
// never deleted. Pure: no `$`; gitturnhost.ts reads the files and the processes, writes the claim and moves the lock.
import { program, tokenize } from './a5r.ts'
import { FREEZE_VERBS, hhmm, ymd } from './coord.ts'
import { gitPlace, type Seg } from './gitshared.ts'

/** A128: the folder of the sessions' claims, one file each (`null` when it holds none). */
export const GIT_TURN_DIR = 'git-turn'
/** A128: a claim whose command has been gone this long (no git of the checkout runs, no index.lock) lapses. */
export const TURN_LAPSE_MS = 2 * 60_000
/** A128: a claim to the turn: the session, its lane, the git command (`git commit`), when it began. */
export type GitTurn = { v: 1; session: string; id8: string; lane: string; command: string; startedAt: number }
const isTurn = (v: Partial<GitTurn> | null): v is GitTurn => v?.v === 1 && typeof v.id8 === 'string' && v.id8 !== '' && typeof v.lane === 'string' && typeof v.command === 'string' && typeof v.startedAt === 'number' && typeof v.session === 'string'
export const parseGitTurn = (text: string | null): GitTurn | null => {
  try {
    const v = JSON.parse(text ?? '') as Partial<GitTurn> | null
    return isTurn(v) ? v : null
  } catch {
    return null
  }
}
/** A128: the git verbs that take a turn: those that write the index or refs (a push writes neither here). */
export const TURN_VERBS: ReadonlySet<string> = new Set([...FREEZE_VERBS].filter(v => v !== 'push'))
/** A128: a segment's git subcommand when it takes a turn ('' otherwise). */
export const turnVerb = (seg: Seg): string => {
  const sub = (gitPlace(seg).args[0] ?? '').toLowerCase()
  return seg.verb === 'git' && TURN_VERBS.has(sub) ? sub : ''
}
export const turnOf = (me: { session: string; id8: string; lane: string }, verbs: readonly string[], now: number): GitTurn => ({ v: 1, session: me.session, id8: me.id8, lane: me.lane, command: `git ${verbs.join(', git ')}`, startedAt: now })
export const turnKey = (t: GitTurn): string => `${t.id8}:${t.startedAt}`

/** A128: the claim that holds the turn against this session: the earliest live claim of another session that has not
 * lapsed (its session gone, or `gone`: this reader has seen no git of the checkout and no index.lock for 2 min since it
 * stood), else null. */
export const heldBy = (claims: readonly GitTurn[], x: { me8: string; now: number; isLive: (id8: string) => boolean; gone: ReadonlyMap<string, number> }): GitTurn | null =>
  claims
    .filter(c => c.id8 !== x.me8 && x.isLive(c.id8) && x.now - (x.gone.get(turnKey(c)) ?? x.now) < TURN_LAPSE_MS)
    .sort((a, b) => a.startedAt - b.startedAt || a.id8.localeCompare(b.id8))[0] ?? null
/** A128: since when this reader has seen each claim's git gone, after one more look: `isRunning` true (a git of the
 * checkout, or its index.lock) or null (the process list unread) clears them; false keeps the first sighting. */
export const goneAfter = (prev: ReadonlyMap<string, number>, claims: readonly GitTurn[], isRunning: boolean | null, now: number): Map<string, number> =>
  new Map(isRunning === false ? claims.map(c => [turnKey(c), prev.get(turnKey(c)) ?? now] as const) : [])
export const TURN_GATE = 'Git turn'
export const busyText = (t: GitTurn): string => `git busy: ${t.lane} runs \`${t.command}\` since ${hhmm(t.startedAt)}`
export const TURN_NEXT = 'A5R tells you when it is free (work without git meanwhile; never delete .git/index.lock)'
export const turnFreeText = (t: { lane: string; command: string }): string => `git is free again in the shared checkout (${t.lane}'s \`${t.command}\` returned) → run your git command again now`

// ---------- A129: a git write is never killed halfway ----------
/** A129: the tool timeout a call that writes the shared checkout's git gets at least (the engine's foreground maximum). */
export const GIT_WRITE_TIMEOUT_MS = 600_000
/** A129: the timeout to give the call, or null when its own is long enough (or it runs in the background). */
export const raisedTimeout = (timeout: unknown, isBackground: boolean): number | null => (isBackground || (typeof timeout === 'number' && timeout >= GIT_WRITE_TIMEOUT_MS) ? null : GIT_WRITE_TIMEOUT_MS)
const CUTTERS = new Set(['head', 'tail', 'select-object', 'select'])
const KILLERS = new Set(['timeout', 'gtimeout', 'kill', 'taskkill', 'stop-process', 'pkill'])
/** A129: why one of `writes` (the git writes in the shared checkout among the command's segments `segs`, gitshared.ts
 * walkDeep) could be cut short, or null: a time limit put around it, a pipe from it into head/tail, a kill beside it. Each
 * segment is found in the command text after the one before it. */
export const cutProblem = (command: string, segs: readonly Seg[], writes: readonly Seg[]): { why: string; alt: string } | null => {
  if (writes.length === 0) return null
  let from = 0
  for (const [i, seg] of segs.entries()) {
    const at = command.indexOf(seg.raw, from)
    from = at < 0 ? from : at + seg.raw.length
    if (!writes.includes(seg)) continue
    const words = tokenize(seg.raw).map(program)
    if (words.slice(0, words.indexOf('git')).some(w => KILLERS.has(w))) return { why: `\`${seg.raw.trim()}\` puts a time limit on a git write in the shared checkout: a git killed halfway leaves .git/index.lock behind and blocks every session`, alt: plainAlt(seg) }
    const next = segs[i + 1]
    if (at >= 0 && /^\s*\|(?!\|)/.test(command.slice(from)) && next && CUTTERS.has(next.verb)) return { why: `\`${seg.raw.trim()} | ${next.verb}\` pipes a git write in the shared checkout into ${next.verb}, which can end it halfway and leave .git/index.lock behind`, alt: plainAlt(seg) }
  }
  const killer = segs.find(s => KILLERS.has(s.verb))
  return killer ? { why: `\`${killer.raw.trim()}\` runs beside a git write in the shared checkout and can kill it halfway, leaving .git/index.lock behind`, alt: plainAlt(writes[0] as Seg) } : null
}
const plainAlt = (seg: Seg): string => `run the git command alone, in the foreground and unwrapped: git -C ${gitPlace(seg).dir} ${gitPlace(seg).args.join(' ')} (A5R gives the call a 10-min timeout; a slow commit is fine)`

// ---------- A130: a stale index.lock moved aside ----------
export const STALE_LOCK_MS = 2 * 60_000
/** A130: what to do with .git/index.lock: `lockAgeMs` null (none), `gitPids` null (the process list unread), `isTurnHeld`
 * (a live claim holds the git turn). Every condition must hold for a move; an unread process list asks for a look. */
export const staleLockAct = (f: { lockAgeMs: number | null; gitPids: readonly number[] | null; isTurnHeld: boolean }): 'none' | 'move' | 'unread' => {
  if (f.lockAgeMs === null || f.lockAgeMs < STALE_LOCK_MS) return 'none'
  if (f.gitPids === null) return 'unread'
  return f.gitPids.length > 0 || f.isTurnHeld ? 'none' : 'move'
}
/** A130: where a stale lock goes (under Saved/A5R), named by the minute it was moved. */
export const staleLockName = (now: number): string => `index.lock.stale-${ymd(now).replace(/-/g, '')}-${hhmm(now).replace(':', '')}`
/** A130: the one command that moves exactly that file (no wildcard, no delete). */
export const moveLockArgv = (from: string, to: string): string[] => ['powershell', '-NoProfile', '-Command', `Move-Item -LiteralPath '${from.replace(/'/g, "''")}' -Destination '${to.replace(/'/g, "''")}'`]
export const STALE_LOCK_MOVED_FILE = 'index-lock-moved.json'
export type LockMoved = { at: number; to: string; ageMin: number }
export const parseLockMoved = (text: string | null): LockMoved | null => {
  try {
    const v = JSON.parse(text ?? '') as Partial<LockMoved> | null
    return typeof v?.at === 'number' && typeof v.to === 'string' && typeof v.ageMin === 'number' ? { at: v.at, to: v.to, ageMin: v.ageMin } : null
  } catch {
    return null
  }
}
export const lockMovedText = (m: LockMoved): string => `.git/index.lock in the shared checkout was ${m.ageMin} min old with no git of the checkout running and no git turn held: A5R moved it aside to ${m.to} at ${hhmm(m.at)} (never deleted) → run your git command again; tell the person if a commit of yours was cut short then`
/** A130: a git result that failed on the index lock. */
export const isLockFailure = (text: string): boolean => /index\.lock['"]?:?\s*(File exists|exists)|Unable to create .*index\.lock/i.test(text)
export const LOCK_UNREAD_LOOK = { what: '.git/index.lock in the shared checkout is 2 min old or older and the process list could not be read, so A5R cannot tell whether git still runs', next: 'check for git.exe working in the checkout; if none runs, move .git/index.lock aside (never delete it)' }
