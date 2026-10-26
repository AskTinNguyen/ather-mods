// @ts-check
// Ather Lanes' store: the one home of what the mod keeps. The store is the plugin's, one JSON file for every session
// on the machine, so each kind of key says who deletes it. Two kinds, both caches of one lane 0 (the checkout the
// lanes hang off) that any session on it rebuilds, each value naming that lane 0's folder:
// - `full:<lane 0>`: the last full read (Status, refs, PRs), for the closed pane, the status line and lanes_summary;
// - `prs:<lane 0>`: gh's answer for the lane branches, reused for 5 minutes.
// Who deletes: every write deletes the keys that name a lane 0 whose folder is gone. No session can be writing those
// (a session's checkout is its lane 0 or a worktree of it), so a delete never races another session's write; any
// doubt keeps the key (isStale). Every write is a whole value and nothing is read to be changed and
// written back, so the writes need no queue. Takes the store as closures (Io), never `$`.

import { fullData, fullOf } from './records.mjs'
import { folderKey } from './sources.mjs'

/**
 * @typedef {{ get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<void>, keys: () => Promise<readonly string[]>, remove: (key: string) => Promise<void>, exists: (path: string) => Promise<boolean> }} StoreIo
 * @typedef {import('./records.mjs').Full} Full
 * @typedef {{ at: number, branches: string[], stdout: string }} KeptPrs gh's answer and the branches it was asked for
 */

const FULL = 'full:'
const PRS = 'prs:'
const KINDS = [FULL, PRS]

/** @param {StoreIo} io @param {string} key */
const get = (io, key) => io.get(key).catch(() => undefined)

// A key of either kind goes only when it names its lane 0 and that folder is surely gone. One that names none (a
// value from before 0.2.1, which a session not yet reloaded may still be writing), one that cannot be read, and one
// whose folder cannot be looked at all stay. A lane 0 cloned again at the same path in the moment between the look
// and the delete loses one cache, which its next full read rebuilds.
/** @param {StoreIo} io @param {string} key */
const isStale = async (io, key) => {
  const main = /** @type {{ main?: unknown } | undefined} */ (await get(io, key))?.main
  return typeof main === 'string' && (await io.exists(main).catch(() => true)) === false
}

/** @param {StoreIo} io @param {string} key @param {{ main: string }} value */
const keep = async (io, key, value) => {
  try {
    await io.set(key, value)
    for (const other of await io.keys()) if (other !== key && KINDS.some(kind => other.startsWith(kind)) && (await isStale(io, other))) await io.remove(other)
  } catch {
    // A store that fails keeps nothing; the next full read rebuilds it.
  }
}

/** @param {StoreIo} io @param {string} main lane 0's folder @returns {Promise<Full | null>} */
export const readFull = async (io, main) => fullOf(await get(io, FULL + folderKey(main)))

/** @param {StoreIo} io @param {string} main @param {Full} full */
export const keepFull = (io, main, full) => keep(io, FULL + folderKey(main), { main, ...fullData(full) })

/** @param {StoreIo} io @param {string} main @returns {Promise<KeptPrs | null>} */
export const readKeptPrs = async (io, main) => {
  const data = /** @type {any} */ (await get(io, PRS + folderKey(main)))
  const isKept = typeof data?.at === 'number' && typeof data.stdout === 'string' && Array.isArray(data.branches) && data.branches.every((/** @type {unknown} */ one) => typeof one === 'string')
  return isKept ? { at: data.at, branches: data.branches, stdout: data.stdout } : null
}

/** @param {StoreIo} io @param {string} main @param {KeptPrs} kept */
export const keepPrs = (io, main, kept) => keep(io, PRS + folderKey(main), { main, ...kept })
