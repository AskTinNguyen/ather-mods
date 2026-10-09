// Ather Automata, the core alone: a repository with intents but no profile and
// no marker of a known kind. Intents, stages, Next and away windows work; proof
// is any build or test run read from its own output; nothing particular is held
// beyond merges and pushes to main. Pure: no `$`.

import { readToolOutput, rungsOfCommand } from './web.mjs'

/** @typedef {import('./index.mjs').Pack} Pack */
/** @typedef {import('./index.mjs').Rung} Rung */

const ROLES = ['engineer', 'designer', 'product']

/** @param {string} text */
const parseRole = text => {
  const words = text.toLowerCase()
  if (/design/.test(words)) return 'designer'
  if (/product|\bpm\b|manager|owner/.test(words)) return 'product'
  if (/engineer|programmer|coder|developer/.test(words)) return 'engineer'
  return null
}

/** @returns {Record<string, Rung>} */
const emptyEvidence = () => ({ tests: { state: 'none', detail: '' }, build: { state: 'none', detail: '' } })

/** @param {string} command @param {string} text @param {{ isError?: boolean }} ran */
const readShell = (command, text, ran) => {
  /** @type {import('./index.mjs').ShellReading} */
  const out = { rungs: [], context: [], toasts: [], bumps: [] }
  for (const rung of rungsOfCommand(command, {}, []).filter(one => one === 'tests' || one === 'build')) {
    const value = readToolOutput(rung, command, text, ran)
    if (value) out.rungs.push({ rung, value })
  }
  return out
}

const noLock = () => /** @type {import('./unreal.mjs').EditorLock} */ ({ state: 'unknown', holder: '', until: '', isStale: false, raw: '', session: '' })

/** @type {Pack} */
export const core = {
  id: 'core',
  roles: ROLES,
  roleLabels: { engineer: 'Engineer', designer: 'Designer', product: 'Product' },
  roleDescriptions: { engineer: 'Tests and a build that succeeded.', designer: 'A build that succeeded.', product: 'A build that succeeded.' },
  roleWords: 'engineer, designer or product',
  roleHelp: 'Which role? /ather role engineer, /ather role designer or /ather role product.',
  roleFallback: 'Tour skipped. Say your role any time with /ather role engineer, designer or product.',
  roleKey: 'core:',
  parseRole,
  owners: 'the repository owners',
  areas: [],
  normalizeArea: text => text.trim() || 'Unsorted',
  rungLabels: { tests: 'passing tests', build: 'a build that succeeded' },
  proofWords: { tests: 'tests', build: 'build' },
  emptyEvidence,
  requiredRungs: role => (role === 'engineer' ? ['tests', 'build'] : ['build']),
  isProven: (evidence, role) => (role === 'engineer' || role === '' ? ['tests', 'build'] : ['build']).every(rung => evidence[rung]?.state === 'pass'),
  anyProofText: 'passing tests and a build that succeeded',
  localDir: '.ather/local',
  debriefPath: slug => `docs/intent/${slug}/debrief.md`,
  lockFile: null,
  parseLock: noLock,
  lockRoles: [],
  ownCheck: null,
  traps: [],
  held: { labels: {}, nouns: {}, kinds: [], defaults: ['merge', 'push-main'] },
  heldSegment: () => null,
  mergePolicy: 'hold',
  isAssetSave: () => false,
  readShell,
  mcpKind: () => null,
  binaryAssets: null,
  briefPaths: /[A-Za-z]:[\\/]|\b[\w.-]+\/[\w./-]+\.\w+\b|\.(js|mjs|cjs|ts|tsx|jsx|py|md|json|css|html)\b/,
  skillGroups: [],
  createGroups: [],
  createOrder: {},
  createTitle: 'Make something',
  createMeta: () => '',
  createPrompt: (verb, name) => `I want to ${verb.charAt(0).toLowerCase()}${verb.slice(1)}. Use the ${name} skill.`,
  prompts: {
    brief: (_role, slug) => `Dispatch a background Opus worker for intent ${slug} using .agents/skills/intent/assets/worker-brief.md: exact paths, the acceptance checks it must prove, its own worktree, no commits in the main checkout.`,
    prove: (_role, slug) => `Prove intent ${slug}: run the repository's build and tests and report each command's exit code and pass/fail counts.`,
    ship: (_role, slug) => `Prepare intent ${slug} for landing: open the PR from a clean branch, list the evidence for each checklist item, then wait for my go before merging.`,
    shipHint: () => 'A clean PR; nothing merges without your go.',
    briefHint: 'A background agent does the work in its own worktree.',
    tour: 'Give me a short tour of how this repository runs features as intents: read .agents/skills/intent/SKILL.md (or docs/intent/README.md) and explain it in six short steps, ending with my first intent started.',
    tourToast: 'Ather: new here? Type /ather tour for a short tour of how this repository works with Claude Code.',
    ask: question => `I asked Ather: "${question}" Answer briefly in plain words. Ather is a Claude Code mod: /ather shows what needs me and the next step, /away hands over while I am away. If the question is about my work instead, answer from this checkout.`,
  },
  mandate: {
    flags: 'keep behaviour changes behind a flag that defaults to the current behaviour',
    allowed: 'push branches, open draft PRs, open PRs to main',
    merge: 'never merge',
    away: 'The session may push branches and open PRs; nothing merges until you are back.',
    pane: 'The session keeps working; merges and pushes to main wait for your review.',
  },
  statusWhat: 'this session',
  notHere: 'Ather Automata works in repositories with intents (a docs/intent folder); none here. /ather setup adds the structure.',
  gates: [],
  production: null,
}
