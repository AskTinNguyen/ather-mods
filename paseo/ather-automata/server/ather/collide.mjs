// Ather Automata: a collision, two pieces of work that change the same lines (overlap.mjs finds them), told
// the same way wherever it is shown: Ather Board's pane and page, and Needs you here when this checkout's own
// branch no longer merges into its base (collision-alert). Its two sides, its words, and what can be done
// about it, each one prompt for the session. Pure: no `$`.
//
// Ather Board writes the words (overlapCount through spotLabel) into its HTML page by their source text, so
// each names only the others, `ageText` (written into the page too) and the language's own globals.

import { aboutIntentPrompt, andList, isMine } from './model.mjs'
import { readOverlaps } from './overlap.mjs'
import { ageText } from './worklist.mjs'

/**
 * @template {string} [S=string]
 * @typedef {{ key: string, slug: string, owner: string, stage: S | '', branch: string }} Party one side: an intent (by its
 *   key, slug, owner, stage and branch), work on a branch (named by it), or the base (key '', named by the base branch,
 *   owned by its last author on the files)
 */
/**
 * @template {string} [S=string]
 * @typedef {{ key: string, a: Party<S>, b: Party<S>, files: string[], spots: import('./overlap.mjs').Spot[], count: number, base: { at: number, via: string[] } | null }} Collision
 *   an overlap with its sides: `a` the base when it is one; `base`: when the base last changed the files, and the intents that change brought
 */

/**
 * @typedef {{ base: string, at: number, collision: Collision | null }} MergeCheck this checkout's branch compared with origin's base at
 *   `at`: `collision` where they no longer merge cleanly, null where they do (ship-pill D1)
 */

/**
 * The overlaps as collisions, each side named by `partyOf` (an overlap whose side it cannot name is left out), the
 * base by its branch and its last author on the files.
 * @template {string} S
 * @param {readonly import('./overlap.mjs').Overlap[]} overlaps @param {(key: string) => Party<S> | null} partyOf @param {string} base
 * @returns {Collision<S>[]}
 */
export const collisionsFor = (overlaps, partyOf, base) =>
  overlaps.flatMap(one => {
    const a = one.a === '' ? { key: '', slug: base, owner: one.base?.who ?? '', stage: /** @type {const} */ (''), branch: base } : partyOf(one.a)
    const b = partyOf(one.b)
    return a && b ? [{ key: one.key, a, b, files: one.files, spots: one.spots, count: one.count, base: one.base ? { at: one.base.at, via: one.base.via } : null }] : []
  })

// ---------------------------------------------------------------- its words (overlap-check D5)

/** @param {number} count */
export const overlapCount = count => `▲ ${count} ${count === 1 ? 'overlap' : 'overlaps'}`
// Its people, the second side's owner first, each once.
/** @param {Collision} collision */
export const collisionOwners = collision => [collision.b.owner, collision.a.owner].filter((owner, at, all) => owner !== '' && all.indexOf(owner) === at).join(', ')
// What happened, in one clause: the base's last change to the files, or that neither side is merged.
/** @param {Collision} collision @param {number} now */
export const collisionFact = (collision, now) => {
  const { a, base } = collision
  if (!base) return 'Neither is merged yet: whichever merges second will conflict.'
  const subject = base.via.length > 0 ? `${base.via.join(', ')} changed these lines on origin/${a.slug}` : `origin/${a.slug} changed these lines`
  return `${subject}${base.at ? ` ${ageText(base.at, now)} ago` : ''}${a.owner ? ` (${a.owner})` : ''}.`
}
// A side's first changed line as shown: '(blank)' for an empty one.
/** @param {string} line */
export const sideLine = line => line || '(blank)'
// The places past those kept: "and 3 more", '' for none.
/** @param {Collision} collision */
export const moreText = collision => (collision.count > collision.spots.length ? `and ${collision.count - collision.spots.length} more` : '')
// A place: "path:line", or the file and what each side did to it.
/** @param {Collision} collision @param {import('./overlap.mjs').Spot} spot */
export const spotLabel = (collision, spot) =>
  spot.kind === 'lines' ? `${spot.path}:${spot.line}` : `${spot.path} · ${spot.kind === 'binary' ? 'binary, both changed' : `${collision.a.slug} ${spot.ours} it, ${collision.b.slug} ${spot.theirs} it`}`

// ---------------------------------------------------------------- what can be done about it

// "Combat/HitStop.cpp:42 (main: return FMath::Min…; dodge-cancel: return CanCancel…) and Map.umap · binary, both changed".
/** @param {Collision} collision */
export const spotsText = collision =>
  andList(collision.spots.map(spot => (spot.kind === 'lines' ? `${spotLabel(collision, spot)} (${collision.a.slug}: ${sideLine(spot.ours)}; ${collision.b.slug}: ${sideLine(spot.theirs)})` : spotLabel(collision, spot)))) + (moreText(collision) ? `, ${moreText(collision)}` : '')

/** @param {Collision} collision */
const pairName = collision => `${collision.b.slug} and ${collision.a.key === '' ? `origin/${collision.a.slug}` : collision.a.slug}`

/** @param {Party} party @param {string} words @param {Collision} collision */
const notePrompt = (party, words, collision) =>
  `Draft a short, friendly message to ${party.owner || 'the owner'} about ${pairName(collision)}: ${words} They change the same lines: ${spotsText(collision)}. Name the one thing that would help (who merges first, or how both changes fit together). Show me the draft; do not send it.`

// Bringing the base into the second side's branch, the person's own: resolved in a worktree on it, nothing pushed.
/** @param {Collision} collision */
export const bringPrompt = collision => {
  const { a, b } = collision
  const whose = b.slug === b.branch ? `The branch ${b.branch}` : `Intent ${b.slug}'s branch ${b.branch}`
  return `${whose} no longer merges cleanly into origin/${a.slug}: ${spotsText(collision)}. Merge origin/${a.slug} into ${b.branch} in a worktree on that branch (this checkout if it is on it, else a new one), resolve each place keeping what both changes are for, run the repository's gates, and show me each resolution and the diff before committing. Do not push until I say.`
}

/**
 * What can be done about a collision, the first the one to do now: on your own work against the base, bring
 * the base in; with a teammate, a drafted note (never sent); else asking the owners, and where both intents
 * stand. `me`: the person at the keyboard. Each is one prompt handed to the session.
 * @param {Collision} collision @param {string} me @param {string} base
 * @returns {{ key: string, label: string, prompt: string }[]}
 */
export const collisionActions = (collision, me, base) => {
  const { a, b } = collision
  const isBase = a.key === ''
  const mine = [b, ...(isBase ? [] : [a])].find(party => isMine(party, me))
  const other = mine === b ? a : b
  const about = { key: 'about', label: 'Where they stand', prompt: [a, b].filter(party => party.key !== '').map(party => aboutIntentPrompt(party.slug, true, '', base)).join('\n') }
  if (isBase && mine) {
    const bring = { key: 'bring', label: `Bring ${base} into ${b.slug}`, prompt: bringPrompt(collision) }
    return a.owner && !isMine(a, me) ? [bring, { key: 'note', label: `Draft a note to ${a.owner}`, prompt: notePrompt(a, `${a.owner} changed origin/${base} where my ${b.slug} works.`, collision) }] : [bring]
  }
  if (mine) return [{ key: 'note', label: `Draft a note to ${other.owner || 'the owner'}`, prompt: notePrompt(other, `my ${mine.slug} and their ${other.slug} will conflict when the second one merges.`, collision) }, about]
  if (isBase) return [{ key: 'note', label: `Ask ${b.owner || 'the owner'}`, prompt: notePrompt(b, `origin/${base} moved under their ${b.slug}; it no longer merges cleanly.`, collision) }, about]
  return [{ key: 'note', label: `Ask ${a.owner || a.slug} and ${b.owner || b.slug} who goes first`, prompt: `Draft one short, friendly message to ${a.owner || 'the owner of ' + a.slug} and ${b.owner || 'the owner of ' + b.slug} about ${pairName(collision)}: they change the same lines (${spotsText(collision)}), so whichever merges second will conflict. Ask who goes first, or how both changes fit together. Show me the draft; do not send it.` }, about]
}

// ---------------------------------------------------------------- this checkout's own branch

/**
 * This checkout's branch against origin's base (collision-alert, ship-pill D1), through `job` (overlap.mjs overlapJob,
 * one run at a time): its own tip is compared, so commits not pushed yet count. `onCheck` hears what each run found:
 * null where there was nothing to compare (detached, on the base, nothing changed, the base not fetched). A run that
 * ran out of time says nothing. The work is named by `slug`, the tracked intent's, else by its branch ('').
 * @param {import('./team.mjs').Repo} repo @param {ReturnType<typeof import('./overlap.mjs').overlapJob>} job
 * @param {{ base: string, slug: string, owner: string }} work @param {(merge: MergeCheck | null) => void} onCheck
 */
export const checkBranch = async (repo, job, { base, slug, owner }, onCheck) => {
  // The tip, then the branch's name ('HEAD' when detached).
  const head = await repo.git(['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'])
  const [tip = '', branch = ''] = head.exitCode === 0 ? head.stdout.trim().split('\n') : []
  if (!tip || branch === 'HEAD' || branch === base) return onCheck(null)
  /** @type {Party} */
  const here = { key: 'here', slug: slug || branch, owner, stage: '', branch }
  await job.run(
    cache => readOverlaps(repo, { base, sides: [{ key: here.key, branch, tip }], cache }),
    read => {
      if (read.isPartial) return
      const collision = collisionsFor(read.overlaps, side => (side === here.key ? here : null), base)[0] ?? null
      onCheck(read.compared.includes(here.key) ? { base, at: Date.now(), collision } : null)
    },
  )
}

// Whether two checks found the same, whenever they ran: only then is there nothing new to draw.
/** @param {MergeCheck | null} one @param {MergeCheck | null} other */
export const isSameCheck = (one, other) => JSON.stringify(one && { ...one, at: 0 }) === JSON.stringify(other && { ...other, at: 0 })
