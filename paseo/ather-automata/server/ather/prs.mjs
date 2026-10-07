// Ather Automata: whether the PRs an intent names are merged, read with `gh pr view` in the
// background and kept per PR (state.mjs). Ather never writes to GitHub. Pure: no `$`.

import { isAllMet } from './model.mjs'

// A PR that is not merged yet (or could not be read) is asked about again after this; a merged one never.
export const PR_EVERY_MS = 15 * 60 * 1000

/** @typedef {{ state: import('./model.mjs').PrState, at: number }} PrRecord what gh last said about a PR, and when */

// The PRs worth asking gh about: those of open intents whose every item is met (only they can be
// ready to close), not merged when last read, and not read in the last PR_EVERY_MS.
/** @param {readonly import('./model.mjs').Intent[]} intents @param {Readonly<Record<string, PrRecord>>} records @param {number} now @returns {number[]} */
export const prsToRead = (intents, records, now) =>
  [...new Set(intents.filter(isAllMet).flatMap(one => one.prs))].filter(number => {
    const record = records[number]
    return record?.state !== 'MERGED' && !(record && now - record.at < PR_EVERY_MS)
  })

// `gh pr view <n> --json state,mergedAt` output: 'MERGED', 'OPEN' or 'CLOSED', or null when unreadable.
/** @param {string} json @returns {'MERGED' | 'OPEN' | 'CLOSED' | null} */
export const parsePrState = json => {
  /** @type {any} */
  let row
  try {
    row = JSON.parse(json)
  } catch {
    return null
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  // `state` alone decides: an unmerged PR's mergedAt may be null or a zero date, depending on the gh version.
  const found = String(row.state ?? '').toUpperCase()
  return found === 'MERGED' || found === 'OPEN' || found === 'CLOSED' ? found : null
}
