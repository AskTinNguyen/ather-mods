// @ts-check
// Ather Board: the board's records for one checkout, read with Ather's reader (team.mjs readTeam:
// origin/<base> through git, never the index lock, plus the checkout's own folders), each dated by
// its folder's first commit. Ather's reader leaves out the progress of completed intents (its list does
// not show them); the board shows them, so it reads that progress itself, once per commit, or a done
// intent would read as none of its items met. Pure: git and the files come through the Repo it is given.

import { blobs, parseLog, readTeam } from './ather/team.mjs'
import { toRecord } from './records.mjs'

/**
 * @typedef {import('./ather/team.mjs').Repo} Repo
 * @typedef {import('./ather/team.mjs').TeamCache} TeamCache
 * @typedef {import('./ather/team.mjs').MainSnapshot} MainSnapshot
 * @typedef {import('./ather/packs/index.mjs').Pack} Pack
 * @typedef {import('./views.mjs').BoardRecord} BoardRecord
 * @typedef {{ team: TeamCache, created: { sha: string, at: Map<string, number> } | null, closed: { sha: string, progress: Map<string, string> } | null }} BoardCache
 *   what the last read learned: first commits, and the progress of the intents Ather's reader left without it
 * @typedef {{ records: BoardRecord[], sha: string, base: string, isRepo: boolean, readAt: number }} Board
 */

/** @type {BoardCache} */
export const EMPTY_BOARD_CACHE = { team: { main: null, local: null }, created: null, closed: null }

// When each folder was first committed on `sha`: the oldest commit adding a file under it (oldest first,
// so parseLog's first sight of a folder is its first commit).
/** @param {Repo} repo @param {string} sha */
const readCreated = async (repo, sha) => {
  const ran = await repo.git(['log', '--reverse', '--diff-filter=A', '--format=%x00%ct%x09%an', '--name-only', sha, '--', 'docs/intent'])
  return new Map([...parseLog(ran.exitCode === 0 ? ran.stdout : '')].map(([slug, { at }]) => [slug, at]))
}

// The progress.md of every folder on main that has one Ather's reader did not read (its completed
// intents), by slug, in one batch (team.mjs blobs).
/** @param {Repo} repo @param {MainSnapshot} main */
const readClosed = async (repo, main) => {
  const slugs = [...main.folders].filter(([, folder]) => folder.progress === '' && folder.files.includes('progress.md')).map(([slug]) => slug)
  const texts = await blobs(repo, main.sha, slugs.map(slug => `docs/intent/${slug}/progress.md`))
  return new Map(slugs.flatMap((slug, index) => { const text = texts[index]; return typeof text === 'string' ? [[slug, text.replace(/\r\n/g, '\n')]] : [] }))
}

/**
 * @param {Repo} repo @param {string} root
 * @param {{ pack: Pack, base: string, cache: BoardCache, now: number }} options
 * @returns {Promise<{ board: Board, cache: BoardCache }>}
 */
export const readBoard = async (repo, root, { pack, base, cache, now }) => {
  const team = await readTeam(repo, root, { cache: cache.team, pinned: null, base })
  const main = team.cache.main
  const sha = main?.sha ?? ''
  const created = !sha ? null : cache.created?.sha === sha ? cache.created : { sha, at: await readCreated(repo, sha) }
  const closed = !main ? null : cache.closed?.sha === main.sha ? cache.closed : { sha: main.sha, progress: await readClosed(repo, main) }
  const slugs = new Set(team.intents.map(files => files.slug))
  const records = team.intents.map(files => {
    const progress = files.source === 'main' && files.progress === '' ? closed?.progress.get(files.slug) : undefined
    return toRecord(progress === undefined ? files : { ...files, progress }, { pack, createdAt: created?.at.get(files.slug) ?? 0, now, slugs })
  })
  return { board: { records, sha, base, isRepo: team.isRepo, readAt: now }, cache: { team: team.cache, created, closed } }
}
