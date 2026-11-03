// @ts-check
// Ather Automata: the other sessions' heartbeats, read. Each session writes its own through state.mjs
// (writeHeartbeat); these only read files under a checkout's local folder. Pure of `$` and of the store.

/** @typedef {import('./state.mjs').Io} Io */

// A heartbeat older than this, or one that says it ended, is no longer a live session.
const LANE_STALE_MS = 10 * 60 * 1000

/**
 * One session's heartbeat, a file under the pack's local folder: what it tracks, on which branch,
 * when it was written and when the session last took a prompt or ran a tool; `app`: its id and title in
 * the desktop app, when it runs there (absent elsewhere, and in heartbeats written before 0.6.5); `root`: the
 * session's own checkout ('' for a parent folder; absent before 0.6.6), which a heartbeat in another checkout
 * (one whose intent it tracks) does not share.
 * @typedef {{ sessionId: string, intent: string | null, branch: string, updatedAt: number, lastActiveAt?: number, away: string, hasEnded: boolean, app?: AppSession, root?: string }} Lane
 * @typedef {import('./handoff.mjs').AppSession} AppSession
 */

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
