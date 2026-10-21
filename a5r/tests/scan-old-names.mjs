// A48: every file of the mod scanned for the feature's old names (tests/old-names.ts: the names and the exception
// list). The test runner has no file system, so this half runs with node; tests/old-names.test.ts checks the strings
// a5r builds at run time. Run from the repository root:
//   node --experimental-strip-types a5r/tests/scan-old-names.mjs
// A111 (rev 37): also no drive-letter path in hooks/, rules/ or an option default (tests/machine-paths.ts).
// Exit 0: no old name outside the exceptions and every exception still matches, and no such path; else each hit is
// printed, exit 1.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXCEPTIONS, oldNamesIn, uncovered } from './old-names.ts'
import { DECISION_EXCEPTIONS, decisionNamesIn } from './decision-names.ts'
import { REQUIRED_RULES_TEXT } from './rules-text.ts'
import { machinePathHits } from './machine-paths.ts'

const mod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skip = new Set(['.claude-plugin/types', 'node_modules'])
const files = []
const walk = dir => {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    const rel = path.relative(mod, p).split(path.sep).join('/')
    if (skip.has(rel)) continue
    if (d.isDirectory()) walk(p)
    else files.push(rel)
  }
}
walk(mod)

const hits = []
const used = new Set()
for (const rel of files) {
  const text = fs.readFileSync(path.join(mod, rel), 'utf8')
  for (const h of uncovered(text, rel)) hits.push(`${rel}: ${h.names.join(', ')}: ${h.line.trim().slice(0, 160)}`)
  for (const line of text.split(/\r?\n/))
    for (const name of oldNamesIn(line)) EXCEPTIONS.forEach((x, i) => x.file === rel && x.name === name && line.includes(x.line) && used.add(i))
}
const stale = EXCEPTIONS.filter((_, i) => !used.has(i)).map(x => `stale exception: ${x.file}: ${x.name}: ${x.line}`)
console.log(`scanned ${files.length} files: ${hits.length} old names outside the exceptions, ${used.size} of ${EXCEPTIONS.length} exceptions in use`)
for (const s of [...hits, ...stale]) console.log(s)

// A83 (rev 29): the decision convention's strings stand only in tests/, the A63 clean-up and the listed exceptions.
const dHits = []
const dUsed = new Set()
const outside = files.filter(rel => !rel.startsWith('tests/'))
for (const rel of outside) {
  for (const line of fs.readFileSync(path.join(mod, rel), 'utf8').split(/\r?\n/))
    for (const name of decisionNamesIn(line)) {
      const i = DECISION_EXCEPTIONS.findIndex(x => x.file === rel && x.name === name && line.includes(x.line))
      if (i >= 0) dUsed.add(i)
      else dHits.push(`${rel}: ${name}: ${line.trim().slice(0, 160)}`)
    }
}
const dStale = DECISION_EXCEPTIONS.filter((_, i) => !dUsed.has(i)).map(x => `stale exception: ${x.file}: ${x.name}: ${x.line}`)
console.log(`scanned ${outside.length} files outside tests/: ${dHits.length} decision-convention strings outside the exceptions, ${dUsed.size} of ${DECISION_EXCEPTIONS.length} exceptions in use`)
for (const s of [...dHits, ...dStale]) console.log(s)

// A90 (rev 32): the sentences the injected rules must carry are in the real files.
const missing = REQUIRED_RULES_TEXT.filter(r => !fs.readFileSync(path.join(mod, r.file), 'utf8').includes(r.text)).map(r => `missing rules text (${r.row}): ${r.file}: ${r.text.slice(0, 80)}`)
console.log(`checked ${REQUIRED_RULES_TEXT.length} required rules sentences: ${missing.length} missing`)
for (const s of missing) console.log(s)
// A111 (rev 37): no path of one machine in hooks/, rules/ or an option default (tests/machine-paths.ts: the rule).
const mHits = files.flatMap(rel => machinePathHits(rel, fs.readFileSync(path.join(mod, rel), 'utf8')))
console.log(`scanned hooks/, rules/ and the option defaults for drive-letter paths: ${mHits.length} outside a labelled example`)
for (const s of mHits) console.log(s)
process.exit(hits.length + stale.length + dHits.length + dStale.length + missing.length + mHits.length > 0 ? 1 : 0)
