// Ather Automata: no "tests pass" without a passing run. The latest result of
// each check this session ran (build, tests, type check, lint), read by the
// packs' own readers; whether a later edit made it stale; the claims a reply
// makes; and what sends Claude back when a claim has no passing run behind it.
// Pure: no `$`. state.mjs stores what these functions return.

import { clockText } from './model.mjs'
import { withFolders } from './shell.mjs'

/** @typedef {'build' | 'test' | 'typecheck' | 'lint'} CheckKind */
/** @typedef {CheckKind | 'all'} ClaimKind 'all': "all green", "verified": every check */
/**
 * One check's latest result. `startedAt`: when its command began (an edit after it is not in the run);
 * `at`: when it ended. `repo`: the checkout its folder is in, as stored paths are (normPath).
 * @typedef {{ kind: CheckKind, name: string, folder: string, repo: string, state: 'pass' | 'fail' | 'unknown', summary: string, startedAt: number, at: number }} CheckResult
 */
/**
 * The session's checks: the latest result per check, the last edit per repository (`code`: a non-Markdown
 * file, `any`: any file), and the results already sent back, per loop (once per result).
 * @typedef {{ results: CheckResult[], edits: Record<string, { code: number, any: number }>, sentBack: string[] }} Checks
 */
/** @typedef {{ kind: CheckKind, name: string }} CheckOf what a pack says one rung of one command is */

export const KINDS = /** @type {const} */ (['build', 'test', 'typecheck', 'lint'])
export const NO_CHECKS = /** @type {Checks} */ ({ results: [], edits: {}, sentBack: [] })
const RESULTS_KEPT = 20
const REPOS_KEPT = 20

/** @param {unknown} value @returns {Checks} */
export const checksOf = value => {
  const stored = /** @type {Partial<Checks> | undefined} */ (value)
  return { results: Array.isArray(stored?.results) ? stored.results : [], edits: stored?.edits && typeof stored.edits === 'object' ? stored.edits : {}, sentBack: Array.isArray(stored?.sentBack) ? stored.sentBack : [] }
}

// A path as stored and compared: forward slashes, no trailing slash, a Windows drive path in lower case.
/** @param {string} path */
export const normPath = path => {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[A-Za-z]:/.test(slashed) ? slashed.toLowerCase() : slashed
}

// The folder a stored path is in.
/** @param {string} path */
export const parentOf = path => path.replace(/\/[^/]*$/, '')

/** @param {string} path */
export const isMarkdown = path => /\.(md|mdx|markdown)$/i.test(path)

// The file an editing tool call wrote, or null for any other call.
/** @param {string} tool @param {Record<string, unknown>} input */
export const editedFile = (tool, input) => {
  const path = tool === 'NotebookEdit' ? input.notebook_path : /^(Write|Edit|MultiEdit)$/.test(tool) ? input.file_path : undefined
  return typeof path === 'string' && path !== '' ? path : null
}

// The folder a command's last segment runs in (its last `cd`), or null: the session's folder.
/** @param {string} command */
export const runFolder = command => withFolders(command).at(-1)?.folder ?? null

/**
 * The checks one finished command ran, from the rungs its pack read: each rung the pack names as a check
 * kind, with the check's name. A rung read as 'none' (no result in the output) is an unknown result.
 * @param {{ checksOf: (rung: string, command: string) => CheckOf[] }} pack @param {string} command @param {{ rung: string, value: import('./packs/index.mjs').Rung }[]} rungs
 * @returns {(CheckOf & { state: CheckResult['state'], summary: string })[]}
 */
export const runsOf = (pack, command, rungs) =>
  rungs.flatMap(({ rung, value }) => pack.checksOf(rung, command).map(one => ({ ...one, state: value.state === 'none' ? /** @type {const} */ ('unknown') : value.state, summary: value.detail })))

/** @param {Pick<CheckResult, 'kind' | 'name' | 'repo'>} result */
const keyOf = result => `${result.kind}|${result.name}|${result.repo}`

// A run replaces the last result of the same check (kind, name and repository).
/** @param {Checks} checks @param {CheckResult[]} runs @returns {Checks} */
export const withRuns = (checks, runs) => {
  const keys = new Set(runs.map(keyOf))
  return { ...checks, results: [...checks.results.filter(one => !keys.has(keyOf(one))), ...runs].slice(-RESULTS_KEPT) }
}

/** @param {Checks} checks @param {string} repo @param {boolean} isCode @param {number} at @returns {Checks} */
export const withEdit = (checks, repo, isCode, at) => {
  const last = checks.edits[repo] ?? { code: 0, any: 0 }
  const kept = Object.entries(checks.edits).filter(([one]) => one !== repo).slice(-(REPOS_KEPT - 1))
  return { ...checks, edits: Object.fromEntries([...kept, [repo, { code: isCode ? at : last.code, any: at }]]) }
}

// Stale: a file in its repository was edited after the run began. A Markdown-only edit leaves a build,
// tests and a type check current; lint reads Markdown too.
/** @param {Checks} checks @param {CheckResult} result */
export const isStale = (checks, result) => {
  const edit = checks.edits[result.repo]
  return edit !== undefined && (result.kind === 'lint' ? edit.any : edit.code) > result.startedAt
}

// ---------------------------------------------------------------- claims in a reply

/** @type {{ kind: ClaimKind, pattern: RegExp }[]} */
const CLAIMS = [
  { kind: 'test', pattern: /\b(?:all\s+|the\s+|unit\s+|automation\s+|e2e\s+|end-to-end\s+|\d+(?:\s*\/\s*\d+)?\s+)*tests?\s+(?:now\s+|all\s+|still\s+)*(?:pass(?:es|ed|ing)?|are\s+(?:passing|green)|succeed(?:s|ed)?)\b/i },
  { kind: 'test', pattern: /\b(?:test\s+)?suite\s+(?:is\s+|now\s+)*(?:green|passing|passes|passed)\b|\b(\d+)\s*\/\s*\1\s+passed\b/i },
  { kind: 'build', pattern: /\bbuilds?\s+(?:is\s+|was\s+|now\s+|still\s+)*(?:pass(?:es|ed)|succeed(?:s|ed)?|successful|green|clean(?:ly)?|works)\b|\bbuilds\s+(?:all\s+)?pass\b|\bcompiles?\s+(?:clean(?:ly)?|successfully|without errors)\b|\bcompiled\s+(?:clean(?:ly)?|successfully|without errors)\b|\bResult:\s*Succeeded\b/i },
  { kind: 'typecheck', pattern: /\b(?:tsc|type[- ]?check(?:s|ing|er)?)\s+(?:is\s+|are\s+|now\s+|still\s+)*(?:pass(?:es|ed)|clean(?:ly)?|green|succeed(?:s|ed)?)\b|\btype[- ]?checks\s+pass\b|\btypes\s+are\s+(?:clean|green)\b|\bno type errors\b/i },
  { kind: 'lint', pattern: /\b(?:es)?lint(?:ing|er|s)?\s+(?:is\s+|are\s+|now\s+|still\s+)*(?:pass(?:es|ed)|clean(?:ly)?|green)\b|\bno lint (?:errors|warnings)\b/i },
  { kind: 'all', pattern: /\ball green\b|\beverything (?:is\s+)?(?:green|passes|passing)\b|\ball checks (?:pass(?:ed)?|are green)\b|^(?:fully\s+|all\s+)?verified\s*(?:[.:!✓✅—-]|$)|\b(?:fully|end[- ]to[- ]end)\s+verified\b/i },
]

// Words that make a sentence conditional, negative, about the future, about someone's words, or advice.
const HEDGE = /\b(?:not|never|no longer|fail\w*|if|should|would|will|could|might|may|until|unless|once|before|when|whether|expect\w*|hopefully|probably|likely|assum\w*|untested|unverified|yet|pending|owed|skipped|say|says|said|claim\w*|mentions?|to confirm|to verify|to check|make sure|ensure)\b|n't\b|\bI'll\b/i
// A failure count of zero is part of a pass ("12 passed, 0 failed"), not a hedge.
const NO_FAILURES = /\b0\s+(?:failed|failures?|errors?)\b|\bno failures\b|\bzero failures\b/gi
// A phrase in double quotes, curly quotes or backticks is mentioned, not said.
const QUOTED = /"[^"]*"|“[^”]*”|`[^`]*`/g

// The reply's prose as sentences: code blocks and inline code out, list marks and emphasis off.
/** @param {string} reply */
const sentences = reply =>
  reply
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\n+|(?<=[.!?])\s+/)
    .map(one => one.replace(/^[\s>#*+-]*(?:\d+[.)]\s*)?(?:[✓✅☑]\s*)?/u, '').replace(/[*_]+/g, '').trim())
    .filter(Boolean)

/**
 * The passes a reply claims, in sentence order: each sentence's kinds. A question, a hedged sentence, or a
 * check phrase in quotes claims nothing.
 * @param {string} reply @returns {{ sentence: string, kind: ClaimKind }[]}
 */
export const claimsIn = reply =>
  sentences(reply).flatMap(sentence => {
    const said = sentence.replace(QUOTED, ' ').replace(NO_FAILURES, ' ').trim()
    if (said.endsWith('?') || HEDGE.test(said)) return []
    return [...new Set(CLAIMS.filter(one => one.pattern.test(said)).map(one => one.kind))].map(kind => ({ sentence, kind }))
  })

// ---------------------------------------------------------------- what a claim is held against

const SAID = { build: 'the build succeeded', test: 'the tests pass', typecheck: 'the type check is clean', lint: 'lint passes', all: 'everything passes' }
const NONE_RAN = { build: 'no build ran this session', test: 'no tests ran this session', typecheck: 'no type check ran this session', lint: 'lint did not run this session', all: 'no build, tests, type check or lint ran this session' }

/** @param {string} repo */
const repoName = repo => repo.split('/').filter(Boolean).at(-1) ?? repo

/**
 * What stands against a claim of one kind, or null when its checks back it: a failure (latest first),
 * then the latest result if it is stale or could not be read, then no run at all. `key` names the result,
 * so the same one is sent back once.
 * @param {Checks} checks @param {ClaimKind} kind @param {number} tz @returns {{ key: string, text: string } | null}
 */
export const problemFor = (checks, kind, tz) => {
  const ofKind = checks.results.filter(one => kind === 'all' || one.kind === kind).sort((a, b) => b.at - a.at)
  const when = (/** @type {CheckResult} */ one) => clockText(one.at, tz)
  const failed = ofKind.find(one => one.state === 'fail')
  if (failed) return { key: `${keyOf(failed)}@${failed.at}`, text: `the last ${failed.name} failed: ${failed.summary || 'see its output'} (${when(failed)})` }
  const stale = ofKind.find(one => isStale(checks, one))
  if (stale) return { key: `${keyOf(stale)}@${stale.at}~stale`, text: `the last ${stale.name} ran at ${when(stale)}, before a later edit in ${repoName(stale.repo)}` }
  const unread = ofKind.find(one => one.state === 'unknown')
  if (unread) return { key: `${keyOf(unread)}@${unread.at}`, text: `the result of the last ${unread.name} (${when(unread)}) could not be read from its output` }
  return ofKind.length === 0 ? { key: `none:${kind}`, text: NONE_RAN[kind] } : null
}

/** @param {ClaimKind} kind @param {string} sentence @param {string} problem */
export const claimMessage = (kind, sentence, problem) => {
  const quoted = sentence.length <= 120 ? sentence : `${sentence.slice(0, 119)}…`
  return `Ather Automata: you said ${SAID[kind]} ("${quoted}"), but ${problem}. Run it, or say plainly that it is untested.`
}

/**
 * The reply's first claim that no passing run backs, as the message that sends Claude back, unless that
 * result was already sent back in this loop ('' the main one, else a worker's id). Pure: returns the checks
 * with the result marked sent back.
 * @param {Checks} checks @param {string} reply @param {string} loop @param {number} tz
 * @returns {{ checks: Checks, block: string | null }}
 */
export const claimAgainst = (checks, reply, loop, tz) => {
  for (const { sentence, kind } of claimsIn(reply)) {
    const problem = problemFor(checks, kind, tz)
    const key = problem ? `${loop}#${problem.key}` : ''
    if (!problem || checks.sentBack.includes(key)) continue
    return { checks: { ...checks, sentBack: [...checks.sentBack, key].slice(-40) }, block: claimMessage(kind, sentence, problem.text) }
  }
  return { checks, block: null }
}

// The next turn: the main loop's claims may be sent back again. A worker's stay sent back.
/** @param {Checks} checks @returns {Checks} */
export const nextTurn = checks => ({ ...checks, sentBack: checks.sentBack.filter(key => !key.startsWith('#')) })

// The band's line for failing checks: the latest, and how many more ("✗ S2Editor build failed · 14:20 · +1"). '' when none fails.
/** @param {Checks} checks @param {number} tz */
export const failingLine = (checks, tz) => {
  const failing = checks.results.filter(one => one.state === 'fail').sort((a, b) => b.at - a.at)
  const [latest] = failing
  return latest ? `✗ ${latest.name} failed · ${clockText(latest.at, tz)}${failing.length > 1 ? ` · +${failing.length - 1}` : ''}` : ''
}
