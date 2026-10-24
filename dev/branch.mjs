// What the dev tools share: the repository, git and a file now and at a ref (skills.mjs too); and for the branch
// checks (check-release, check-size, check-verdict) the base, the files a branch changed, which files each mod ships,
// and one way to report.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MARKET = '.claude-plugin/marketplace.json'

/** @param {string[]} argv */
export const git = (...argv) => execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).trim()
/** @param {string} text */
export const lines = text => text.split('\n').filter(Boolean)
/** @param {string} file @returns {string | null} */
export const readNow = file => (fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), 'utf8') : null)
/** @param {string} ref @param {string} file @returns {string | null} */
export const readAt = (ref, file) => {
  try {
    return git('show', `${ref}:${file}`)
  } catch {
    return null
  }
}

/** The versions a package-lock.json carries: its own and its root package's. */
export const lockVersions = json => [json.version, json.packages?.['']?.version]

// Each release unit: its folders, where its version is kept, its marketplace entry and its README.
// paseo/ather-automata ships with ather-automata (server/sync.mjs gives it the mod's version), so it is one unit.
export const UNITS = [
  {
    name: 'ather-automata',
    roots: ['ather-automata/', 'paseo/ather-automata/'],
    versionFile: 'ather-automata/.claude-plugin/plugin.json',
    market: 'ather-automata',
    readme: 'ather-automata/README.md',
    alsoAt: [
      { file: 'paseo/ather-automata/package.json', read: json => [json.version] },
      { file: 'paseo/ather-automata/package-lock.json', read: lockVersions },
    ],
    fixHint: ' Run npm run sync in paseo/ather-automata.',
  },
  {
    name: 'ather-board',
    roots: ['ather-board/'],
    versionFile: 'ather-board/.claude-plugin/plugin.json',
    market: 'ather-board',
    readme: 'ather-board/README.md',
    // The board does not release when only its copies move (the owner's decision, 2026-10-21): a note, not a failure.
    // The copies ship with its next real release.
    copyRoots: ['ather-board/hooks/ather/'],
  },
  {
    name: 'ather-lanes',
    roots: ['ather-lanes/'],
    versionFile: 'ather-lanes/.claude-plugin/plugin.json',
    market: 'ather-lanes',
    readme: 'ather-lanes/README.md',
    // Its copies of Ather's modules follow the board's rule.
    copyRoots: ['ather-lanes/hooks/ather/'],
  },
  {
    name: 'week-calendar',
    roots: ['week-calendar/'],
    versionFile: 'week-calendar/.claude-plugin/plugin.json',
    market: 'week-calendar',
    readme: 'week-calendar/README.md',
  },
  {
    // Its own version for now (package.json, server/calendar.ts VERSION and its README), behind week-calendar's.
    // Warnings only until the owner decides whether the Paseo week calendar is supported.
    name: 'paseo/week-calendar',
    roots: ['paseo/week-calendar/'],
    versionFile: 'paseo/week-calendar/package.json',
    readme: 'paseo/week-calendar/README.md',
    alsoAt: [{ file: 'paseo/week-calendar/package-lock.json', read: lockVersions }],
    follows: 'week-calendar',
    isWarnOnly: true,
  },
]

// Files inside a mod's folders that it does not ship: the dev scripts that make its copies, and its build settings.
const DEV_ONLY = new Set([
  'ather-board/shared.json',
  'ather-lanes/shared.json',
  'paseo/ather-automata/server/sync.mjs',
  'paseo/ather-automata/server/test-resolve.mjs',
  'paseo/ather-automata/server/art/render.mjs',
  'paseo/week-calendar/server/embed.mjs',
  ...['ather-automata', 'week-calendar'].flatMap(plugin => ['package-lock.json', 'tsconfig.json', '.gitignore'].map(name => `paseo/${plugin}/${name}`)),
])
// Copies and generated files: their source is what a person edits (each has its own --check).
const COPIES = [/^[^/]+\/hooks\/ather\//, /^paseo\/ather-automata\/server\/ather\//, /\.generated\.ts$/]

/** @param {string} file */
export const isTest = file => /(^|\/)tests?\//.test(file) || /\.test\.[cm]?[jt]sx?$/.test(file)
/** @param {string} file */
export const isCopy = file => COPIES.some(copy => copy.test(file))
/** What a unit ships: a file in its folders that is not Markdown, a test, a dev-only file or the engine's types. */
export const isShipped = (unit, file) =>
  unit.roots.some(root => file.startsWith(root)) && !file.endsWith('.md') && !isTest(file) && !DEV_ONLY.has(file) && !file.includes('/.claude-plugin/types/')
/** @param {string} file */
export const unitOf = file => UNITS.find(unit => isShipped(unit, file)) ?? null
/** Every file a release writes a version into: plugin.json, the marketplace and the Paseo package files. */
export const VERSION_FILES = new Set([MARKET, ...UNITS.flatMap(unit => [unit.versionFile, ...(unit.alsoAt ?? []).map(one => one.file)])])

/**
 * The ref a branch is compared with: --base <ref>, or origin/main. One that git does not know ends the script.
 * @param {string[]} args @param {string} script
 */
export const baseFrom = (args, script) => {
  const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main'
  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`)
  } catch {
    console.error(`dev/${script}: ${base} is not known here. Run git fetch origin main (or pass --base <ref>).`)
    process.exit(2)
  }
  return base
}

/** What the working tree changed since it left the base: commits, uncommitted edits and new files. @param {string} base */
export const changedSince = base => {
  const mergeBase = git('merge-base', base, 'HEAD')
  return { mergeBase, files: [...new Set([...lines(git('diff', '--name-only', mergeBase)), ...lines(git('ls-files', '--others', '--exclude-standard'))])] }
}

/** One line per message; under GitHub Actions also an annotation. @param {'error' | 'warning'} kind @param {string} text @param {string} [file] */
export const report = (kind, text, file) =>
  console.log(process.env.GITHUB_ACTIONS ? `::${kind}${file ? ` file=${file}` : ''}::${text}` : `${kind === 'error' ? 'FAIL' : 'note'} ${text}`)
