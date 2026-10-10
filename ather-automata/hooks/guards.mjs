// @ts-check
// Ather Automata: what tool calls and their output mean. Shell commands that
// must wait while the director is away, builds and tests read from their own
// output, MCP calls that count as evidence, thin worker briefs, known traps.
// Pure: no `$`.

import { unreal } from './packs/unreal.mjs'
import { WEB_HELD, makeWebPack } from './packs/web.mjs'
import { isBaseBranch, pushTarget, withFolders } from './shell.mjs'

/** @typedef {import('./packs/index.mjs').Pack} Pack */

// Every pack's held actions, by kind: a parked action reads the same whichever pack parked it.
const WEB = makeWebPack(null, null)
/** @type {Record<string, string>} */
export const HELD_LABELS = { merge: 'Merges', 'push-main': 'Pushes to main', ...unreal.held.labels, ...WEB.held.labels }
// For one held action in a sentence: "held a merge until you are back".
/** @type {Record<string, string>} */
export const HELD_NOUNS = { merge: 'a merge', 'push-main': 'a push to main', ...unreal.held.nouns, ...WEB.held.nouns }
/** @typedef {string} HeldKind merge, push-main, or one of a pack's held kinds */
// The Unreal pack's kinds, as before packs.
// What a held text says of main, for a checkout whose team merges into another branch: a push there is held
// as one to main is, and PRs open against it. With base main the text is as it was.
/** @param {string} text @param {string} [base] */
export const forBase = (text, base = 'main') => (base === 'main' ? text : text.replace(/\b(push(?:es)? to) main\b/gi, `$1 ${base} or main`).replace(/\bPRs to main\b/g, `PRs to ${base}`))
export const HELD_KINDS = /** @type {HeldKind[]} */ (['merge', 'push-main', 'editor-restart', 'asset-save'])
/** @param {Pack} pack @returns {string[]} */
export const heldKindsOf = pack => ['merge', 'push-main', ...pack.held.kinds]
export { WEB_HELD }

// The Unreal pack's readers, kept here for the modules and tests that read them from the guards.
export { automationResult, buildResult, isAssetSave, isAutomationCommand, isBuildCommand, isEditorBuild, isLogRead, mcpKind } from './packs/unreal.mjs'
export { gitFolders, isPiped, isSearchCommand } from './shell.mjs'

const GIT_REWRITE = /\bgit\b(?:\s+-[cC]\s+\S+)*\s+(stash(?!\s+(list|show)\b)|clean\b|reset\s+--hard|sparse-checkout(?!\s+(list|disable)\b)|checkout\b|switch\b|restore\b|rebase\b)/i

// Why a refused tree-rewriting git command was refused, and the safe way.
/** @param {string} command */
export const explainGuard = command => {
  const kind = GIT_REWRITE.exec(command)?.[1]?.split(/\s+/)[0]
  if (!kind) return null
  const safe = /\bgit\s+-C\s+\S+/.test(command)
    ? 'Run it from a separate worktree (git worktree add, then git -C <worktree path> ...), never in the shared checkout.'
    : 'Pin it: git -C <absolute worktree path> ..., with the path read back from git worktree list. Never after a cd.'
  return `git ${kind} rewrites the working tree that other sessions share. ${safe}`
}

/** @param {string} command */
// A merge or a pull (which merges); never `merge-base` or `merge --abort`.
export const isMergeCommand = command => /\bgit\b(?:\s+-C\s+\S+)?\s+(merge(?![-\w])|pull\b)(?!.*--abort)/i.test(command)

// A shell command the window holds, if any. `branchOf` gives the branch checked out in a folder
// (null: the session's folder), or '' when it cannot be told; then only an explicit main is held.
// main means main, master, or the checkout's base (`context.base`) when its team merges into another branch.
// With the web pack's with-proof policy (D2), a merge passes once every gate the profile requires has passed:
// `context.isProven` says so, read from this session's evidence by the caller.
// `context.at` gives a folder in another checkout that checkout's pack, held kinds and proof; null keeps the session's.
/**
 * @param {string} command @param {readonly string[]} held @param {(folder: string | null) => string} branchOf
 * @param {Pack} [pack] @param {import('./packs/index.mjs').HeldContext} [context] @returns {string | null}
 */
export const heldShell = (command, held, branchOf, pack = unreal, context = {}) => heldShellAt(command, held, branchOf, pack, context)?.kind ?? null

// The same, with the base of the checkout the held segment ran in: what is said of it names that branch.
/**
 * @param {string} command @param {readonly string[]} held @param {(folder: string | null) => string} branchOf
 * @param {Pack} [pack] @param {import('./packs/index.mjs').HeldContext} [context] @returns {{ kind: string, base: string } | null}
 */
export const heldShellAt = (command, held, branchOf, pack = unreal, context = {}) => {
  for (const { segment, folder } of withFolders(command)) {
    const here = context.at?.(folder) ?? null
    const judged = here ? { ...here, scripts: here.pack.scripts } : { pack, held, isProven: context.isProven === true, scripts: context.scripts ?? pack.scripts, base: context.base }
    const kind = heldSegmentIn(segment, branchOf(folder), judged)
    if (kind) return { kind, base: judged.base ?? 'main' }
  }
  return null
}

/** @param {string} segment @param {string} branch @param {{ pack: Pack, held: readonly string[], isProven: boolean, scripts?: Record<string, string>, base?: string }} judged */
const heldSegmentIn = (segment, branch, { pack, held, isProven, scripts, base }) => {
  const merges = !(pack.mergePolicy === 'with-proof' && isProven)
  const isPrMerge = /^gh\s+pr\s+merge\b/i.test(segment) || /^gh\s+api\b.*\bpulls\/\d+\/merge\b/i.test(segment)
  // A local merge matters only into main; merging main into a feature branch is ordinary work.
  const isMainMerge = /^git\b(?:\s+-C\s+\S+)?\s+merge\s+(?!--abort)/i.test(segment) && isBaseBranch(branch, base)
  if (held.includes('merge') && merges && (isPrMerge || isMainMerge)) return 'merge'
  if (held.includes('push-main') && /^git\b(?:\s+-C\s+\S+)?\s+push\b/i.test(segment) && isBaseBranch(pushTarget(segment, branch), base)) return 'push-main'
  const kind = pack.heldSegment(segment, held, { isProven, scripts })
  return kind && (kind !== 'merge' || merges) ? kind : null
}

// "mcp__unreal-mcp__get_actor" → "unreal-mcp": a readback must read from the server that was written to.
/** @param {string} tool */
export const mcpServer = tool => tool.split('__')[1] ?? tool

// Only briefs for workers that will change files or the Editor are checked.
/** @param {string} prompt @param {string | undefined} type @param {Pack} [pack] */
export const briefIssues = (prompt, type, pack = unreal) => {
  if (type !== undefined && /^(Explore|Plan|statusline-setup|claude-code-guide)$/i.test(type)) return []
  if (!/\b(edit|write|implement|fix|change|modify|refactor|add|create|delete|remove|rename|commit|save|build|compile|wire|author)\b/i.test(prompt) || /\bread-only\b|do not (edit|modify|change)|no edits/i.test(prompt)) return []
  const issues = []
  if (!pack.briefPaths.test(prompt)) issues.push('exact paths')
  if (!/acceptance|accept when|done when|success criteria|verify|evidence|proof|report format|deliverable|final (message|report)|report back|return (a|the) (list|report|summary)/i.test(prompt)) issues.push('acceptance checks')
  // A worker kept to its own folder, or told to leave git alone, already respects the shared tree.
  if (!/shared (checkout|tree|worktree)|git -C|worktree|no commits|do not commit|don't commit|never (stash|switch|clean)|no git (changes|commands)|work only in|edit nothing (else|outside)/i.test(prompt)) issues.push('the shared-tree rule')
  return issues
}

// ---------------------------------------------------------------- known traps

/** @typedef {{ file: string, text: string }} WrittenRule */
/** @typedef {{ id: string, title: string, fix: string, rule?: WrittenRule }} Trap */
/** @typedef {Record<string, { title: string, fix: string, count: number }>} TrapHits */

/** @param {string} text @param {Pack} [pack] */
export const matchGotchas = (text, pack = unreal) => pack.traps.filter(rule => rule.pattern.test(text))

// A trap hit in this many separate sessions becomes a "Needs you" item: make it a rule?
const RULE_AFTER_SESSIONS = 3

/** @param {TrapHits} hits @param {Trap} rule @returns {TrapHits} */
export const countGotcha = (hits, rule) => ({ ...hits, [rule.id]: { title: rule.title, fix: rule.fix, count: (hits[rule.id]?.count ?? 0) + 1 } })

// Only the pack's own traps: the counts are kept per machine, across every kind of repository.
/** @param {TrapHits} hits @param {readonly string[]} ruled @param {Pack} [pack] */
export const recurringGotchas = (hits, ruled, pack = unreal) =>
  Object.entries(hits)
    .filter(([id, hit]) => hit.count >= RULE_AFTER_SESSIONS && !ruled.includes(id) && pack.traps.some(trap => trap.id === id))
    .map(([id, hit]) => ({ id, ...hit }))
    .sort((a, b) => b.count - a.count)

/** @param {string} id @param {Pack} [pack] @returns {WrittenRule | undefined} */
export const writtenRuleOf = (id, pack = unreal) => pack.traps.find(one => one.id === id)?.rule
