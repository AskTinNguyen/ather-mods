// a5r-hosts S-a (D9, F5): the paths an open hand-off claims, read by every local session through one function, claimedBy.
// A claim is a repo-relative path, a folder (a trailing `/`, or a plain path with files under it) or a glob; it is
// exclusive (a local edit is refused) or shared (a local edit is recorded). Binary assets default exclusive (`*.uasset`,
// `*.umap`, plus the claimExclusiveGlobs option), everything else shared. Pure: no `$`.
import { basename, globMatch, pathGlobMatch } from './a5r.ts'

export type Claim = { path: string; exclusive: boolean }
/** What claimedBy reads of a hand-off (handoff.ts `Handoff` has these fields). */
export type Claiming = { id: string; host: string; state: string; by?: { id8: string; lane?: string }; claims: readonly Claim[] }
export type ClaimHit = { id: string; host: string; claim: Claim }

/** F5: binary assets merge badly, so their claims default exclusive. */
export const DEFAULT_EXCLUSIVE: readonly string[] = ['*.uasset', '*.umap']
/** The exclusive defaults plus the claimExclusiveGlobs option (comma-separated globs). */
export const exclusiveGlobs = (option: string | undefined): string[] => [...DEFAULT_EXCLUSIVE, ...String(option ?? '').split(',').map(s => s.trim()).filter(Boolean)]

const slash = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '')

/** Whether a claim's path covers a repo-relative path: a glob with a `/` as git writes one (`*` within a folder, `**`
 * across, a trailing `/` the folder), a glob without one the file name at any depth, a plain path the file itself or
 * everything under it; no case. */
export const covers = (claim: string, path: string): boolean => {
  const c = slash(claim)
  const p = slash(path)
  if (/[*?]/.test(c)) return c.includes('/') ? pathGlobMatch(p, c) : globMatch(basename(p), c)
  const dir = c.toLowerCase().replace(/\/$/, '')
  const at = p.toLowerCase()
  return at === dir || at.startsWith(`${dir}/`)
}

/** A claim as given (`!path` exclusive, `~path` shared, a bare path by default; or `{ path, exclusive? }`), with its
 * exclusive flag decided: the given one, else exclusive when the path itself is a binary asset (or a glob of them). */
export const claimOf = (given: string | { path?: unknown; exclusive?: unknown }, globs: readonly string[]): Claim | null => {
  const raw = typeof given === 'string' ? given.trim() : String(given?.path ?? '').trim()
  const mark = typeof given === 'string' ? raw[0] : undefined
  const path = slash(mark === '!' || mark === '~' ? raw.slice(1).trim() : raw)
  if (!path || /^[A-Za-z]:\//.test(path) || path.startsWith('/') || path.split('/').includes('..')) return null // repo-relative only
  const said = typeof given === 'string' ? (mark === '!' ? true : mark === '~' ? false : undefined) : typeof given?.exclusive === 'boolean' ? given.exclusive : undefined
  return { path, exclusive: said ?? globs.some(g => covers(g, path)) }
}

/** Claims as given, each decided; null when one is not a repo-relative path (named in `bad`). */
export const claimsOf = (given: readonly (string | { path?: unknown; exclusive?: unknown })[], globs: readonly string[]): { claims: Claim[]; bad: string[] } => {
  const claims: Claim[] = []
  const bad: string[] = []
  for (const g of given) {
    const c = claimOf(g, globs)
    if (c) claims.push(c)
    else bad.push(typeof g === 'string' ? g : String(g?.path ?? ''))
  }
  return { claims, bad }
}

/** The open hand-off (state proposed) that claims a path, exclusive claims first; a hand-off this session recorded never
 * blocks its own session (`me8`). Null: no open hand-off claims it. */
export const claimedBy = (path: string, handoffs: readonly Claiming[], me8 = ''): ClaimHit | null => {
  let shared: ClaimHit | null = null
  for (const h of handoffs) {
    if (h.state !== 'proposed' || (me8 && h.by?.id8 === me8)) continue
    for (const claim of h.claims) {
      if (!covers(claim.path, path)) continue
      if (claim.exclusive) return { id: h.id, host: h.host, claim }
      shared ??= { id: h.id, host: h.host, claim }
    }
  }
  return shared
}

/** Claims as one line: `!` marks an exclusive one. */
export const claimsText = (cs: readonly Claim[]): string => (cs.length ? cs.map(c => `${c.exclusive ? '!' : ''}${c.path}`).join(', ') : 'no claims')

/** The refusal of an edit inside an exclusive claim (D9), as `A5R · claim — <why> → <next>` gives it. */
export const CLAIM_GATE = 'claim'
export const claimWhy = (path: string, hit: ClaimHit): [string, string] => [`${path} is claimed by hand-off ${hit.id} on ${hit.host}`, 'ask them to return it, or choose other paths']

/** A9: the diff paths inside another open hand-off's exclusive claim, for rule 1 at acceptance (`own`: the hand-offs of
 * the branch or intent being scored, which are its own). */
export const exclusiveHits = <T extends Claiming>(files: readonly string[], handoffs: readonly T[], own: (h: T) => boolean): { file: string; hit: ClaimHit }[] =>
  files.flatMap(file => {
    const hit = claimedBy(file, handoffs.filter(h => !own(h)))
    return hit?.claim.exclusive ? [{ file, hit }] : []
  })
