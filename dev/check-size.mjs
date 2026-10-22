// Size ratchet. A source file may not cross 1,000 lines, and a file already over 1,000 may not grow: shrink it, or move
// the new code into a module of its own (AGENTS.md). Held: the code a mod ships, written by hand (dev/branch.mjs says
// which). Tests, dev/ and the generated copies are reported, not held. CI runs it on every pull request (pr-rules.yml).
//   node dev/check-size.mjs                  against origin/main (run `git fetch origin main` first)
//   node dev/check-size.mjs --base <ref>     against another branch
//   node dev/check-size.mjs --allow          report, do not fail: the owner accepted the growth (the size-accepted label)
//   node dev/check-size.mjs --report         no base: every file over 800 lines, largest first, held or not
import { baseFrom, changedSince, git, isCopy, lines, readAt, readNow, report, unitOf } from './branch.mjs'

const LIMIT = 1000
const CODE = /\.(mjs|cjs|js|ts|tsx)$/
const args = process.argv.slice(2)

/** @param {string | null} text */
const count = text => (text === null ? 0 : (text.match(/\n/g) ?? []).length + (text.length > 0 && !text.endsWith('\n') ? 1 : 0))
/** @param {string} file */
const isHeld = file => unitOf(file) !== null && !isCopy(file)

if (args.includes('--report')) {
  const rows = lines(git('ls-files')).filter(file => CODE.test(file)).map(file => ({ file, size: count(readNow(file)) })).filter(row => row.size > 800).sort((a, b) => b.size - a.size)
  for (const { file, size } of rows) console.log(`${String(size).padStart(6)}  ${file}${size > LIMIT ? (isHeld(file) ? '  (over 1,000: may not grow)' : '  (over 1,000, not held: tests, dev or generated)') : ''}`)
  process.exit(0)
}

const { mergeBase, files } = changedSince(baseFrom(args, 'check-size.mjs'))
const changed = files.filter(file => CODE.test(file))

let errors = 0
for (const file of changed) {
  const [then, now] = [count(readAt(mergeBase, file)), count(readNow(file))]
  if (now <= then || (then <= LIMIT && now <= LIMIT)) continue
  const text = then > LIMIT
    ? `${file} is over 1,000 lines and grew from ${then} to ${now}. Move the new code into a module of its own, or shrink the file by as much as you add.`
    : `${file} crossed 1,000 lines (${then} -> ${now}). Split it before it grows further.`
  if (!isHeld(file)) console.log(`note ${text} (not held: tests, dev or generated)`)
  else if (args.includes('--allow')) report('warning', `${text} (allowed here: --allow)`, file)
  else {
    errors++
    report('error', text, file)
  }
}
console.log(errors > 0 ? `size check: ${errors} file${errors > 1 ? 's' : ''} to fix (the owner can accept it with the size-accepted label).` : `size check: passed (${changed.length} code files changed).`)
process.exit(errors > 0 ? 1 : 0)
