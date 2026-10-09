// @ts-check
// Ather Automata: the one owner of what the two halves share. The store keys,
// how stored values are read back, and every change. Changes run one at a time
// so no read-modify-write can interleave with another; reads never wait. Both
// halves import this module, so its change queue and version are shared.
//
// It takes an Io (closures over `$`, built in each half) because `$` itself may
// only be passed to functions in the file that holds it.

import { isHolding, isRecordingQuestions, ledgerWithWindow, newWindow, nextLedgerId, nextParkId, offAway, pendingEntry } from './away.mjs'
import { countGotcha, recurringGotchas, writtenRuleOf } from './guards.mjs'
import { emptyEvidence, intentOwner, isSamePerson, personId } from './model.mjs'
import { forgetPack, packFor } from './packs/index.mjs'
import { unreal } from './packs/unreal.mjs'
import { checkoutOf, normalFolder, readWorkspace } from './workspace.mjs'
import { groupByOf } from './worklist.mjs'

/**
 * @typedef {{
 *   get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void>, remove: (key: string) => Promise<void>, keys: () => Promise<string[]>,
 *   read: (path: string) => Promise<string | null>, write: (path: string, text: string) => Promise<void>, exists: (path: string) => Promise<boolean>,
 *   sessionId: () => Promise<string>, root: () => Promise<string>, gitUser: (root?: string) => Promise<string>, redraw: () => void,
 *   list?: (path: string) => Promise<{ name: string, kind: string, mtimeMs?: number }[]>,
 *   origin?: (root: string) => Promise<string | null>, repo?: () => Promise<string>,
 *   real?: (folder: string) => Promise<string>
 * }} Io `gitUser`: git's user.name in the checkout at `root` (a repository may set its own), else in the session folder.
 *   `origin`: the remote.origin.url of the checkout at `root`, '' when it has none, null when git could not say.
 *   `repo`: the lane's repository id (repoId), which scopes what is kept per repository and, with the lane's folder,
 *   per checkout (checkoutId); without it the keys are unscoped (as before 0.2.4, and as the Paseo version still keeps them).
 *   `real`: the folder a path really lands in, behind any symbolic link; without it an id holds the folder as given.
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
  evidence: (/** @type {string} */ sid) => `evidence:${sid}`,
  lost: (/** @type {string} */ sid) => `lost:${sid}`,
  // The intents this session stopped tracking: a write into one does not track it again.
  untracked: (/** @type {string} */ sid) => `untracked:${sid}`,
  // A pack's roles are its own: a tech artist in S2 is not a role in a web repository. The Unreal pack's key is unprefixed.
  role: (/** @type {string} */ me, /** @type {string} */ prefix = '') => `role:${prefix}${personId(me)}`,
  area: (/** @type {string} */ me) => `area:${personId(me)}`,
  tour: (/** @type {string} */ me) => `tour:${personId(me)}`,
  nudged: (/** @type {string} */ me) => `nudged:${personId(me)}`,
  // How this person groups the teammates' intents in Everything open (person, area, stage or none).
  groupBy: (/** @type {string} */ me) => `groupBy:${personId(me)}`,
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
}
// What belongs to this lane and follows it to a new session id after /clear.
const LANE_KEYS = [KEY.away, KEY.pinned, KEY.evidence, KEY.lost, KEY.untracked]

let queue = Promise.resolve()
/** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
const serial = task => {
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

/** @typedef {{ root: string, repo: string, isS2: boolean, me: string, pack: Pack, isSure: boolean }} Checkout */
// The session's lane by its folder, and each checkout's by its root.
/** @type {Map<string, Promise<Checkout>>} */
const lanes = new Map()
/** @type {Map<string, Promise<Checkout>>} */
const rootLanes = new Map()
// Where each folder really lands, asked once per folder.
/** @type {Map<string, Promise<string>>} */
const realFolders = new Map()

// A store key holds 256 characters at most (the engine's limit), and a folder is one part of it, beside a
// session's id, a repository and an intent's name. A longer folder is kept as a digest of the whole and
// its last characters: still one id per folder, and still told apart by eye.
const FOLDER_MAX = 120
// A 53-bit digest of a text (cyrb53), in base 36: the same on every machine and in every engine.
/** @param {string} text */
const digest = text => {
  let high = 0xdeadbeef
  let low = 0x41c6ce57
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at)
    high = Math.imul(high ^ code, 2654435761)
    low = Math.imul(low ^ code, 1597334677)
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507) ^ Math.imul(low ^ (low >>> 13), 3266489909)
  low = Math.imul(low ^ (low >>> 16), 2246822507) ^ Math.imul(high ^ (high >>> 13), 3266489909)
  return (4294967296 * (2097151 & low) + (high >>> 0)).toString(36)
}

// A folder as an id holds it: normalised and lowercased, so it reads the same from every session.
/** @param {string} root */
const folderId = root => {
  const folder = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  if (folder.length <= FOLDER_MAX) return folder
  const mark = `~${digest(folder)}~`
  return mark + folder.slice(mark.length - FOLDER_MAX)
}

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

// A repository's id from its origin URL: owner/repo, lowercased, whatever the protocol, so every
// clone and worktree of one repository shares what is kept for it. Without an origin, the checkout's folder.
//   git@github.com:AskTinNguyen/han-viet.git, https://github.com/AskTinNguyen/han-viet → asktinnguyen/han-viet
//   D:\Mirrors\Sipher\S2.git (a local origin, as Windows writes it) → sipher/s2
/** @param {string} url @param {string} root */
export const repoId = (url, root) => {
  const path = url
    .trim()
    .replace(/\\/g, '/')
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, '')
    .replace(/^[^@/\s]+@[^:/\s]+:/, '')
    .replace(/\.git\/?$/i, '')
    .replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts.length >= 2) return parts.slice(-2).join('/').toLowerCase()
  return `path:${folderId(root)}`
}

// A checkout's id: its repository's and its folder, so two clones or worktrees of one repository keep their
// own proof, changes and "Continue …". Without an origin the repository's id is the folder already; without
// a repository (an Io without `repo`) there is none.
//   sipher/s2 in D:\S2 → sipher/s2@d:/s2
/** @param {string} repo from repoId @param {string} root the checkout's top folder */
export const checkoutId = (repo, root) => (repo === '' || repo.startsWith('path:') ? repo : `${repo}@${folderId(root)}`)

// Roots read without intents. One that has them at a later read was set up in this session
// (/ather setup): its profile is new, so its pack is chosen again and each half is told.
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
  const { pack } = await packFor({ read: io.read, exists: io.exists, list, sessionId: io.sessionId }, root).catch(() => ({ pack: unreal }))
  const origin = io.origin ? await io.origin(root).catch(() => null) : ''
  const me = await (userRoot === undefined ? io.gitUser() : io.gitUser(userRoot)).catch(() => '')
  return { root, repo: io.origin ? repoId(origin ?? '', await realFolder(io, root)) : '', isS2: await io.exists(`${root}/docs/intent`), me, pack, isSure: me !== '' && origin !== null }
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

/** @type {Map<string, Promise<{ roots: string[], skipped: string[] }>>} */
const workspaces = new Map()

// The checkouts this session works with (workspace.mjs), read once per session folder and `repos` option
// and shared by both halves. `log` hears the option folders that are in no checkout, once per read.
/** @param {Io} io @param {string} folder the session folder @param {string} option @param {(line: string) => void} [log] */
export const workspace = (io, folder, option, log = () => undefined) => {
  const key = `${normalFolder(folder)}\n${option}`
  const cached = workspaces.get(key)
  if (cached) return cached.then(found => found.roots)
  const reading = readWorkspace({ read: io.read, exists: io.exists, list: io.list }, folder, option).catch(() => ({ roots: [], skipped: [] }))
  workspaces.set(key, reading)
  return reading.then(found => {
    for (const skipped of found.skipped) log(`Ather: ${skipped} (repos) is not in a git checkout; skipped.`)
    log(`Ather: workspace ${found.roots.join(', ') || '(no checkout)'}`)
    return found.roots
  })
}

/** @param {Io} io */
const repoOf = io => (io.repo ? io.repo().catch(() => '') : Promise.resolve(''))

/** @param {Io} io @param {string} root */
const isSessionRoot = async (io, root) => normalFolder(root) === normalFolder(await io.root().catch(() => ''))

// The checkout a folder holding docs/intent is, by its id: the session's own for its root, else that folder's.
/** @param {Io} io @param {string} [root] */
const checkoutAt = async (io, root) => (root === undefined || (await isSessionRoot(io, root)) ? checkoutId(await repoOf(io), await realFolder(io, await io.root().catch(() => ''))) : checkoutId((await laneAt(io, normalFolder(root))).repo, await realFolder(io, root)))

// Before 0.2.4 a key had no repository in it. A scoped key not written yet reads the unscoped one, once
// per upgrade: the next write goes to the scoped key, and the old one ages out on its own.
/** @param {Io} io @param {string} scoped @param {string} legacy */
const readScoped = async (io, scoped, legacy) => {
  const value = await io.get(scoped)
  return value !== undefined || scoped === legacy ? value : io.get(legacy)
}

// For /ather where there were no intents: /ather setup may have added them in this session. A kept
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

/** @param {Io} io */
export const readAway = async io => /** @type {Away} */ ({ ...offAway(), .../** @type {object} */ ((await io.get(KEY.away(await io.sessionId()))) ?? {}) })
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

// What is kept for a scope: an intent's from before 0.2.4 too, while its scoped record has none. Only an
// intent in the session's own checkout: that proof was never another checkout's.
/** @param {Io} io @param {string} scope */
const storedEvidence = async (io, scope) => {
  const own = await checkoutAt(io)
  const legacy = own && scope.startsWith(`${own}|`) ? scope.slice(own.length + 1) : scope
  return /** @type {Record<string, any>} */ ((await readScoped(io, KEY.evidence(scope), KEY.evidence(legacy))) ?? {})
}

// Proof older than this no longer counts: the code has likely moved on since.
const EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000

/** @param {Io} io @param {string} scope from evidenceScope @param {Pack} [pack] @returns {Promise<Evidence>} */
export const readEvidence = async (io, scope, pack = unreal) => {
  const stored = /** @type {Record<string, { state: string, detail: string, at?: number }>} */ (await storedEvidence(io, scope))
  const fresh = Object.fromEntries(Object.entries(stored).filter(([, rung]) => Date.now() - (rung.at ?? 0) < EVIDENCE_TTL_MS))
  return /** @type {Evidence} */ ({ ...emptyEvidence(pack), ...fresh })
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
  // Only the session's own checkout reads through to the key from before 0.2.4.
  const isOwn = root === undefined || (await isSessionRoot(io, root))
  return /** @type {string | null} */ ((await readScoped(io, scoped, isOwn ? KEY.last(me, '') : scoped)) ?? null)
}
// The person's grouping for Everything open; Person until they choose another.
/** @param {Io} io @param {string} me */
export const readGroupBy = async (io, me) => groupByOf(await io.get(KEY.groupBy(me)))
/** @param {Io} io */
export const readScore = async io => /** @type {Record<string, number>} */ ((await io.get(KEY.score)) ?? {})

// ---------------------------------------------------------------- changing

/** @param {Io} io @param {string} me @param {import('./issues.mjs').Issue[]} issues @param {string} [repo] */
export const setIssues = (io, me, issues, repo) =>
  serial(async () => {
    await io.set(KEY.issues(me, repo ?? (await repoOf(io))), { at: Date.now(), list: issues })
    changed(io)
  })

// A PR record not read again for this long is dropped: its intent has closed or moved on.
const PRS_TTL_MS = 30 * 24 * 60 * 60 * 1000

// What gh just said about some PRs ('UNREAD' when it could not say), each stamped `at`.
/** @param {Io} io @param {import('./model.mjs').PrStates} states @param {number} at @param {string} [repo] */
export const setPrStates = (io, states, at, repo) =>
  serial(async () => {
    if (Object.keys(states).length === 0) return
    const scope = repo ?? (await repoOf(io))
    const kept = Object.entries(await readPrRecords(io, scope)).filter(([, record]) => at - record.at < PRS_TTL_MS)
    await io.set(KEY.prs(scope), { ...Object.fromEntries(kept), ...Object.fromEntries(Object.entries(states).map(([number, value]) => [number, { state: value, at }])) })
    changed(io)
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

// Whether this checkout has the intent's folder: what tracking it needs (asking about it does not).
/** @param {Io} io @param {string} root @param {string} slug */
export const hasIntentFolder = (io, root, slug) => io.exists(`${root}/docs/intent/${slug}/prompt.md`)

// A stop on tracking an intent: its plain slug in the session's own checkout, `{ slug, root }` in another,
// so the same slug in two checkouts is stopped on its own.
/** @typedef {string | { slug: string, root: string }} Stop */
/** @param {Stop} stop @param {string} slug @param {string | null} root null: the session's own checkout */
const isStopOf = (stop, slug, root) => (typeof stop === 'string' ? root === null && stop === slug : root !== null && stop?.slug === slug && stop.root === root)
/** @param {Io} io @param {string} sid @returns {Promise<Stop[]>} */
const readStops = async (io, sid) => /** @type {Stop[]} */ ((await io.get(KEY.untracked(sid))) ?? [])

// Tracks an intent, if it exists. The one path for /ather, the profile tool and a write into an intent.
// `root`: the folder holding its docs/intent, the session's own or another checkout's.
// `isAuto`: a write into the intent, which never tracks one this session stopped tracking; tracking one
// on purpose lifts that stop. `me`: the person's "Continue …" in its checkout moves to it too.
/** @param {Io} io @param {string} root @param {string} slug @param {{ onlyIfNone?: boolean, isAuto?: boolean, me?: string }} [options] */
export const track = (io, root, slug, options = {}) =>
  serial(async () => {
    const isOwn = await isSessionRoot(io, root)
    const at = isOwn ? root : normalFolder(root)
    if (!(await hasIntentFolder(io, at, slug))) return false
    const sid = await io.sessionId()
    const stopped = await readStops(io, sid)
    const isStopped = stopped.some(one => isStopOf(one, slug, isOwn ? null : at))
    if (options.isAuto && isStopped) return false
    if (options.onlyIfNone && (await io.get(KEY.pinned(sid))) !== undefined) return false
    await io.set(KEY.pinned(sid), isOwn ? slug : { slug, root: at })
    if (options.me) {
      const last = KEY.last(options.me, await checkoutAt(io, at))
      await io.set(last, slug)
      // Once the own checkout's scoped "Continue …" is written, the unscoped one from before 0.2.4 must not
      // read through again. Tracking in another checkout leaves it: it is still the own checkout's.
      if (isOwn && last !== KEY.last(options.me, '')) await io.remove(KEY.last(options.me, ''))
    }
    if (!options.isAuto && isStopped) await setList(io, KEY.untracked(sid), stopped.filter(one => !isStopOf(one, slug, isOwn ? null : at)))
    await beat(io)
    changed(io)
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
    const away = /** @type {Away} */ ({ ...offAway(), .../** @type {object} */ ((await io.get(KEY.away(sid))) ?? {}) })
    if (away.phase === 'running') return { result: /** @type {const} */ ('away'), slug }
    await io.remove(KEY.pinned(sid))
    // The unscoped "Continue …" from before 0.2.4 goes too, or it would read through again.
    for (const key of new Set([KEY.last(me, await checkoutAt(io, pin.isOwn ? undefined : pin.root)), ...(pin.isOwn ? [KEY.last(me, '')] : [])])) if ((await io.get(key)) === slug) await io.remove(key)
    const stopped = (await readStops(io, sid)).filter(one => !isStopOf(one, slug, pin.isOwn ? null : pin.root))
    await setList(io, KEY.untracked(sid), [...stopped, pin.isOwn ? slug : { slug, root: pin.root }])
    await beat(io)
    changed(io)
    return { result: /** @type {const} */ ('untracked'), slug }
  })

/** @param {Io} io @param {string} key @param {Stop[]} list */
const setList = async (io, key, list) => {
  const kept = [...new Set(list)]
  if (kept.length === 0) await io.remove(key)
  else await io.set(key, kept)
}

// ---------------------------------------------------------------- lanes: the heartbeats of the sessions on this checkout

// A heartbeat older than this, or one that says it ended, is no longer a live session.
const LANE_STALE_MS = 10 * 60 * 1000

/**
 * One session's heartbeat, a file under the pack's local folder: what it tracks, on which branch,
 * when it was written and when the session last took a prompt or ran a tool.
 * @typedef {{ sessionId: string, intent: string | null, branch: string, updatedAt: number, lastActiveAt?: number, away: string, hasEnded: boolean }} Lane
 */

// When this session last took a prompt or ran a tool; a hot reload starts it again.
let activeAt = Date.now()
/** @param {number} [at] */
export const markActive = (at = Date.now()) => {
  activeAt = at
}

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
    const lane = { sessionId: sid, intent: await readPinned(io), branch: at.branch, updatedAt: Date.now(), lastActiveAt: activeAt, away: away.phase, hasEnded: at.hasEnded }
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

// One session's heartbeat on this checkout, or null when it has none here (it may live in another checkout).
/** @param {Io} io @param {string} root @param {string} localDir @param {string} sid @returns {Promise<Lane | null>} */
export const readLane = async (io, root, localDir, sid) => {
  try {
    return JSON.parse((await io.read(`${root}/${localDir}/lanes/${sid}.json`)) ?? '')
  } catch {
    return null
  }
}

/** @param {Lane} lane */
export const isLaneLive = lane => !lane.hasEnded && Date.now() - Number(lane.updatedAt) < LANE_STALE_MS

// The other sessions alive on this checkout: a fresh heartbeat that has not said it ended.
/** @param {Io} io @param {string} root @param {string} localDir @returns {Promise<Lane[]>} */
export const readPeers = async (io, root, localDir) => {
  const dir = `${root}/${localDir}/lanes`
  const sid = await io.sessionId()
  const list = io.list ?? (async () => [])
  /** @type {Lane[]} */
  const out = []
  for (const entry of await list(dir).catch(() => [])) {
    if (entry.kind !== 'file' || entry.name === `${sid}.json` || Date.now() - Number(entry.mtimeMs) > LANE_STALE_MS) continue
    try {
      const lane = JSON.parse((await io.read(`${dir}/${entry.name}`)) ?? '')
      if (!lane.hasEnded) out.push(lane)
    } catch {
      // a half-written heartbeat; the next tick reads it
    }
  }
  return out
}

/** @param {Io} io @param {string} scope @param {keyof Evidence} rung @param {import('./model.mjs').Rung} value */
export const setRung = (io, scope, rung, value) => serial(() => writeEvidence(io, scope, { [rung]: { state: value.state, detail: value.detail.slice(0, 120) } }))

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
    const key = KEY.away(await io.sessionId())
    const away = /** @type {Away} */ ({ ...offAway(), .../** @type {object} */ ((await io.get(key)) ?? {}) })
    const { away: next, result } = await change(away)
    if (next) {
      const sid = key.slice('away:'.length)
      if (isHolding(next)) await io.set(key, next)
      else await io.remove(key)
      const person = next.person || away.person
      if (person) await setIndex(io, person, list => (isHolding(next) ? [...list, sid] : list.filter(one => one !== sid)))
      changed(io)
    }
    return result
  })

/**
 * Opens a window, unless one is running or waiting for review.
 * @param {Io} io @param {import('./away.mjs').WindowChoice} choice @param {{ root: string, tz: number, now: number, me: string, pack?: Pack }} at
 * @returns {Promise<Away | null>}
 */
export const startAway = (io, choice, at) =>
  withAway(io, async away => {
    if (away.phase !== 'off') return { result: null }
    const pin = await readPin(io)
    // The tracked intent's folder, in whichever checkout it lives.
    const dir = pin ? `${pin.isOwn ? at.root : pin.root}/docs/intent/${pin.slug}` : ''
    const owner = pin ? intentOwner((await io.read(`${dir}/prompt.md`)) ?? '') : ''
    const stamp = new Date(at.now + at.tz * 60000).toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const ledgerPath = pin && isSamePerson(owner, at.me) ? `${dir}/decisions.md` : `${at.root}/${(at.pack ?? unreal).localDir}/away/${stamp}.md`
    const started = newWindow({ ...choice, held: choice.held ?? [...(at.pack ?? unreal).held.defaults] }, at.now, ledgerPath, { person: personId(at.me), root: at.root })
    await io.write(ledgerPath, ledgerWithWindow((await io.read(ledgerPath)) ?? '', started, at.tz, at.pack ?? unreal))
    return { away: started, result: started }
  })

// Ends a running window; the review waits in "Needs you". Resolves whether it was running.
/** @param {Io} io */
export const endAway = io => withAway(io, async away => (away.phase === 'running' ? { away: { ...away, phase: /** @type {const} */ ('review'), endedAt: Date.now() }, result: true } : { result: false }))

/** @param {Io} io */
export const closeAway = io => withAway(io, async away => (away.phase === 'off' ? { result: false } : { away: { ...offAway(), person: away.person }, result: true }))

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
  if (isHolding(/** @type {Away} */ ({ ...offAway(), .../** @type {object} */ ((await io.get(KEY.away(sid))) ?? {}) }))) return null
  /** @type {{ from: string, away: Away } | null} */
  let found = null
  for (const from of /** @type {string[]} */ ((await io.get(KEY.windows(personId(lane.me)))) ?? [])) {
    if (from === sid) continue
    const away = /** @type {Away} */ ({ ...offAway(), .../** @type {object} */ ((await io.get(KEY.away(from))) ?? {}) })
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
    const sid = /^(?:away|pinned|evidence|lost|untracked):(.+)$/.exec(key)?.[1]?.split('|')[0]
    if (sid && !/[/:]/.test(sid) && sid !== current) bySession.set(sid, [...(bySession.get(sid) ?? []), key])
  }
  for (const [sid, keys] of bySession) {
    if (!(await isGone(sid))) continue
    // A session that ended while its window still holds keeps its whole lane for adoption.
    if (isHolding(/** @type {Away} */ ({ ...offAway(), .../** @type {object} */ ((await io.get(KEY.away(sid))) ?? {}) }))) continue
    await serial(async () => {
      for (const key of keys) await io.remove(key)
    })
  }
}
