// @ts-check
// Ather Automata: the one owner of what the two halves share. The store keys,
// how stored values are read back, and every change. Changes run one at a time
// so no read-modify-write can interleave with another; reads never wait. Both
// halves import this module, so its change queue and version are shared.
//
// It takes an Io (closures over `$`, built in each half) because `$` itself may
// only be passed to functions in the file that holds it.

import { isHolding, isRecordingQuestions, ledgerWithWindow, newWindow, nextLedgerId, nextParkId, offAway, pendingEntry } from './away.mjs'
import { countGotcha, recurringGotchas } from './guards.mjs'
import { emptyEvidence, intentOwner, isSamePerson, personId } from './model.mjs'

/**
 * @typedef {{
 *   get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void>, remove: (key: string) => Promise<void>, keys: () => Promise<string[]>,
 *   read: (path: string) => Promise<string | null>, write: (path: string, text: string) => Promise<void>, exists: (path: string) => Promise<boolean>,
 *   sessionId: () => Promise<string>, root: () => Promise<string>, gitUser: () => Promise<string>, redraw: () => void
 * }} Io
 * @typedef {import('./away.mjs').Away} Away
 * @typedef {import('./model.mjs').Evidence} Evidence
 */

const KEY = {
  away: (/** @type {string} */ sid) => `away:${sid}`,
  pinned: (/** @type {string} */ sid) => `pinned:${sid}`,
  evidence: (/** @type {string} */ sid) => `evidence:${sid}`,
  lost: (/** @type {string} */ sid) => `lost:${sid}`,
  role: (/** @type {string} */ me) => `role:${personId(me)}`,
  area: (/** @type {string} */ me) => `area:${personId(me)}`,
  tour: (/** @type {string} */ me) => `tour:${personId(me)}`,
  nudged: (/** @type {string} */ me) => `nudged:${personId(me)}`,
  // The sessions holding an away window for this person, so a new session finds them without a scan.
  windows: (/** @type {string} */ person) => `windows:${person}`,
  issues: (/** @type {string} */ me) => `issues:${personId(me)}`,
  last: (/** @type {string} */ me) => `last:${personId(me)}`,
  // What edits recorded in an intent, newest last: shared by every session on the machine.
  changes: (/** @type {string} */ slug) => `changes:${slug}`,
  // What gh last said about the PRs intents name: shared by every session on the machine.
  prs: 'prStates',
  tz: 'tz',
  hits: 'gotchaHits',
  ruled: 'gotchaRuled',
  score: 'score',
}
// What belongs to this lane and follows it to a new session id after /clear.
const LANE_KEYS = [KEY.away, KEY.pinned, KEY.evidence, KEY.lost]

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

/** @type {Map<string, Promise<{ root: string, isS2: boolean, me: string }>>} */
const lanes = new Map()

// Who and where, read once per checkout and shared by both halves.
/** @param {Io} io @param {string} cwd */
export const lane = (io, cwd) => {
  const cached = lanes.get(cwd)
  if (cached) return cached
  const read = (async () => {
    const root = (await io.root().catch(() => cwd)) || cwd
    return { root, isS2: await io.exists(`${root}/docs/intent`), me: await io.gitUser().catch(() => '') }
  })()
  lanes.set(cwd, read)
  // A git name that failed to read (a slow first start) is asked again next time, never kept.
  void read.then(found => {
    if (found.me === '' && lanes.get(cwd) === read) lanes.delete(cwd)
  })
  return read
}

/** @param {Io} io */
export const sessionId = io => io.sessionId()

// After /clear the process goes on under a new session id and no session.start fires:
// this lane's window, tracked intent, evidence and lost-edits flag move to it. Only
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
  const pinned = /** @type {string | undefined} */ (await io.get(KEY.pinned(await io.sessionId())))
  return pinned ?? io.sessionId()
}

// Proof older than this no longer counts: the code has likely moved on since.
const EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000

/** @param {Io} io @param {string} scope from evidenceScope @returns {Promise<Evidence>} */
export const readEvidence = async (io, scope) => {
  const stored = /** @type {Record<string, { state: string, detail: string, at?: number }>} */ ((await io.get(KEY.evidence(scope))) ?? {})
  const fresh = Object.fromEntries(Object.entries(stored).filter(([, rung]) => Date.now() - (rung.at ?? 0) < EVIDENCE_TTL_MS))
  return /** @type {Evidence} */ ({ ...emptyEvidence(), ...fresh })
}

// Writes one scope's evidence, each record stamped with when it was seen.
/** @param {Io} io @param {string} scope @param {Partial<Evidence>} change */
const writeEvidence = async (io, scope, change) => {
  const stored = /** @type {object} */ ((await io.get(KEY.evidence(scope))) ?? {})
  const stamped = Object.fromEntries(Object.entries(change).map(([rung, value]) => [rung, { ...value, at: Date.now() }]))
  await io.set(KEY.evidence(scope), { ...stored, ...stamped })
  changed(io)
}
/** @param {Io} io @returns {Promise<string | null>} */
export const readPinned = async io => /** @type {string | null} */ ((await io.get(KEY.pinned(await io.sessionId()))) ?? null)
/** @param {Io} io @returns {Promise<{ paths: string[], isDisclosed: boolean } | null>} */
export const readLost = async io => /** @type {any} */ ((await io.get(KEY.lost(await io.sessionId()))) ?? null)
/** @param {Io} io */
export const readTz = async io => Number(await io.get(KEY.tz)) || 0
/** @param {Io} io @param {string} me */
export const readProfile = async (io, me) => ({
  role: String((await io.get(KEY.role(me))) ?? ''),
  area: String((await io.get(KEY.area(me))) ?? ''),
  tourDone: /** @type {{ isDone?: boolean } | undefined} */ (await io.get(KEY.tour(me)))?.isDone === true,
  isNudged: (await io.get(KEY.nudged(me))) === true,
})
/** @param {Io} io */
export const readRecurring = async io => recurringGotchas(/** @type {any} */ ((await io.get(KEY.hits)) ?? {}), /** @type {string[]} */ ((await io.get(KEY.ruled)) ?? []))
/** @param {Io} io @param {string} me @returns {Promise<import('./issues.mjs').Issue[]>} */
export const readIssues = async (io, me) => {
  const cached = /** @type {{ at?: number, list?: import('./issues.mjs').Issue[] } | undefined} */ (await io.get(KEY.issues(me)))
  return cached?.list && Date.now() - (cached.at ?? 0) < ISSUES_TTL_MS ? cached.list : []
}
/** @param {Io} io @returns {Promise<Record<string, import('./issues.mjs').PrRecord>>} */
export const readPrRecords = async io => /** @type {Record<string, import('./issues.mjs').PrRecord>} */ ((await io.get(KEY.prs)) ?? {})
// PR number → its last read state, for the pure readers in model.mjs.
/** @param {Io} io @returns {Promise<import('./model.mjs').PrStates>} */
export const readPrStates = async io => Object.fromEntries(Object.entries(await readPrRecords(io)).map(([number, record]) => [number, record.state]))
/** @param {Io} io @param {string} me @returns {Promise<string | null>} */
export const readLast = async (io, me) => /** @type {string | null} */ ((await io.get(KEY.last(me))) ?? null)
/** @param {Io} io */
export const readScore = async io => /** @type {Record<string, number>} */ ((await io.get(KEY.score)) ?? {})

// ---------------------------------------------------------------- changing

/** @param {Io} io @param {string} me @param {import('./issues.mjs').Issue[]} issues */
export const setIssues = (io, me, issues) =>
  serial(async () => {
    await io.set(KEY.issues(me), { at: Date.now(), list: issues })
    changed(io)
  })

// A PR record not read again for this long is dropped: its intent has closed or moved on.
const PRS_TTL_MS = 30 * 24 * 60 * 60 * 1000

// What gh just said about some PRs ('UNREAD' when it could not say), each stamped `at`.
/** @param {Io} io @param {Readonly<Record<string, string>>} states @param {number} at */
export const setPrStates = (io, states, at) =>
  serial(async () => {
    if (Object.keys(states).length === 0) return
    const kept = Object.entries(await readPrRecords(io)).filter(([, record]) => at - record.at < PRS_TTL_MS)
    await io.set(KEY.prs, { ...Object.fromEntries(kept), ...Object.fromEntries(Object.entries(states).map(([number, value]) => [number, { state: value, at }])) })
    changed(io)
  })

const CHANGES_KEPT = 20
const CHANGES_TTL_MS = 36 * 60 * 60 * 1000

/** @typedef {import('./changes.mjs').Change & { at: number }} Recorded */

// The lines an intent gained, newest first, from `since` on (the start of the person's day).
/** @param {Io} io @param {string} slug @param {number} since @returns {Promise<Recorded[]>} */
export const readChanges = async (io, slug, since) => (/** @type {Recorded[]} */ ((await io.get(KEY.changes(slug))) ?? [])).filter(one => one.at >= since).reverse()

// An edit's lines join the intent's; the same line again (a re-tick, a rewrite) replaces the older one.
/** @param {Io} io @param {string} slug @param {readonly import('./changes.mjs').Change[]} lines @param {number} at */
export const noteChanges = (io, slug, lines, at) =>
  serial(async () => {
    if (lines.length === 0) return
    const kept = /** @type {Recorded[]} */ ((await io.get(KEY.changes(slug))) ?? []).filter(one => at - one.at < CHANGES_TTL_MS && !lines.some(line => line.kind === one.kind && line.id === one.id))
    await io.set(KEY.changes(slug), [...kept, ...lines.map(line => ({ ...line, at }))].slice(-CHANGES_KEPT))
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

/** @param {Io} io @param {string} me @param {{ role?: string, area?: string, tourDone?: boolean, isNudged?: boolean }} fields */
export const setProfile = (io, me, fields) =>
  serial(async () => {
    if (fields.role !== undefined) await io.set(KEY.role(me), fields.role)
    if (fields.area !== undefined) await io.set(KEY.area(me), fields.area)
    if (fields.tourDone !== undefined) await io.set(KEY.tour(me), { isDone: fields.tourDone })
    if (fields.isNudged !== undefined) await io.set(KEY.nudged(me), fields.isNudged)
    changed(io)
  })

// Tracks an intent, if it exists. The one path for /ather, the profile tool and a write into an intent.
/** @param {Io} io @param {string} root @param {string} slug @param {{ onlyIfNone?: boolean, me?: string }} [options] */
export const track = (io, root, slug, options = {}) =>
  serial(async () => {
    if (!(await io.exists(`${root}/docs/intent/${slug}/prompt.md`))) return false
    const sid = await io.sessionId()
    if (options.onlyIfNone && (await io.get(KEY.pinned(sid))) !== undefined) return false
    await io.set(KEY.pinned(sid), slug)
    if (options.me) await io.set(KEY.last(options.me), slug)
    changed(io)
    return true
  })

/** @param {Io} io @param {string} scope @param {keyof Evidence} rung @param {import('./model.mjs').Rung} value */
export const setRung = (io, scope, rung, value) => serial(() => writeEvidence(io, scope, { [rung]: { state: value.state, detail: value.detail.slice(0, 120) } }))

// MCP evidence: a write waits for a read back on the same server; PIE counts when it started.
/** @param {Io} io @param {string} scope @param {'write' | 'read' | 'pie'} kind @param {string} server @param {boolean} isOk */
export const noteMcp = (io, scope, kind, server, isOk) =>
  serial(async () => {
    const evidence = { ...emptyEvidence(), .../** @type {object} */ ((await io.get(KEY.evidence(scope))) ?? {}) }
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
 * @param {Io} io @param {import('./away.mjs').WindowChoice} choice @param {{ root: string, tz: number, now: number, me: string }} at
 * @returns {Promise<Away | null>}
 */
export const startAway = (io, choice, at) =>
  withAway(io, async away => {
    if (away.phase !== 'off') return { result: null }
    const pinned = /** @type {string | undefined} */ (await io.get(KEY.pinned(await io.sessionId())))
    const owner = pinned ? intentOwner((await io.read(`${at.root}/docs/intent/${pinned}/prompt.md`)) ?? '') : ''
    const stamp = new Date(at.now + at.tz * 60000).toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const ledgerPath = pinned && isSamePerson(owner, at.me) ? `${at.root}/docs/intent/${pinned}/decisions.md` : `${at.root}/Saved/AtherAutomata/away/${stamp}.md`
    const started = newWindow(choice, at.now, ledgerPath, { person: personId(at.me), root: at.root })
    await io.write(ledgerPath, ledgerWithWindow((await io.read(ledgerPath)) ?? '', started, at.tz))
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
/** @param {Io} io @param {string} kind @param {string} command @param {number} now */
export const park = (io, kind, command, now) =>
  withAway(io, async away => {
    if (!isHolding(away) || !away.held.includes(kind)) return { result: null }
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
// flag, an empty window), so the store stays small. The store spans every checkout on the
// machine, so only sessions `isGone` can vouch for are touched (their heartbeat is in this
// checkout and says ended or stale); a holding window is kept for adoption.
// Runs in the background; reads every key once.
/** @param {Io} io @param {(sid: string) => Promise<boolean>} isGone */
export const prune = async (io, isGone) => {
  const current = await io.sessionId()
  /** @type {Map<string, string[]>} */
  const bySession = new Map()
  for (const key of await io.keys()) {
    const sid = /^(?:away|pinned|evidence|lost):(.+)$/.exec(key)?.[1]
    if (sid && sid !== current) bySession.set(sid, [...(bySession.get(sid) ?? []), key])
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
