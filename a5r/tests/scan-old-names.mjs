// A48: every file of the mod scanned for the feature's old names (tests/old-names.ts: the names and the exception
// list). The test runner has no file system, so this half runs with node; tests/old-names.test.ts checks the strings
// a5r builds at run time. Run from the repository root:
//   node --experimental-strip-types a5r/tests/scan-old-names.mjs
// Exit 0: no old name outside the exceptions and every exception still matches; else each hit is printed, exit 1.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXCEPTIONS, oldNamesIn, uncovered } from './old-names.ts'

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
process.exit(hits.length + stale.length > 0 ? 1 : 0)
