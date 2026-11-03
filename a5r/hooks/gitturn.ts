// Rev 44 (L-48): git in the shared checkout one writer at a time. A128: a session's A5R takes a short git turn in
// Saved/A5R/git-turn.json before a git write there runs, and gives it back when the call returns; a second writer is
// refused at once and told when the turn frees. A129: such a call is never cut short (a long tool timeout; no pipe into
// head/tail, no timeout/kill around it). A130: an index.lock that git left behind is moved aside, never deleted.
// Pure: no `$`; register.ts reads the files and the processes, writes the turn and moves the lock.
import { program, tokenize } from './a5r.ts'
import { FREEZE_VERBS, hhmm, ymd } from './coord.ts'
import { gitPlace, type Seg } from './gitshared.ts'

export const GIT_TURN_FILE = 'git-turn.json'
/** A128: a turn whose command has been gone this long (no git of the checkout runs, no index.lock) lapses. */
export const TURN_LAPSE_MS = 2 * 60_000
/** A128: who writes the shared checkout's git now: the session, its lane, the git command (`git commit`), when it began. */
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
export const turnOf = (me: { session: string; id8: string; lane: string }, verbs: readonly string[], now: number): GitTurn => ({ v: 1, session: me.session, id8: me.id8, lane: me.lane, command: `git ${verbs.join(', git ')}`, startedAt: now })

/** A128: the turn as this session reads it. `isLive`: whether a session lives (liveness of every reader); `gone`: since
 * when this reader has seen no git of the checkout running and no index.lock, for the turn it names (goneAfter). */
export type TurnRead = { kind: 'free' } | { kind: 'mine' } | { kind: 'held'; turn: GitTurn } | { kind: 'lapsed'; turn: GitTurn; why: string }
export const readTurn = (turn: GitTurn | null, x: { me8: string; now: number; isLive: (id8: string) => boolean; gone: { key: string; since: number } | null }): TurnRead => {
  if (!turn) return { kind: 'free' }
  if (turn.id8 === x.me8) return { kind: 'mine' }
  if (!x.isLive(turn.id8)) return { kind: 'lapsed', turn, why: 'its session is gone' }
  if (x.gone?.key === turnKey(turn) && x.now - x.gone.since >= TURN_LAPSE_MS) return { kind: 'lapsed', turn, why: `no git of the checkout has run for ${TURN_LAPSE_MS / 60_000} min` }
  return { kind: 'held', turn }
}
const turnKey = (t: GitTurn): string => `${t.id8}:${t.startedAt}`
/** A128: the reader's "command gone since" after one more look: `isRunning` null (the process list unread) or true resets it. */
export const goneAfter = (prev: { key: string; since: number } | null, turn: GitTurn | null, isRunning: boolean | null, now: number): { key: string; since: number } | null => {
  if (!turn || isRunning !== false) return null
  const key = turnKey(turn)
  return prev?.key === key ? prev : { key, since: now }
}
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
/** A129: why a shared-checkout git write in this command could be cut short, or null. `segs`: the command's segments
 * (gitshared.ts walkDeep); `isWrite`: whether a segment is a git write in the shared checkout. */
export const cutProblem = (command: string, segs: readonly Seg[], isWrite: (seg: Seg) => boolean): { why: string; alt: string } | null => {
  const writes = segs.filter(isWrite)
  if (writes.length === 0) return null
  for (const seg of writes) {
    const words = tokenize(seg.raw).map(program)
    if (words.slice(0, words.indexOf('git')).some(w => KILLERS.has(w))) return { why: `\`${seg.raw.trim()}\` puts a time limit on a git write in the shared checkout: a git killed halfway leaves .git/index.lock behind and blocks every session`, alt: plainAlt(seg) }
    const at = command.indexOf(seg.raw)
    const after = at < 0 ? '' : command.slice(at + seg.raw.length)
    const next = segs[segs.indexOf(seg) + 1]
    if (/^\s*\|(?!\|)/.test(after) && next && CUTTERS.has(next.verb)) return { why: `\`${seg.raw.trim()} | ${next.verb}\` pipes a git write in the shared checkout into ${next.verb}, which can end it halfway and leave .git/index.lock behind`, alt: plainAlt(seg) }
  }
  const killer = segs.find(s => KILLERS.has(s.verb))
  return killer ? { why: `\`${killer.raw.trim()}\` runs beside a git write in the shared checkout and can kill it halfway, leaving .git/index.lock behind`, alt: plainAlt(writes[0] as Seg) } : null
}
const plainAlt = (seg: Seg): string => `run the git command alone, in the foreground and unwrapped: git -C ${gitPlace(seg).dir} ${gitPlace(seg).args.join(' ')} (A5R gives the call a 10-min timeout; a slow commit is fine)`

// ---------- A130: a stale index.lock moved aside ----------
export const STALE_LOCK_MS = 2 * 60_000
/** A130: what to do with .git/index.lock: `lockAgeMs` null (none), `gitPids` null (the process list unread), `isTurnHeld`
 * (a session holds the git turn). Every condition must hold for a move; an unread process list asks for a look. */
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
