// @ts-check
// Ather Board: one record per intent, read the way Ather reads it (model.mjs parseIntent, worklist.mjs
// listStage and ownerName), with the flags Triage sorts by. Pure: no `$`.

import { directorCalls, parseIntent, plural } from './ather/model.mjs'
import { listStage, ownerName } from './ather/worklist.mjs'
import { DAY_MS, STALE_DAYS } from './views.mjs'

/**
 * @typedef {import('./views.mjs').BoardRecord} BoardRecord
 * @typedef {import('./views.mjs').Flag} Flag
 * @typedef {import('./views.mjs').Stage} Stage
 * @typedef {import('./ather/model.mjs').IntentFiles} IntentFiles
 * @typedef {import('./ather/packs/index.mjs').Pack} Pack
 * @typedef {import('./views.mjs').Party} Party
 * @typedef {import('./views.mjs').Collision} Collision
 * @typedef {import('./ather/overlap.mjs').Overlap} Overlap
 */

// The words the intent skill writes on a Status line; anything else is read by its first word and flagged.
const STATUS_WORDS = ['active', 'parked', 'completed']

// Done when completed; Plan while it has no checklist; else where Ather's list puts it.
/** @param {ReturnType<typeof parseIntent>} intent @returns {Stage} */
const stageOf = intent => (intent.status === 'completed' ? 'done' : intent.status === 'parked' ? 'parked' : intent.acceptanceTotal === 0 ? 'plan' : listStage(intent))

/**
 * What Triage and the hygiene list say of an intent, in a row's few words: stale says no more than that, as
 * the row's age has the days (STALE_DAYS or more); parked says it as Ather's list does. Done intents carry
 * only hygiene flags.
 * @param {ReturnType<typeof parseIntent>} intent @param {Stage} stage @param {Pack} pack @param {number} now
 * @returns {Flag[]}
 */
const flagsOf = (intent, stage, pack, now) => {
  /** @type {Flag[]} */
  const flags = []
  const isOpen = stage !== 'done'
  const calls = directorCalls(intent).length
  if (isOpen && calls > 0) flags.push({ kind: 'decisions', label: `${plural(calls, 'decision')} waiting` })
  if (stage === 'met') flags.push({ kind: 'met', label: 'every item met, not closed' })
  const idle = Math.floor((now - intent.updatedAt) / DAY_MS)
  if (isOpen && stage !== 'parked' && intent.updatedAt > 0 && idle >= STALE_DAYS) flags.push({ kind: 'stale', label: 'stale' })
  if (stage === 'parked' && !intent.statusNote) flags.push({ kind: 'unparked', label: 'parked, no reason' })
  if (stage === 'plan') flags.push({ kind: 'plan', label: 'no acceptance checklist' })
  if (!STATUS_WORDS.includes(intent.status)) flags.push({ kind: 'status', label: intent.status === 'unknown' ? 'no Status line' : `status "${intent.status}" is not active, parked or completed` })
  else if (intent.statusNote && intent.status !== 'parked') flags.push({ kind: 'status', label: 'status line is a sentence' })
  if (!intent.owner) flags.push({ kind: 'owner', label: 'no Owner line' })
  if (pack.areas.length > 0 && !pack.areas.includes(intent.area)) flags.push({ kind: 'area', label: 'area not in the list' })
  return flags
}

// The other intents an intent's files name (its prompt, progress and findings): every hyphenated word in
// them that is another intent's folder name. How intents relate on the map, read from what they say.
/** @param {IntentFiles} files @param {ReadonlySet<string>} slugs */
export const mentionsOf = (files, slugs) => [...new Set(`${files.prompt}
${files.progress}
${files.findings}`.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? [])].filter(word => word !== files.slug && slugs.has(word)).sort()

/**
 * @param {IntentFiles} files @param {{ pack: Pack, createdAt: number, now: number, slugs?: ReadonlySet<string> }} context
 * `createdAt`: when its folder was first committed (0: not known, its last change stands in); `slugs`: every intent's folder name, for its mentions
 * @returns {BoardRecord}
 */
export const toRecord = (files, { pack, createdAt, now, slugs = new Set() }) => {
  const intent = parseIntent(files, pack)
  const stage = stageOf(intent)
  return {
    key: intent.key,
    slug: intent.slug,
    title: intent.title,
    goal: intent.goal,
    area: intent.area,
    owner: ownerName(intent.owner, intent.firstAuthor, { teams: pack.teams, names: pack.names }),
    stage,
    status: intent.status,
    statusNote: intent.statusNote,
    done: intent.acceptanceDone,
    total: intent.acceptanceTotal,
    openItems: stage === 'done' ? [] : intent.openItems,
    prs: intent.prs,
    issue: intent.issue,
    calls: stage === 'done' ? [] : directorCalls(intent).map(call => ({ id: call.id, title: call.title, options: call.options.map(({ letter, label, text, isRecommended }) => ({ letter, label, text, isRecommended })) })),
    updatedAt: intent.updatedAt,
    createdAt: createdAt || intent.updatedAt,
    source: intent.source,
    mentions: mentionsOf(files, slugs),
    flags: flagsOf(intent, stage, pack, now),
    branch: intent.branch,
    collisions: [],
  }
}

// The open intents whose branches the overlap check compares (overlap-check D2): not done, not parked, with a Branch line.
/** @param {readonly BoardRecord[]} records */
export const sidesOf = records => records.filter(one => one.stage !== 'done' && one.stage !== 'parked' && one.branch !== '').map(one => ({ key: one.key, branch: one.branch }))

/**
 * The records with the overlaps they are a side of (overlap-check D5), each named by its intents, or by the
 * base branch and its last author there, and a "colliding" warning naming what it overlaps.
 * @param {readonly BoardRecord[]} records @param {readonly Overlap[]} overlaps @param {string} base
 * @returns {BoardRecord[]}
 */
export const withCollisions = (records, overlaps, base) => {
  const byKey = new Map(records.map(one => [one.key, one]))
  /** @param {string} key @returns {Party | null} */
  const party = key => {
    const one = byKey.get(key)
    return one ? { key, slug: one.slug, owner: one.owner, stage: one.stage, branch: one.branch } : null
  }
  /** @type {Collision[]} */
  const collisions = overlaps.flatMap(one => {
    const a = one.a === '' ? { key: '', slug: base, owner: one.base?.who ?? '', stage: /** @type {const} */ (''), branch: base } : party(one.a)
    const b = party(one.b)
    return a && b ? [{ key: one.key, a, b, files: one.files, spots: one.spots, count: one.count, base: one.base ? { at: one.base.at, via: one.base.via } : null }] : []
  })
  return records.map(record => {
    const its = collisions.filter(one => one.a.key === record.key || one.b.key === record.key)
    if (its.length === 0) return record
    const others = its.map(one => (one.a.key === record.key ? one.b.slug : one.a.slug))
    return { ...record, collisions: its, flags: [...record.flags, { kind: /** @type {const} */ ('colliding'), label: `overlaps ${others.join(', ')}` }] }
  })
}
