// Ather Automata: the one owner of what the two halves share. The store keys,
// how stored values are read back, and every change. Changes run one at a time
// so no read-modify-write can interleave with another; reads never wait. Both
// halves import this module, so its change queue and version are shared.
//
// It takes an Io (closures over `$`, built in each half) because `$` itself may
// only be passed to functions in the file that holds it.

import { isHolding, isRecordingQuestions, ledgerWithWindow, newWindow, nextLedgerId, nextParkId, offAway, pendingEntry } from './away.mjs'
import { countGotcha, recurringGotchas, writtenRuleOf } from './guards.mjs'
import { EVIDENCE_TTL_MS, NO_GATE, addPersonAlias, emptyEvidence, intentOwner, isClosedStatus, isSamePerson, personId, rungOfGates, statusOf } from './model.mjs'
import { mayTake } from './autotrack.mjs'
import { forgetPack, packFor } from './packs/index.mjs'
import { unreal } from './packs/unreal.mjs'
import { baseOf } from './team.mjs'
import { checkoutId, checkoutOf, isSameFolder, normalFolder, readWorkspace, repoId } from './workspace.mjs'
import { groupByOf } from './worklist.mjs'
import { paneViewOf } from './home.mjs'
import { isLaneLive, readLane, readPeers } from './heartbeats.mjs'

/**
 * @typedef {{
 *   get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void>, remove: (key: string) => Promise<void>, keys: () => Promise<string[]>,
 *   read: (path: string) => Promise<string | null>, write: (path: string, text: string) => Promise<void>, exists: (path: string) => Promise<boolean>,
 *   sessionId: () => Promise<string>, root: () => Promise<string>, gitUser: (root?: string) => Promise<string>, redraw: () => void,
 *   list?: (path: string) => Promise<{ name: string, kind: string, mtimeMs?: number }[]>,
 *   origin?: (root: string) => Promise<string | null>, repo?: () => Promise<string>,
 *   real?: (folder: string) => Promise<string>,
 *   worktrees?: (root: string) => Promise<string | null>, gitEmail?: (root?: string) => Promise<string>
 * }} Io `gitUser`: git's user.name in the checkout at `root` (a repository may set its own), else in the session folder.
 *   `gitEmail`: git's user.email there, the same way; its name before @ is another name the person goes by
 *   (an intent's Owner may say "vu.le" for "Hoàng Vũ").
 *   `origin`: the remote.origin.url of the checkout at `root`, '' when it has none, null when git could not say.
 *   `repo`: the lane's repository id (repoId), which scopes what is kept per repository and, with the lane's folder,
 *   per checkout (checkoutId); without it the keys are unscoped (as before 0.2.5, and as the Paseo version still keeps them).
 *   `real`: the folder a path really lands in, behind any symbolic link; without it an id holds the folder as given.
 *   `worktrees`: what `git worktree list --porcelain` prints in the checkout at `root`, '' when git refused, null when
 *   git could not say (the workspace is then read again); without it the workspace holds only the session's checkout.
 * @typedef {import('./packs/index.mjs').Pack} Pack
 * @typedef {import('./away.mjs').Away} Away
 * @typedef {import('./model.mjs').Evidence} Evidence
 */

// A key's id within one repository, or one checkout of it (checkoutId): the same slug or person in another is
// another key. No repository (an Io without `repo`) keeps the unscoped key.
/** @param {string} scope @param {string} id */
const inScope = (scope, id) => (scope ? `${scope}|${id}` : id)

const KEY = {
  away: (/** @type {string} */ sid) => `away:${sid}`,
  // The tracked intent: its slug in the session's own checkout, `{ slug, root }` in another.
  pinned: (/** @type {string} */ sid) => `pinned:${sid}`,
  // Beside the pin: when this session last worked on it and whether auto-track set it (autotrack.mjs PinMeta). Goes
  // with the pin (untrack, auto-untrack), moves with the lane, and prune removes it with an ended lane.
  pinMeta: (/** @type {string} */ sid) => `pinMeta:${sid}`,
  evidence: (/** @type {string} */ sid) => `evidence:${sid}`,
  lost: (/** @type {string} */ sid) => `lost:${sid}`,
  // The intents this session stopped tracking: a write into one does not track it again.
  untracked: (/** @type {string} */ sid) => `untracked:${sid}`,
  // This session's keep-warm choice (/warm) and the TTL it learned.
  warm: (/** @type {string} */ sid) => `warm:${sid}`,
  // A pack's roles are its own: a tech artist in S2 is not a role in a web repository. The Unreal pack's key is unprefixed.
  role: (/** @type {string} */ me, /** @type {string} */ prefix = '') => `role:${prefix}${personId(me)}`,
  area: (/** @type {string} */ me) => `area:${personId(me)}`,
  tour: (/** @type {string} */ me) => `tour:${personId(me)}`,
  nudged: (/** @type {string} */ me) => `nudged:${personId(me)}`,
  // How this person groups the teammates' intents in Everything open (person, area, stage or none).
  groupBy: (/** @type {string} */ me) => `groupBy:${personId(me)}`,
  // Home's view for this person: advanced or simple.
  view: (/** @type {string} */ me) => `view:${personId(me)}`,
  // The sessions holding an away window for this person, so a new session finds them without a scan.
  windows: (/** @type {string} */ person) => `windows:${person}`,
  // Kept per repository: gh reads a repository's issues and PRs, whichever of its checkouts asks.
  issues: (/** @type {string} */ me, /** @type {string} */ repo) => `issues:${inScope(repo, personId(me))}`,
  // Kept per checkout: two clones of one repository each have their own "Continue …" and their own files.
  last: (/** @type {string} */ me, /** @type {string} */ checkout) => `last:${inScope(checkout, personId(me))}`,
  // What edits recorded in an intent, newest last: shared by every session on that checkout.
  changes: (/** @type {string} */ slug, /** @type {string} */ checkout) => `changes:${inScope(checkout, slug)}`,
  // What gh last said about the PRs intents name: shared by every session on the machine.
  prs: (/** @type {string} */ repo) => (repo ? `prStates:${repo}` : 'prStates'),
  tz: 'tz',
  hits: 'gotchaHits',
  ruled: 'gotchaRuled',
  score: 'score',
  // What keeping the cache warm did on this machine.
  warmLedger: 'warmLedger',
}
// What belongs to this lane and follows it to a new session id after /clear. Each is `<kind>:<sid>`: prune finds them by LANE_KEY.
const LANE_KEYS = [KEY.away, KEY.pinned, KEY.pinMeta, KEY.evidence, KEY.lost, KEY.untracked, KEY.warm]
const LANE_KEY = new RegExp(`^(?:${LANE_KEYS.map(key => key('').slice(0, -1)).join('|')}):(.+)$`)
// Keep-warm's keys, for warm-store.mjs: the session's choice moves with its lane, the ledger is the machine's.
export const WARM_KEYS = { choice: KEY.warm, ledger: KEY.warmLedger }

let queue = Promise.resolve()
// The one change queue: exported for warm-store.mjs, whose writes take their turn with every other change.
/** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
export const serial = task => {
  const run = queue.then(task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// An issue list older than this is not shown: gh may have stopped answering.
const ISSUES_TTL_MS = 24 * 60 * 60 * 1000

// Bumped on every change, so a drawing can tell its cached view is stale.
let version = 0
export const stateVersion = () => version
/** @param {Io} io */
const changed = io => {
  version += 1
  io.redraw()
}

// ---------------------------------------------------------------- the lane

/** @typedef {{ root: string, repo: string, isS2: boolean, me: string, pack: Pack, base: string, isSure: boolean }} Checkout `base`: the branch its team merges into (team.mjs baseOf) */
// The session's lane by its folder, and each checkout's by its root.
/** @type {Map<string, Promise<Checkout>>} */
const lanes = new Map()
/** @type {Map<string, Promise<Checkout>>} */
const rootLanes = new Map()
// Where each folder really lands, asked once per folder.
/** @type {Map<string, Promise<string>>} */
const realFolders = new Map()

// The folder an id is made from: where the path really lands, so a checkout reached through a symbolic link
// (macOS's /tmp, a linked projects folder) has the id it has by its real path. Only for ids: files are read
// and git is run in the folder as given. An Io that cannot say, or a folder it could not resolve, keeps it as given.
/** @param {Io} io @param {string} folder */
const realFolder = (io, folder) => {
  const { real } = io
  if (!real || folder === '') return Promise.resolve(folder)
  const cached = realFolders.get(folder)
  if (cached) return cached
  const reading = real(folder).then(
    found => found || folder,
    () => {
      // Asked again next time, never kept.
      realFolders.delete(folder)
      return folder
    },
  )
  realFolders.set(folder, reading)
  return reading
}

// Roots read without intents. One that has them at a later read got them in this session:
// its profile is new, so its pack is chosen again and each half is told.
/** @type {Set<string>} */
const bare = new Set()
/** @type {Map<string, (pack: Pack) => unknown>} */
const setUpHandlers = new Map()

// What a half does when a repository is set up mid-session; one handler per `who`, the last one kept.
/** @param {string} who @param {(pack: Pack) => unknown} handler */
export const onSetUp = (who, handler) => void setUpHandlers.set(who, handler)

// Who and where, read once per checkout and shared by both halves. `isS2`: the repository runs intents
// (a docs/intent folder), whatever its kind; `pack` says which kind (packs/index.mjs, once per session);
// `repo` which repository it is (repoId), when the Io can say. `userRoot`: where git's user name is read,
// none for the session's own lane, which reads it in the session folder as it always has.
/** @param {Io} io @param {string} root @param {string} [userRoot] */
const readCheckout = async (io, root, userRoot) => {
  const list = io.list ?? (async () => [])
  const { pack, profile, defaultBranch } = await packFor({ read: io.read, exists: io.exists, list, sessionId: io.sessionId }, root).catch(() => ({ pack: unreal, profile: null, defaultBranch: '' }))
  const origin = io.origin ? await io.origin(root).catch(() => null) : ''
  const me = await (userRoot === undefined ? io.gitUser() : io.gitUser(userRoot)).catch(() => '')
  const email = io.gitEmail ? await (userRoot === undefined ? io.gitEmail() : io.gitEmail(userRoot)).catch(() => '') : ''
  if (me !== '' && email.includes('@')) addPersonAlias(me, email.split('@')[0] ?? '')
  return { root, repo: io.origin ? repoId(origin ?? '', await realFolder(io, root)) : '', isS2: await io.exists(`${root}/docs/intent`), me, pack, base: baseOf(profile, defaultBranch), isSure: me !== '' && origin !== null }
}

/** @param {typeof lanes} cache @param {string} key @param {() => Promise<Checkout>} read */
const cachedLane = (cache, key, read) => {
  const cached = cache.get(key)
  if (cached) return cached
  const reading = read()
  cache.set(key, reading)
  // A git name or origin that failed to read (a slow first start) is asked again next time, never kept.
  void reading.then(found => {
    if (!found.isSure && cache.get(key) === reading) cache.delete(key)
  })
  return reading
}

// The session's lane: the lane of its own folder's root, which need not be a checkout.
/** @param {Io} io @param {string} cwd */
export const lane = (io, cwd) =>
  cachedLane(lanes, cwd, async () => {
    const root = (await io.root().catch(() => cwd)) || cwd
    const isS2 = await io.exists(`${root}/docs/intent`)
    const isSetUp = isS2 && bare.delete(root)
    if (!isS2) bare.add(root)
    if (isSetUp) {
      await forgetPack({ sessionId: io.sessionId }, root)
      // The same folder read as a workspace checkout (laneAt) was kept without intents, with the old pack.
      for (const kept of [...rootLanes.keys()]) {
        if (normalFolder(kept) !== normalFolder(root)) continue
        rootLanes.delete(kept)
        await forgetPack({ sessionId: io.sessionId }, kept)
      }
    }
    const found = { ...(await readCheckout(io, root)), isS2 }
    // A handler that fails must not cost the reading.
    if (isSetUp) for (const handler of setUpHandlers.values()) await Promise.resolve().then(() => handler(found.pack)).catch(() => undefined)
    return found
  })

// Any checkout's lane, by its root: its own pack and repository.
/** @param {Io} io @param {string} root */
export const laneAt = (io, root) => cachedLane(rootLanes, root, () => readCheckout(io, root, root))

// The checkout a command's folder is in (null: the session folder; a relative one is taken from the session's
// root) and its lane. `isOwn`: it is the session's own checkout, or in no checkout at all; both use the session's lane.
/** @param {Io} io @param {Checkout} session the session's lane @param {string | null} folder @returns {Promise<{ lane: Checkout, isOwn: boolean }>} */
export const folderLane = async (io, session, folder) => {
  if (folder === null) return { lane: session, isOwn: true }
  const root = await checkoutOf(io, /^([A-Za-z]:[\\/]|[\\/])/.test(folder) ? folder : `${session.root}/${folder}`)
  if (root === null || root === (await checkoutOf(io, session.root))) return { lane: session, isOwn: true }
  return { lane: await laneAt(io, root), isOwn: false }
}

/** @typedef {{ roots: string[], left: string[], isSure: boolean }} Workspace */
/** @type {Map<string, Promise<Workspace>>} */
const workspaces = new Map()
// What the debug log last heard of each workspace: a read that finds the same is not said again.
/** @type {Map<string, string>} */
const workspacesSaid = new Map()

// The session's workspace (workspace.mjs), read once per session folder. A read git could not answer in full
// (not sure) is shared by the callers waiting on it and then forgotten: the next call reads again.
/** @param {Io} io @param {string} folder the session folder @param {(line: string) => void} log */
const readWorkspaceOnce = (io, folder, log) => {
  const key = normalFolder(folder)
  const cached = workspaces.get(key)
  if (cached) return cached
  const { real, worktrees } = io
  const files = { read: io.read, exists: io.exists, ...(worktrees ? { worktrees } : {}), ...(real ? { real: (/** @type {string} */ one) => realFolder(io, one) } : {}) }
  const reading = readWorkspace(files, folder)
    .catch(() => /** @type {Workspace} */ ({ roots: [], left: [], isSure: true }))
    .then(found => {
      if (!found.isSure && workspaces.get(key) === reading) workspaces.delete(key)
      const lines = [`Ather: workspace ${found.roots.join(', ') || '(no checkout)'}`, ...(found.left.length > 0 ? [`Ather: workspace is full; left out ${found.left.join(', ')}`] : [])]
      if (workspacesSaid.get(key) !== lines.join('\n')) for (const line of lines) log(line)
      workspacesSaid.set(key, lines.join('\n'))
      return found
    })
  workspaces.set(key, reading)
  return reading
}

// The session's checkout and its clone's worktrees after it (`roots`), shared by both halves. `isSure` false: git
// could not list the worktrees, and the next call reads again. `log` hears what the workspace holds and what
// the limit left out, once per read that finds something new.
/** @param {Io} io @param {string} folder the session folder @param {(line: string) => void} [log] @returns {Promise<{ roots: string[], isSure: boolean }>} */
export const workspace = (io, folder, log = () => undefined) => readWorkspaceOnce(io, folder, log).then(({ roots, isSure }) => ({ roots, isSure }))

/** @param {Io} io */
const repoOf = io => (io.repo ? io.repo().catch(() => '') : Promise.resolve(''))

/** @param {Io} io @param {string} root */
const isSessionRoot = async (io, root) => isSameFolder(root, await io.root().catch(() => ''))

// The checkout a folder holding docs/intent is, by its id: the session's own for its root, else that folder's.
/** @param {Io} io @param {string} [root] */
const checkoutAt = async (io, root) => (root === undefined || (await isSessionRoot(io, root)) ? checkoutId(await repoOf(io), await realFolder(io, await io.root().catch(() => ''))) : checkoutId((await laneAt(io, normalFolder(root))).repo, await realFolder(io, root)))

// Before 0.2.5 a key had no repository in it. A scoped key not written yet reads the unscoped one, once
// per upgrade: the next write goes to the scoped key, and the old one ages out on its own.
/** @param {Io} io @param {string} scoped @param {string} legacy */
const readScoped = async (io, scoped, legacy) => {
  const value = await io.get(scoped)
  return value !== undefined || scoped === legacy ? value : io.get(legacy)
}

// For /ather where there were no intents: the person may have added them in this session. A kept
// reading without intents is dropped once the folder is there, and the checkout read again. A lane
// that runs intents is kept as read.
/** @param {Io} io @param {string} cwd */
export const laneAgain = async (io, cwd) => {
  const kept = lane(io, cwd)
  const found = await kept
  if (found.isS2 || !(await io.exists(`${found.root}/docs/intent`))) return found
  if (lanes.get(cwd) === kept) lanes.delete(cwd)
  return lane(io, cwd)
}

/** @param {Io} io */
export const sessionId = io => io.sessionId()

// After /clear the process goes on under a new session id and no session.start fires:
// this lane's window, tracked intent, evidence, lost-edits flag and untracked intents move to it. Only
// /clear moves them; a resume returns to another conversation, whose state is its own.
/** @param {Io} io @param {string} from @param {string} to */
export const moveLane = (io, from, to) =>
  serial(async () => {
    const away = /** @type {Away | undefined} */ (await io.get(KEY.away(from)))
    for (const key of LANE_KEYS) {
      const value = await io.get(key(from))
      if (value === undefined) continue
      if ((await io.get(key(to))) === undefined) await io.set(key(to), value)
      await io.remove(key(from))
    }
    if (away?.person) await setIndex(io, away.person, list => [...list.filter(sid => sid !== from), to])
    changed(io)
  })

/** @param {Io} io @param {string} person @param {(list: string[]) => string[]} change */
const setIndex = async (io, person, change) => {
  const list = /** @type {string[]} */ ((await io.get(KEY.windows(person))) ?? [])
  const next = [...new Set(change(list))]
  if (next.length === 0) await io.remove(KEY.windows(person))
  else await io.set(KEY.windows(person), next)
}

// ---------------------------------------------------------------- reading

// A session's stored window, off when it has none.
/** @param {Io} io @param {string} sid @returns {Promise<Away>} */
const awayOf = async (io, sid) => /** @type {Away} */ ({ ...offAway(), .../** @type {object} */ ((await io.get(KEY.away(sid))) ?? {}) })
/** @param {Io} io */
export const readAway = async io => awayOf(io, await io.sessionId())
// Where evidence is kept: with the tracked intent, so yesterday's build and tests still count
// today; with the session when nothing is tracked. Each record is good for a day (EVIDENCE_TTL_MS).
/** @param {Io} io */
export const evidenceScope = async io => {
  const pin = await readPin(io)
  return pin === null ? io.sessionId() : intentScope(io, pin.slug, pin.isOwn ? undefined : pin.root)
}

// Where a shell command's proof goes, by the checkout it ran in (`root`, its top folder): the tracked
// intent's checkout proves the intent; otherwise it is this session's proof there, `<sid>` in its own
// checkout and `<sid>|<checkout id>` in another.
/** @param {Io} io @param {{ isOwn: boolean, repo: string, root?: string }} checkout */
export const checkoutScope = async (io, checkout) => {
  const pin = await readPin(io)
  const isIntents = pin !== null && (checkout.isOwn ? pin.isOwn : !pin.isOwn && normalFolder(pin.root) === normalFolder(checkout.root ?? ''))
  if (isIntents) return evidenceScope(io)
  return checkout.isOwn ? io.sessionId() : `${await io.sessionId()}|${checkoutId(checkout.repo, await realFolder(io, checkout.root ?? ''))}`
}

// An intent's evidence scope: the intent in its checkout, as evidenceScope names it. `root`: the folder
// holding its docs/intent, when that is not the session's.
/** @param {Io} io @param {string} slug @param {string} [root] */
export const intentScope = async (io, slug, root) => inScope(await checkoutAt(io, root), slug)

// What is kept for a scope: an intent's from before 0.2.5 too, while its scoped record has none. Only an
// intent in the session's own checkout: that proof was never another checkout's.
/** @param {Io} io @param {string} scope */
const storedEvidence = async (io, scope) => {
  const own = await checkoutAt(io)
  const legacy = own && scope.startsWith(`${own}|`) ? scope.slice(own.length + 1) : scope
  return /** @type {Record<string, any>} */ ((await readScoped(io, KEY.evidence(scope), KEY.evidence(legacy))) ?? {})
}

/** @param {Io} io @param {string} scope from evidenceScope @param {Pack} [pack] @returns {Promise<Evidence>} */
export const readEvidence = async (io, scope, pack = unreal) => {
  const stored = /** @type {Record<string, { state: string, detail: string, at?: number, gates?: Record<string, import('./model.mjs').Rung> }>} */ (await storedEvidence(io, scope))
  const fresh = Object.fromEntries(Object.entries(stored).filter(([, rung]) => Date.now() - (rung.at ?? 0) < EVIDENCE_TTL_MS))
  const gated = Object.fromEntries(Object.entries(pack.rungGates ?? {}).map(([rung, all]) => [rung, rungOfGates(stored[rung]?.gates, all)]))
  return /** @type {Evidence} */ ({ ...emptyEvidence(pack), ...fresh, ...gated })
}

// A session as people see it named: the first 8 hex of its id, as the Editor lock and the tab list show it.
/** @param {string} sid */
export const shortSession = sid => sid.slice(0, 8)

// Writes one scope's evidence, each record stamped with when it was seen and `by` the session that saw it.
/** @param {Io} io @param {string} scope @param {Partial<Evidence>} change */
const writeEvidence = async (io, scope, change) => {
  const stored = await storedEvidence(io, scope)
  const by = shortSession(await io.sessionId())
  const stamped = Object.fromEntries(Object.entries(change).map(([rung, value]) => [rung, { ...value, at: Date.now(), by }]))
  await io.set(KEY.evidence(scope), { ...stored, ...stamped })
  changed(io)
}
// The tracked intent as stored: a plain slug is in the session's own root.
/** @param {Io} io @returns {Promise<{ slug: string, root: string, isOwn: boolean } | null>} */
const readPin = async io => {
  const value = /** @type {unknown} */ (await io.get(KEY.pinned(await io.sessionId())))
  if (typeof value === 'string') return { slug: value, root: await io.root().catch(() => ''), isOwn: true }
  const pin = /** @type {{ slug?: unknown, root?: unknown } | null | undefined} */ (value)
  return typeof pin?.slug === 'string' && typeof pin.root === 'string' ? { slug: pin.slug, root: pin.root, isOwn: false } : null
}
/** @param {Io} io @returns {Promise<string | null>} */
export const readPinned = async io => (await readPin(io))?.slug ?? null
// The tracked intent and the folder holding its docs/intent.
/** @param {Io} io @returns {Promise<{ slug: string, root: string } | null>} */
export const readTracked = async io => {
  const pin = await readPin(io)
  return pin && { slug: pin.slug, root: pin.root }
}
// The tracked intent with the lane its files are read with: the session's own lane, or its checkout's.
/** @param {Io} io @param {string} cwd @returns {Promise<{ slug: string, isOwn: boolean, lane: Checkout } | null>} */
export const trackedLane = async (io, cwd) => {
  const pin = await readPin(io)
  if (pin === null) return null
  return { slug: pin.slug, isOwn: pin.isOwn, lane: pin.isOwn ? await lane(io, cwd) : await laneAt(io, pin.root) }
}
/** @param {Io} io @returns {Promise<{ paths: string[], isDisclosed: boolean } | null>} */
export const readLost = async io => /** @type {any} */ ((await io.get(KEY.lost(await io.sessionId()))) ?? null)
/** @param {Io} io */
export const readTz = async io => Number(await io.get(KEY.tz)) || 0
/** @param {Io} io @param {string} me @param {Pack} [pack] */
export const readProfile = async (io, me, pack = unreal) => ({
  role: String((await io.get(KEY.role(me, pack.roleKey))) ?? ''),
  area: String((await io.get(KEY.area(me))) ?? ''),
  tourDone: /** @type {{ isDone?: boolean } | undefined} */ (await io.get(KEY.tour(me)))?.isDone === true,
  isNudged: (await io.get(KEY.nudged(me))) === true,
})
// A trap whose rule is already written in the checkout is not offered again, however many sessions hit it.
/** @param {Io} io @param {Pack} [pack] */
export const readRecurring = async (io, pack = unreal) => {
  const recurring = recurringGotchas(/** @type {any} */ ((await io.get(KEY.hits)) ?? {}), /** @type {string[]} */ ((await io.get(KEY.ruled)) ?? []), pack)
  if (recurring.length === 0) return recurring
  const root = await io.root().catch(() => '')
  const isWritten = await Promise.all(recurring.map(async one => {
    const rule = writtenRuleOf(one.id, pack)
    return Boolean(rule && root && (await io.read(`${root}/${rule.file}`))?.includes(rule.text))
  }))
  return recurring.filter((_, index) => !isWritten[index])
}
// The issues, PR records and PR states below are the session's repository's, or with `repo` that repository's.
/** @param {Io} io @param {string} me @param {string} [repo] @returns {Promise<import('./issues.mjs').Issue[]>} */
export const readIssues = async (io, me, repo) => {
  const cached = /** @type {{ at?: number, list?: import('./issues.mjs').Issue[] } | undefined} */ (await io.get(KEY.issues(me, repo ?? (await repoOf(io)))))
  return cached?.list && Date.now() - (cached.at ?? 0) < ISSUES_TTL_MS ? cached.list : []
}
/** @param {Io} io @param {string} [repo] @returns {Promise<Record<string, import('./prs.mjs').PrRecord>>} */
export const readPrRecords = async (io, repo) => /** @type {Record<string, import('./prs.mjs').PrRecord>} */ ((await io.get(KEY.prs(repo ?? (await repoOf(io))))) ?? {})
// PR number → its last read state, for the pure readers in model.mjs.
/** @param {Io} io @param {string} [repo] @returns {Promise<import('./model.mjs').PrStates>} */
export const readPrStates = async (io, repo) => Object.fromEntries(Object.entries(await readPrRecords(io, repo)).map(([number, record]) => [number, record.state]))
// The person's "Continue …" in a checkout: the session's, or with `root` the one holding that docs/intent.
/** @param {Io} io @param {string} me @param {string} [root] @returns {Promise<string | null>} */
export const readLast = async (io, me, root) => {
  const scoped = KEY.last(me, await checkoutAt(io, root))
  // Only the session's own checkout reads through to the key from before 0.2.5.
  const isOwn = root === undefined || (await isSessionRoot(io, root))
  return /** @type {string | null} */ ((await readScoped(io, scoped, isOwn ? KEY.last(me, '') : scoped)) ?? null)
}
// The person's grouping for Everything open; Person until they choose another.
/** @param {Io} io @param {string} me */
export const readGroupBy = async (io, me) => groupByOf(await io.get(KEY.groupBy(me)))
// The person's Home view; Advanced until they choose Simple.
/** @param {Io} io @param {string} me */
export const readPaneView = async (io, me) => paneViewOf(await io.get(KEY.view(me)))
/** @param {Io} io */
export const readScore = async io => /** @type {Record<string, number>} */ ((await io.get(KEY.score)) ?? {})

// ---------------------------------------------------------------- changing

// A setter whose write shows nothing new (the same issues read again, the same PR states) stamps its time and
// draws nothing again: a redraw can lose a press on the desktop (console.mjs, redrawAged).

/** @param {Io} io @param {string} me @param {import('./issues.mjs').Issue[]} issues @param {string} [repo] */
export const setIssues = (io, me, issues, repo) =>
  serial(async () => {
    const shown = await readIssues(io, me, repo)
    await io.set(KEY.issues(me, repo ?? (await repoOf(io))), { at: Date.now(), list: issues })
    if (JSON.stringify(issues) !== JSON.stringify(shown)) changed(io)
  })

// A PR record not read again for this long is dropped: its intent has closed or moved on.
const PRS_TTL_MS = 30 * 24 * 60 * 60 * 1000

// What gh just said about some PRs ('UNREAD' when it could not say), each stamped `at`.
/** @param {Io} io @param {import('./model.mjs').PrStates} states @param {number} at @param {string} [repo] */
export const setPrStates = (io, states, at, repo) =>
  serial(async () => {
    if (Object.keys(states).length === 0) return
    const scope = repo ?? (await repoOf(io))
    const records = await readPrRecords(io, scope)
    const kept = Object.entries(records).filter(([, record]) => at - record.at < PRS_TTL_MS)
    await io.set(KEY.prs(scope), { ...Object.fromEntries(kept), ...Object.fromEntries(Object.entries(states).map(([number, value]) => [number, { state: value, at }])) })
    if (kept.length < Object.keys(records).length || Object.entries(states).some(([number, value]) => records[number]?.state !== value)) changed(io)
  })

const CHANGES_KEPT = 20
const CHANGES_TTL_MS = 36 * 60 * 60 * 1000

/** @typedef {import('./changes.mjs').Change & { at: number }} Recorded */

// The lines an intent gained, newest first, from `since` on (the start of the person's day).
// `root`: the folder holding its docs/intent, when that is not the session's.
/** @param {Io} io @param {string} slug @param {number} since @param {string} [root] @returns {Promise<Recorded[]>} */
export const readChanges = async (io, slug, since, root) => (/** @type {Recorded[]} */ ((await io.get(KEY.changes(slug, await checkoutAt(io, root)))) ?? [])).filter(one => one.at >= since).reverse()

// An edit's lines join the intent's, in the checkout edited (`root`, as readChanges);
// the same line again (a re-tick, a rewrite) replaces the older one.
/** @param {Io} io @param {string} slug @param {readonly import('./changes.mjs').Change[]} lines @param {number} at @param {string} [root] */
export const noteChanges = (io, slug, lines, at, root) =>
  serial(async () => {
    if (lines.length === 0) return
    const key = KEY.changes(slug, await checkoutAt(io, root))
    const kept = /** @type {Recorded[]} */ ((await io.get(key)) ?? []).filter(one => at - one.at < CHANGES_TTL_MS && !lines.some(line => line.kind === one.kind && line.id === one.id))
    await io.set(key, [...kept, ...lines.map(line => ({ ...line, at }))].slice(-CHANGES_KEPT))
    changed(io)
  })

/** @param {Io} io @param {number} offset */
export const setTz = (io, offset) => serial(() => io.set(KEY.tz, offset))

// Before 0.9 the role was kept per machine under "coach"; it becomes this person's.
/** @param {Io} io @param {string} me */
export const migrateRole = (io, me) =>
  serial(async () => {
    const legacy = /** @type {{ role?: string } | undefined} */ (await io.get('coach'))
    if (!legacy) return
    if ((await io.get(KEY.role(me))) === undefined && legacy.role) await io.set(KEY.role(me), legacy.role)
    await io.remove('coach')
  })

/** @param {Io} io @param {string} me @param {{ role?: string, area?: string, tourDone?: boolean, isNudged?: boolean }} fields @param {Pack} [pack] */
export const setProfile = (io, me, fields, pack = unreal) =>
  serial(async () => {
    if (fields.role !== undefined) await io.set(KEY.role(me, pack.roleKey), fields.role)
    if (fields.area !== undefined) await io.set(KEY.area(me), fields.area)
    if (fields.tourDone !== undefined) await io.set(KEY.tour(me), { isDone: fields.tourDone })
    if (fields.isNudged !== undefined) await io.set(KEY.nudged(me), fields.isNudged)
    changed(io)
  })

/** @param {Io} io @param {string} me @param {import('./worklist.mjs').GroupBy} by */
export const setGroupBy = (io, me, by) =>
  serial(async () => {
    await io.set(KEY.groupBy(me), by)
    changed(io)
  })

/** @param {Io} io @param {string} me @param {import('./home.mjs').PaneView} view */
export const setPaneView = (io, me, view) =>
  serial(async () => {
    await io.set(KEY.view(me), view)
    changed(io)
  })

// Whether this checkout has the intent's folder: what tracking it needs (asking about it does not).
/** @param {Io} io @param {string} root @param {string} slug */
export const hasIntentFolder = (io, root, slug) => io.exists(`${root}/docs/intent/${slug}/prompt.md`)

// A stop on tracking an intent: its plain slug in the session's own checkout, `{ slug, root }` in another,
// so the same slug in two checkouts is stopped on its own.
/** @typedef {string | { slug: string, root: string }} Stop */
/** @param {Stop} stop @param {string} slug @param {string | null} root null: the session's own checkout */
const isStopOf = (stop, slug, root) => (typeof stop === 'string' ? root === null && stop === slug : root !== null && stop?.slug === slug && isSameFolder(stop.root, root))
/** @param {Io} io @param {string} sid @returns {Promise<Stop[]>} */
const readStops = async (io, sid) => /** @type {Stop[]} */ ((await io.get(KEY.untracked(sid))) ?? [])

// An intent to track: its slug, the folder holding its docs/intent (`at`), and whether that is the session's root.
/** @typedef {{ slug: string, at: string, isOwn: boolean }} Target */
/** @param {Io} io @param {string} root @param {string} slug @returns {Promise<Target | null>} */
const targetOf = async (io, root, slug) => {
  const isOwn = await isSessionRoot(io, root)
  const at = isOwn ? root : normalFolder(root)
  return (await hasIntentFolder(io, at, slug)) ? { slug, at, isOwn } : null
}
/** @param {Stop} stop @param {Target} target */
const stopsTarget = (stop, { slug, at, isOwn }) => isStopOf(stop, slug, isOwn ? null : at)

/** @typedef {import('./autotrack.mjs').PinMeta} PinMeta */
// The pin (null: none) with its PinMeta, its time now (this session's work on it starts now); the heartbeat at once.
/** @param {Io} io @param {string} sid @param {Target | null} target @param {Omit<PinMeta, 'at'>} [meta] */
const setPin = async (io, sid, target, meta = { isAuto: false }) => {
  if (target === null) for (const key of [KEY.pinned(sid), KEY.pinMeta(sid)]) await io.remove(key)
  else {
    await io.set(KEY.pinned(sid), target.isOwn ? target.slug : { slug: target.slug, root: target.at })
    await io.set(KEY.pinMeta(sid), { ...meta, at: Date.now() })
  }
  await beat(io)
  changed(io)
}
/** @param {Io} io @param {string} sid @returns {Promise<PinMeta | null>} */
const readPinMeta = async (io, sid) => /** @type {PinMeta | undefined} */ (await io.get(KEY.pinMeta(sid))) ?? null

// Whether an intent's status closes it (completed or parked): auto-track neither takes nor keeps one.
/** @param {Io} io @param {string} root @param {string} slug */
const isClosedAt = async (io, root, slug) => isClosedStatus(statusOf((await io.read(`${root}/docs/intent/${slug}/prompt.md`)) ?? ''))
// What keeps auto-track off an intent: its folder is in no checkout of its own (a scratch or temp draft), its status
// closes it, or another live session on its checkout tracks it (by slug: one tracking it elsewhere counts too).
/** @param {Io} io @param {Target} target */
const isBlockedAt = async (io, { slug, at }) =>
  !isSameFolder((await checkoutOf(io, at)) ?? '', at) || (await isClosedAt(io, at, slug)) || (await readPeers(io, at, (await laneAt(io, at)).pack.localDir)).some(one => one.intent === slug)

// Tracks an intent on purpose, if it exists: /ather, the profile tool, the Intent view. `root`: the folder holding
// its docs/intent, the session's own or another checkout's. It lifts a stop on that intent. `me`: the person's
// "Continue …" in its checkout moves to it too.
/** @param {Io} io @param {string} root @param {string} slug @param {{ me?: string }} [options] */
export const track = (io, root, slug, options = {}) =>
  serial(async () => {
    const target = await targetOf(io, root, slug)
    if (target === null) return false
    const sid = await io.sessionId()
    if (options.me) {
      const last = KEY.last(options.me, await checkoutAt(io, target.at))
      await io.set(last, slug)
      // Once the own checkout's scoped "Continue …" is written, the unscoped one from before 0.2.5 must not
      // read through again. Tracking in another checkout leaves it: it is still the own checkout's.
      if (target.isOwn && last !== KEY.last(options.me, '')) await io.remove(KEY.last(options.me, ''))
    }
    const stopped = await readStops(io, sid)
    if (stopped.some(one => stopsTarget(one, target))) await setList(io, KEY.untracked(sid), stopped.filter(one => !stopsTarget(one, target)))
    await setPin(io, sid, target)
    return true
  })

// Auto-track: this session worked on an intent (`isNew`: it just started it), never one it stopped tracking. Work on
// the tracked one notes its time (a deliberate pin stays so); another is taken if mayTake says so and nothing blocks
// it, with its checkout's branch (`branchOf`) and the deliberate pin it replaces (`back`). Resolves if taken.
/** @param {Io} io @param {string} root @param {string} slug @param {{ isNew?: boolean, branchOf: (root: string) => Promise<string> }} at */
export const autoTrack = (io, root, slug, { isNew = false, branchOf }) =>
  serial(async () => {
    const target = await targetOf(io, root, slug)
    const sid = await io.sessionId()
    if (target === null || (await readStops(io, sid)).some(one => stopsTarget(one, target))) return false
    const [tracked, meta] = [await readPin(io), await readPinMeta(io, sid)]
    if (tracked !== null && tracked.slug === slug && (tracked.isOwn ? target.isOwn : isSameFolder(tracked.root, target.at))) {
      await io.set(KEY.pinMeta(sid), { ...(meta ?? { isAuto: false }), at: Date.now() })
      return false
    }
    if (!mayTake({ hasPin: tracked !== null, meta, isAway: (await awayOf(io, sid)).phase === 'running', isNew, now: Date.now() }) || (await isBlockedAt(io, target))) return false
    const back = meta?.isAuto ? meta.back : tracked === null ? undefined : { slug: tracked.slug, root: tracked.root }
    await setPin(io, sid, target, { isAuto: true, branch: await branchOf(target.at).catch(() => ''), ...(back ? { back } : {}) })
    return true
  })

// Stops tracking: the session's pin, the person's "Continue …" when it names the same intent, and a
// stop on a write tracking it again in this session. Proof recorded so far stays with the intent.
// Refused while an away window runs: its mandate and ledger were set up for the tracked intent.
/** @param {Io} io @param {string} me @returns {Promise<{ result: 'untracked' | 'none' | 'away', slug: string }>} */
export const untrack = (io, me) =>
  serial(async () => {
    const sid = await io.sessionId()
    const pin = await readPin(io)
    if (pin === null) return { result: /** @type {const} */ ('none'), slug: '' }
    const { slug } = pin
    const away = await awayOf(io, sid)
    if (away.phase === 'running') return { result: /** @type {const} */ ('away'), slug }
    // The unscoped "Continue …" from before 0.2.5 goes too, or it would read through again.
    for (const key of new Set([KEY.last(me, await checkoutAt(io, pin.isOwn ? undefined : pin.root)), ...(pin.isOwn ? [KEY.last(me, '')] : [])])) if ((await io.get(key)) === slug) await io.remove(key)
    const stopped = (await readStops(io, sid)).filter(one => !isStopOf(one, slug, pin.isOwn ? null : pin.root))
    await setList(io, KEY.untracked(sid), [...stopped, pin.isOwn ? slug : { slug, root: pin.root }])
    await setPin(io, sid, null)
    return { result: /** @type {const} */ ('untracked'), slug }
  })

// Auto-untrack: a pin auto-track set goes once its intent's status says completed or parked, read on the branch it
// was taken on (`branchOf` its checkout: on another branch it waits), with no stop (work on it after it reopens takes
// it again); the deliberate pin it replaced comes back. A deliberate track stays, and any pin while an away window
// runs. Resolves the slug let go and the one back ('' for none), or null.
/** @param {Io} io @param {(root: string) => Promise<string>} branchOf @returns {Promise<{ slug: string, back: string } | null>} */
export const untrackClosed = (io, branchOf) =>
  serial(async () => {
    const sid = await io.sessionId()
    const [tracked, meta] = [await readPin(io), await readPinMeta(io, sid)]
    if (tracked === null || meta?.isAuto !== true || (await awayOf(io, sid)).phase === 'running') return null
    if ((meta.branch && meta.branch !== (await branchOf(tracked.root).catch(() => ''))) || !(await isClosedAt(io, tracked.root, tracked.slug))) return null
    const back = meta.back ? await targetOf(io, meta.back.root, meta.back.slug) : null
    await setPin(io, sid, back)
    return { slug: tracked.slug, back: back?.slug ?? '' }
  })

/** @param {Io} io @param {string} key @param {Stop[]} list */
const setList = async (io, key, list) => {
  const kept = [...new Set(list)]
  if (kept.length === 0) await io.remove(key)
  else await io.set(key, kept)
}

// ---------------------------------------------------------------- lanes: the heartbeats of the sessions on this checkout

// The heartbeats (heartbeats.mjs) as this module has always exported them.
/** @typedef {import('./heartbeats.mjs').Lane} Lane @typedef {import('./heartbeats.mjs').AppSession} AppSession */
export { isLaneLive, readLane, readPeers }

// When this session last took a prompt or ran a tool; a hot reload starts it again.
let activeAt = Date.now()
/** @param {number} [at] */
export const markActive = (at = Date.now()) => {
  activeAt = at
}

// This session as the desktop app knows it (watch.mjs asks the app's session tool), written into every heartbeat
// so other sessions can name it and send to it; null outside the app.
/** @type {AppSession | null} */
let appSelf = null
/** @param {AppSession | null} app */
export const setAppSession = app => {
  appSelf = app
}
export const appSession = () => appSelf

// The heartbeats last written. `isHome`: the session's own checkout's, which always names the tracked intent.
/** @type {{ path: string, lane: Lane, isHome?: boolean }[]} */
let lastBeats = []

// Writes this session's heartbeat; after any change in hand, so it never undoes one. `also`: the tracked
// intent's checkout, when it is not the session's, so its sessions see this one. A checkout written to
// earlier keeps a live heartbeat (naming no intent) until the session ends: one that went stale or said
// ended there would let its sessions take this one for gone and prune its lane. `root` '': the session
// folder is no checkout with intents (a parent folder), so only `also` and earlier checkouts are written.
/** @param {Io} io @param {{ root: string, localDir: string, branch: string, hasEnded: boolean, also?: { root: string, localDir: string, branch: string } | null }} at */
export const writeHeartbeat = (io, at) =>
  serial(async () => {
    const sid = await io.sessionId()
    const away = await readAway(io)
    /** @type {Lane} */
    const lane = { sessionId: sid, intent: await readPinned(io), branch: at.branch, updatedAt: Date.now(), lastActiveAt: activeAt, away: away.phase, hasEnded: at.hasEnded, root: at.root, ...(appSelf ? { app: appSelf } : {}) }
    /** @type {typeof lastBeats} */
    const beats = at.root ? [{ path: `${at.root}/${at.localDir}/lanes/${sid}.json`, lane, isHome: true }] : []
    if (at.also) beats.push({ path: `${at.also.root}/${at.also.localDir}/lanes/${sid}.json`, lane: { ...lane, branch: at.also.branch } })
    for (const old of lastBeats) {
      if (old.lane.sessionId !== sid || beats.some(one => one.path === old.path) || !(await io.exists(old.path))) continue
      beats.push({ path: old.path, lane: { ...lane, intent: null, branch: old.lane.branch } })
    }
    for (const one of beats) await io.write(one.path, JSON.stringify(one.lane))
    lastBeats = beats
  })

// Whether this session has written a heartbeat anywhere yet.
export const hasHeartbeats = () => lastBeats.length > 0

// The heartbeat again, at once, when what the session tracks changes: peers see it before the next tick.
/** @param {Io} io */
const beat = async io => {
  const sid = await io.sessionId()
  const intent = await readPinned(io)
  lastBeats = await Promise.all(lastBeats.map(async old => {
    // Only over a heartbeat that is still there: never brings back one a cleanup removed. A checkout
    // other than the session's names the intent only while it is the tracked intent's (the next tick says).
    if (old.lane.sessionId !== sid || !(await io.exists(old.path))) return old
    const lane = { ...old.lane, intent: old.isHome || old.lane.intent === intent ? intent : null, updatedAt: Date.now(), lastActiveAt: activeAt }
    await io.write(old.path, JSON.stringify(lane)).catch(() => undefined)
    return { ...old, lane }
  }))
}

// `gates`: on a rung that gates declare, the run replaces the result of each gate it ran and no other; a
// command that is no gate is kept beside them until one of the rung's gates is next run.
/** @param {Io} io @param {string} scope @param {keyof Evidence} rung @param {import('./model.mjs').Rung} value @param {import('./packs/index.mjs').RungGates} [gates] */
export const setRung = (io, scope, rung, value, gates) =>
  serial(async () => {
    const result = { state: value.state, detail: value.detail.slice(0, 120) }
    if (!gates) return writeEvidence(io, scope, { [rung]: result })
    const stored = await storedEvidence(io, scope)
    const stamped = { ...result, at: Date.now(), by: shortSession(await io.sessionId()) }
    const before = Object.entries(/** @type {Record<string, import('./model.mjs').Rung>} */ (stored[rung]?.gates ?? {})).filter(([key]) => key !== NO_GATE)
    const kept = Object.fromEntries([...before, ...(gates.ran.length > 0 ? gates.ran : [NO_GATE]).map(key => /** @type {[string, import('./model.mjs').Rung]} */ ([key, stamped]))])
    await io.set(KEY.evidence(scope), { ...stored, [rung]: { ...rungOfGates(kept, gates.all), gates: kept } })
    changed(io)
  })

// MCP evidence: a write waits for a read back on the same server; PIE counts when it started.
/** @param {Io} io @param {string} scope @param {'write' | 'read' | 'pie'} kind @param {string} server @param {boolean} isOk */
export const noteMcp = (io, scope, kind, server, isOk) =>
  serial(async () => {
    const evidence = { ...emptyEvidence(), ...(await storedEvidence(io, scope)) }
    const pending = `pending readback on ${server}`
    /** @type {Partial<Evidence>} */
    let change = {}
    if (kind === 'write' && isOk) change = { readback: { state: 'none', detail: pending } }
    if (kind === 'read' && isOk && evidence.readback.detail === pending) change = { readback: { state: 'pass', detail: `read back on ${server}` } }
    if (kind === 'pie') change = { pie: { state: isOk ? 'pass' : 'fail', detail: server } }
    if (Object.keys(change).length === 0) return
    await writeEvidence(io, scope, change)
  })

/** @param {Io} io @param {readonly import('./guards.mjs').Trap[]} traps traps first seen in this session */
export const countTraps = (io, traps) =>
  serial(async () => {
    let hits = /** @type {import('./guards.mjs').TrapHits} */ ((await io.get(KEY.hits)) ?? {})
    for (const trap of traps) hits = countGotcha(hits, trap)
    await io.set(KEY.hits, hits)
    changed(io)
  })

/** @param {Io} io @param {string[]} paths */
export const flagLost = (io, paths) =>
  serial(async () => {
    await io.set(KEY.lost(await io.sessionId()), { paths, isDisclosed: false })
    changed(io)
  })

/** @param {Io} io @param {string} key */
export const bump = (io, key) =>
  serial(async () => {
    const score = /** @type {Record<string, number>} */ ((await io.get(KEY.score)) ?? {})
    await io.set(KEY.score, { ...score, [key]: (score[key] ?? 0) + 1 })
  })

// What else changes once an item has been delivered to the session.
/** @param {Io} io @param {import('./home.mjs').Item} item */
export const settleItem = (io, item) =>
  serial(async () => {
    const sid = await io.sessionId()
    if (item.kind === 'lost') await io.remove(KEY.lost(sid))
    if (item.kind === 'rule') await io.set(KEY.ruled, [.../** @type {string[]} */ ((await io.get(KEY.ruled)) ?? []), ...item.ruleIds])
    changed(io)
  })

// ---------------------------------------------------------------- the away window

/** @param {Io} io @param {(away: Away) => Promise<{ away?: Away, result: T }>} change @template T @returns {Promise<T>} */
const withAway = (io, change) =>
  serial(async () => {
    const sid = await io.sessionId()
    const key = KEY.away(sid)
    const away = await awayOf(io, sid)
    const { away: next, result } = await change(away)
    if (next) {
      if (isHolding(next)) await io.set(key, next)
      else await io.remove(key)
      const person = next.person || away.person
      if (person) await setIndex(io, person, list => (isHolding(next) ? [...list, sid] : list.filter(one => one !== sid)))
      changed(io)
    }
    return result
  })

/**
 * @typedef {{ root: string, tz: number, now: number, me: string, pack?: Pack, base?: string }} WindowAt where and when a window
 *   opens; `base`: the branch the checkout's team merges into, for what the ledger says is held
 */

// Another session's view through this one's Io: its own keys (its window, its tracked intent) and its checkout, so its
// window is opened or ended from here. The store is the plugin's, one for every session on the machine, and each
// session's hooks read their own window at every call.
/** @param {Io} io @param {string} sid @param {string} root @returns {Io} */
export const asSession = (io, sid, root) => ({ ...io, sessionId: async () => sid, root: async () => root })

// The window the session would open now, nothing stored or written: its ledger is its tracked intent's decisions.md
// when the intent is the person's own, else a file of its own under the checkout's local folder (named by the minute
// and the session, so sessions heading off together never share one).
/** @param {Io} io @param {import('./away.mjs').WindowChoice} choice @param {WindowAt} at @returns {Promise<Away>} */
export const planAway = async (io, choice, at) => {
  const pin = await readPin(io)
  // The tracked intent's folder, in whichever checkout it lives.
  const dir = pin ? `${pin.isOwn ? at.root : pin.root}/docs/intent/${pin.slug}` : ''
  const owner = pin ? intentOwner((await io.read(`${dir}/prompt.md`)) ?? '') : ''
  const stamp = new Date(at.now + at.tz * 60000).toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const ledgerPath = pin && isSamePerson(owner, at.me) ? `${dir}/decisions.md` : `${at.root}/${(at.pack ?? unreal).localDir}/away/${stamp}-${shortSession(await io.sessionId())}.md`
  return newWindow({ ...choice, held: choice.held ?? [...(at.pack ?? unreal).held.defaults] }, at.now, ledgerPath, { person: personId(at.me), root: at.root })
}

// Opens a planned window, unless one is running or waiting for review: it holds from now. Its ledger is started apart
// (startLedger), so a window closed again at once (another session the mandate never reached) leaves no file behind.
/** @param {Io} io @param {Away} planned @returns {Promise<Away | null>} */
export const openAway = (io, planned) => withAway(io, async away => (away.phase === 'off' ? { away: planned, result: planned } : { result: null }))

// An open window's ledger: its section appended to the file, or the file begun.
/** @param {Io} io @param {Away} away @param {WindowAt} at */
export const startLedger = (io, away, at) => serial(async () => io.write(away.ledgerPath, ledgerWithWindow((await io.read(away.ledgerPath)) ?? '', away, at.tz, at.pack ?? unreal, at.base)))

// Opens a window now, with its ledger, unless one is running or waiting for review.
/** @param {Io} io @param {import('./away.mjs').WindowChoice} choice @param {WindowAt} at @returns {Promise<Away | null>} */
export const startAway = async (io, choice, at) => {
  const opened = await openAway(io, await planAway(io, choice, at))
  if (opened) await startLedger(io, opened, at)
  return opened
}

// Ends a running window; the review waits in "Needs you". Resolves whether it was running.
/** @param {Io} io */
export const endAway = io => withAway(io, async away => (away.phase === 'running' ? { away: { ...away, phase: /** @type {const} */ ('review'), endedAt: Date.now() }, result: true } : { result: false }))

// Closes the window; with `which`, only while it is still that window (opened at the same moment).
/** @param {Io} io @param {Away} [which] */
export const closeAway = (io, which) => withAway(io, async away => (away.phase === 'off' || (which && away.startedAt !== which.startedAt) ? { result: false } : { away: { ...offAway(), person: away.person }, result: true }))

// The person is back ("I'm back", /away stop, the review's press): this session's window ends if it runs, then every
// other running window of its group (A3), each to its review in its own session. An ended window keeps its group.
/** @param {Io} io @returns {Promise<{ isEnded: boolean, others: number }>} */
export const comeBack = async io => {
  const isEnded = await endAway(io)
  const { group, person } = await readAway(io)
  const own = await io.sessionId()
  let others = 0
  for (const sid of /** @type {string[]} */ (group ? ((await io.get(KEY.windows(person))) ?? []) : [])) {
    const other = sid === own ? null : await awayOf(io, sid)
    if (other && other.group === group && (await endAway(asSession(io, sid, other.root)))) others += 1
  }
  return { isEnded, others }
}

// Puts a window back, when the review that closed it could not be delivered.
/** @param {Io} io @param {Away} saved */
export const restoreAway = (io, saved) => withAway(io, async away => (isHolding(away) || !isHolding(saved) ? { result: false } : { away: saved, result: true }))

// Records a held action; resolves the parked entry, or null when no running window holds this kind.
// `held`: the kinds held where the command runs, when another checkout holds more than the window's own.
/** @param {Io} io @param {string} kind @param {string} command @param {number} now @param {readonly string[]} [held] */
export const park = (io, kind, command, now, held) =>
  withAway(io, async away => {
    if (!isHolding(away) || !(held ?? away.held).includes(kind)) return { result: null }
    const parked = { id: nextParkId(away.parked), kind, command: command.slice(0, 400), at: now }
    return { away: { ...away, parked: [...away.parked, parked] }, result: { parked, away } }
  })

// Writes the model's questions to the ledger instead of asking; resolves their ids, or null when the person
// can be asked (no window, or back since it ended: `lastPersonAt` is when they last typed).
/** @param {Io} io @param {readonly { question: string, options: readonly { label: string }[] }[]} questions @param {number} lastPersonAt */
export const deferQuestions = (io, questions, lastPersonAt) =>
  withAway(io, async away => {
    if (!isRecordingQuestions(away, lastPersonAt)) return { result: null }
    const text = (await io.read(away.ledgerPath)) ?? ''
    const first = nextLedgerId(text)
    const ids = questions.map((_, index) => `D-${first + index}`)
    await io.write(away.ledgerPath, `${text.trimEnd()}\n\n${questions.map((one, index) => pendingEntry(ids[index] ?? '', one.question, one.options.map(option => option.label))).join('\n')}`)
    return { result: { ids, away } }
  })

// A new session (the next morning, an app restart) picks up this person's window from an
// earlier session that has ended, so its holds and its review are not lost. A window in a
// session that is still alive stays where it is. Resolves the window taken over, or null.
/** @param {Io} io @param {{ me: string, root: string, isAlive: (sid: string) => Promise<boolean> }} lane */
export const adoptWindow = async (io, lane) => {
  const sid = await io.sessionId()
  if (isHolding(await awayOf(io, sid))) return null
  /** @type {{ from: string, away: Away } | null} */
  let found = null
  for (const from of /** @type {string[]} */ ((await io.get(KEY.windows(personId(lane.me)))) ?? [])) {
    if (from === sid) continue
    const away = await awayOf(io, from)
    if (!isHolding(away) || away.root !== lane.root) continue
    if (await lane.isAlive(from)) continue
    if (!found || away.startedAt > found.away.startedAt) found = { from, away }
  }
  if (!found) return null
  await moveLane(io, found.from, sid)
  const isOver = found.away.phase === 'review' || Date.now() >= found.away.wakeAt
  if (found.away.phase === 'running' && isOver) await endAway(io)
  return { away: found.away, isOver }
}

// Removes what sessions that have ended left behind (tracked intent, evidence, a lost-edits
// flag, the intents it stopped tracking, an empty window), so the store stays small. The store spans every checkout on the
// machine, so only sessions `isGone` can vouch for are touched (their heartbeat is in this
// checkout and says ended or stale); a holding window is kept for adoption.
// Runs in the background; reads every key once.
/** @param {Io} io @param {(sid: string) => Promise<boolean>} isGone */
export const prune = async (io, isGone) => {
  const current = await io.sessionId()
  /** @type {Map<string, string[]>} */
  const bySession = new Map()
  for (const key of await io.keys()) {
    // `<sid>|<checkout id>` is a session's proof in another checkout and goes with it; `<checkout id>|<slug>` is
    // an intent's (a checkout id has a / or a :) and belongs to no session.
    const sid = LANE_KEY.exec(key)?.[1]?.split('|')[0]
    if (sid && !/[/:]/.test(sid) && sid !== current) bySession.set(sid, [...(bySession.get(sid) ?? []), key])
  }
  for (const [sid, keys] of bySession) {
    if (!(await isGone(sid))) continue
    // A session that ended while its window still holds keeps its whole lane for adoption.
    if (isHolding(await awayOf(io, sid))) continue
    await serial(async () => {
      for (const key of keys) await io.remove(key)
    })
  }
}
