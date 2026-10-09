// Ather Automata: which pack serves a repository, and the shape every pack has.
// The core (intents, Plan → Build → Prove → Ship, Next, away windows, issues,
// the squad) is the same everywhere; a pack says what proof, traps, held
// actions and words fit the kind of project. Pure apart from the Io it is given.
//
// Selection (D3): the repository's .ather/profile.json, then markers (*.uproject
// → unreal; package.json or pyproject.toml → web), then the core alone. Read once
// per session and root, and cached.

import { core } from './core.mjs'
import { unreal } from './unreal.mjs'
import { makeWebPack } from './web.mjs'

/**
 * @typedef {{ state: 'none' | 'pass' | 'fail', detail: string, at?: number, by?: string }} Rung `at`, `by`: when, and by which session (its first 8 hex), the record was written
 * @typedef {{ rungs: { rung: string, value: Rung }[], context: string[], toasts: { text: string, timeoutMs?: number }[], bumps: string[] }} ShellReading
 * @typedef {{ id: string, pattern: RegExp, title: string, fix: string, rule?: { file: string, text: string } }} PackTrap
 * @typedef {{ name: string, verb: string, isGlobal?: boolean }} CreateItem
 * @typedef {{ isHeld: boolean, isFree: boolean, holder: string, until: string }} EditorState
 * @typedef {{ command: string, proofs: string[], id?: string, proves?: string }} Gate
 * @typedef {{ host: string, branch: string, deployment: string, url: string, expectStatus: number }} Production
 * @typedef {{ isProven?: boolean, scripts?: Record<string, string> }} HeldContext
 * @typedef {{
 *   id: 'unreal' | 'web' | 'core',
 *   roles: readonly string[], roleLabels: Record<string, string>, roleDescriptions: Record<string, string>,
 *   roleWords: string, roleHelp: string, roleFallback: string, roleKey: string, parseRole: (text: string) => string | null,
 *   owners: string, areas: readonly string[], normalizeArea: (text: string) => string,
 *   rungLabels: Record<string, string>, proofWords: Record<string, string>, emptyEvidence: () => Record<string, Rung>,
 *   requiredRungs: (role: string) => string[], isProven: (evidence: Record<string, Rung>, role: string) => boolean, anyProofText: string,
 *   localDir: string, debriefPath: (slug: string) => string,
 *   lockFile: string | null, parseLock: (raw: string | null, nowMinutes: number) => import('./unreal.mjs').EditorLock, lockRoles: readonly string[],
 *   lockLine?: (command: string, raw: string) => string,
 *   ownCheck: { role: string, after: string, rung: string, label: string, hint: string, proveHint: string, detail: string, reply: string } | null,
 *   traps: readonly PackTrap[],
 *   held: { labels: Record<string, string>, nouns: Record<string, string>, kinds: readonly string[], defaults: readonly string[] },
 *   heldSegment: (segment: string, held: readonly string[], context: HeldContext) => string | null,
 *   mergePolicy: 'hold' | 'with-proof', mergeRungs?: readonly string[],
 *   isAssetSave: (input: string) => boolean, readShell: (command: string, text: string, ran: { isError?: boolean }) => ShellReading,
 *   mcpKind: (input: string) => 'write' | 'read' | 'pie' | null, binaryAssets: RegExp | null, briefPaths: RegExp,
 *   skillGroups: readonly { group: string, names: readonly string[] }[], createGroups: readonly { group: string, items: readonly CreateItem[] }[],
 *   createOrder: Record<string, readonly string[]>, createTitle: string, createMeta: (editor: EditorState) => string, createPrompt: (verb: string, name: string, editor: EditorState) => string,
 *   prompts: { brief: (role: string, slug: string) => string, prove: (role: string, slug: string) => string, ship: (role: string, slug: string) => string, shipHint: (role: string) => string, briefHint: string, tour: string, tourToast: string, ask: (question: string) => string },
 *   mandate: { flags: string, allowed: string, merge: string, away: string, pane: string },
 *   statusWhat: string, notHere: string, gates: readonly Gate[], production: Production | null, scripts?: Record<string, string>,
 *   teams?: Readonly<Record<string, string>>, names?: import('../worklist.mjs').NameRules,
 *   [key: string]: unknown
 * }} Pack
 */

/**
 * What selection reads: closures over the engine, as state.mjs's Io.
 * @typedef {{ read: (path: string) => Promise<string | null>, exists: (path: string) => Promise<boolean>, list: (path: string) => Promise<{ name: string, kind: string }[]>, sessionId: () => Promise<string> }} PackIo
 */

/** @param {string | null} text */
const json = text => {
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * Which pack a repository gets, and why. Pure over what it reads.
 * @param {PackIo} io @param {string} root
 * @returns {Promise<{ pack: Pack, source: 'profile' | 'marker' | 'none', profile: Record<string, any> | null }>}
 */
export const choosePack = async (io, root) => {
  const profile = json(await io.read(`${root}/.ather/profile.json`))
  const packageJson = json(await io.read(`${root}/package.json`))
  const named = typeof profile?.pack === 'string' ? profile.pack.toLowerCase() : ''
  if (named === 'unreal') return { pack: unreal, source: 'profile', profile }
  if (named === 'web') return { pack: makeWebPack(profile, packageJson), source: 'profile', profile }
  if (named === 'core') return { pack: core, source: 'profile', profile }
  const entries = await io.list(root).catch(() => [])
  if (entries.some(entry => entry.kind === 'file' && /\.uproject$/i.test(entry.name))) return { pack: unreal, source: 'marker', profile }
  if (packageJson || entries.some(entry => entry.kind === 'file' && /^(package\.json|pyproject\.toml)$/i.test(entry.name))) return { pack: makeWebPack(profile, packageJson), source: 'marker', profile }
  return { pack: core, source: 'none', profile }
}

/** @type {Map<string, ReturnType<typeof choosePack>>} */
const chosen = new Map()

// Once per session and root: a profile edited mid-session takes effect in the next session.
/** @param {PackIo} io @param {string} root */
export const packFor = async (io, root) => {
  const key = `${await io.sessionId().catch(() => '')}|${root}`
  const hit = chosen.get(key)
  if (hit) return hit
  const read = choosePack(io, root)
  chosen.set(key, read)
  return read
}

// A repository that got its intents mid-session (/ather setup) has a profile now: its pack is chosen again.
/** @param {Pick<PackIo, 'sessionId'>} io @param {string} root */
export const forgetPack = async (io, root) => void chosen.delete(`${await io.sessionId().catch(() => '')}|${root}`)

// Tests only: forget what was chosen.
export const forgetPacks = () => chosen.clear()

export { core, unreal, makeWebPack }
