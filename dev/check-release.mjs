// Release guard. A branch that changes what a mod ships also raises that mod's version, in every place the version is
// written, above the base branch's, with a line for it under Changes in the mod's README. Every version also agrees
// across plugin.json, the marketplace and the Paseo package. CI runs it on every pull request (.github/workflows/pr-rules.yml).
//   node dev/check-release.mjs                      against origin/main (run `git fetch origin main` first)
//   node dev/check-release.mjs --base <ref>         against another branch
//   node dev/check-release.mjs --allow-unreleased   a fix whose release comes in a later PR (the release-later label):
//                                                   a changed mod with no new version is a warning, not a failure
//   node dev/check-release.mjs --unreleased         no base: list what each mod changed since its version last moved
// The release units and what each ships are in dev/branch.mjs.
// A pass holds only for the base it ran against. Two PRs can each pass with the same new version; main therefore requires
// branches to be up to date before merging, so this runs again on top of whatever merged first.
import { MARKET, UNITS, baseFrom, changedSince, git, isShipped, lines, readAt, readNow, report } from './branch.mjs'

const args = process.argv.slice(2)

/** @param {string | null} text */
const versionIn = text => (text === null ? null : JSON.parse(text).version ?? null)
const isVersion = version => /^\d+\.\d+\.\d+$/.test(version ?? '')
const compare = (a, b) => {
  const [x, y] = [a, b].map(one => one.split('.').map(Number))
  for (let at = 0; at < 3; at++) if (x[at] !== y[at]) return x[at] - y[at]
  return 0
}
const changesLine = (readme, version) => readme !== null && new RegExp(`^- \\*\\*${version.replace(/\./g, '\\.')}\\*\\*`, 'm').test(readme)
const listed = files => `${files.slice(0, 5).join(', ')}${files.length > 5 ? ` and ${files.length - 5} more` : ''}`

// Messages, said once each. A unit marked isWarnOnly turns its errors into warnings.
let errors = 0
let notes = 0
const error = text => (errors++, report('error', text))
const note = text => (notes++, report('warning', text))
const fail = (unit, text) => (unit.isWarnOnly ? note : error)(text)

// ---------------------------------------------------------------- every version agrees, wherever it is written

const marketText = readNow(MARKET)
if (marketText === null) {
  console.error(`dev/check-release.mjs: ${MARKET} is missing.`)
  process.exit(2)
}
const market = JSON.parse(marketText)
for (const unit of UNITS) {
  const version = versionIn(readNow(unit.versionFile))
  if (!isVersion(version)) {
    fail(unit, `${unit.versionFile}: "${version}" is not a version like 1.2.3.`)
    continue
  }
  if (unit.market) {
    const entry = market.plugins.find(one => one.name === unit.market)
    if (!entry) fail(unit, `${MARKET} has no entry for ${unit.market}.`)
    else if (entry.version !== undefined && entry.version !== version) fail(unit, `${unit.name}: ${MARKET} says ${entry.version}, ${unit.versionFile} says ${version}. Write the same version in both.`)
  }
  for (const { file, read } of unit.alsoAt ?? []) {
    const text = readNow(file)
    const found = text === null ? ['missing'] : read(JSON.parse(text))
    if (found.some(one => one !== version)) fail(unit, `${file} says ${found.join('/')}, ${unit.name} is ${version}.${unit.fixHint ?? ''}`)
  }
  if (unit.follows) {
    const followed = UNITS.find(one => one.name === unit.follows)
    const theirs = versionIn(readNow(followed.versionFile))
    if (theirs !== version) note(`${unit.name} is ${version} while ${followed.name} is ${theirs}, and it ships ${followed.name}'s scripts.`)
  }
}
for (const entry of market.plugins) {
  if (!UNITS.some(unit => unit.market === entry.name)) error(`${MARKET} lists ${entry.name}, which dev/branch.mjs does not know: add it to UNITS.`)
}

// ---------------------------------------------------------------- --unreleased: what changed since each version moved

if (args.includes('--unreleased')) {
  for (const unit of UNITS) {
    const version = versionIn(readNow(unit.versionFile))
    // The oldest commit on this branch's own line (first parents: on main, the merges), walking back from HEAD, whose
    // version file still says the current version: where the version last moved.
    let since = null
    for (const commit of lines(git('log', '--first-parent', '--format=%H', '--', unit.versionFile))) {
      if (versionIn(readAt(commit, unit.versionFile)) !== version) break
      since = commit
    }
    if (!since) {
      console.log(`${unit.name} ${version}: no commit sets this version yet.`)
      continue
    }
    const shipped = lines(git('diff', '--name-only', since, 'HEAD')).filter(file => isShipped(unit, file))
    const when = git('log', '-1', '--format=%cs', since)
    console.log(shipped.length === 0
      ? `${unit.name} ${version} (since ${since.slice(0, 7)}, ${when}): nothing unreleased.`
      : `${unit.name} ${version} (since ${since.slice(0, 7)}, ${when}): ${shipped.length} shipped files changed without a new version: ${listed(shipped)}.`)
  }
  process.exit(errors > 0 ? 1 : 0)
}

// ---------------------------------------------------------------- a changed mod raises its version above the base's

const base = baseFrom(args, 'check-release.mjs')
const { files: changed } = changedSince(base)
console.log(`release check against ${base} (${git('rev-parse', '--short', base)}): ${changed.length} files changed on this branch.`)

// Where a unit stands on this branch: one of these, decided once.
const stateOf = (unit, now, then, shipped) => {
  const isRaised = then === null || (isVersion(then) && compare(now, then) > 0)
  if (now !== then && !isRaised) return 'lowered'
  if (isRaised) return 'raised'
  if (shipped.length === 0) return 'untouched'
  return (unit.copyRoots ?? []).length > 0 && shipped.every(file => unit.copyRoots.some(root => file.startsWith(root))) ? 'copies-only' : 'unreleased'
}

for (const unit of UNITS) {
  const now = versionIn(readNow(unit.versionFile))
  const then = versionIn(readAt(base, unit.versionFile))
  if (!isVersion(now)) continue
  const shipped = changed.filter(file => isShipped(unit, file))
  const state = stateOf(unit, now, then, shipped)
  if (state === 'untouched') continue
  if (state === 'lowered') fail(unit, `${unit.name}: ${now} is not above ${base}'s ${then}. Pick a version above it.`)
  else if (state === 'copies-only') note(`${unit.name}: only its copies changed (${listed(shipped)}), still at ${then}. No release needed: they ship with its next release.`)
  else if (state === 'unreleased') {
    const text = `${unit.name}: ${shipped.length} shipped files changed (${listed(shipped)}), but its version is still ${base}'s ${then}. Raise it (patch for a fix, minor for a feature) in ${[unit.versionFile, unit.market ? MARKET : null].filter(Boolean).join(' and ')}, and add a line under Changes in ${unit.readme}. A fix whose release comes in its own PR gets the release-later label.`
    if (args.includes('--allow-unreleased')) note(`${text} (release-later: not a failure)`)
    else fail(unit, text)
  } else if (!changesLine(readNow(unit.readme), now)) {
    fail(unit, `${unit.name} ${now}: ${unit.readme} has no "- **${now}** ..." line under Changes. Say in a sentence or two what the person sees or does differently.`)
  } else console.log(`ok ${unit.name} ${then ?? 'new'} -> ${now}${shipped.length > 0 ? `, ${shipped.length} shipped files changed` : ''}, Changes line found.`)
}

console.log(errors > 0 ? `release check: ${errors} to fix${notes > 0 ? `, ${notes} notes` : ''}.` : `release check: passed${notes > 0 ? ` with ${notes} notes` : ''}.`)
process.exit(errors > 0 ? 1 : 0)
