// Dev only: copies the Ather Automata modules the board reads intents with (../ather-automata/hooks)
// into hooks/ather/, so the installed plugin carries them. They are the same code, byte for byte
// (line endings folded to LF). Never edit hooks/ather/ by hand.
//   node ather-board/sync.mjs           copy them
//   node ather-board/sync.mjs --check   fail if any copy differs (dev/test-all.mjs runs this)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const from = path.resolve(here, '../ather-automata/hooks')
const to = path.join(here, 'hooks/ather')
// The modules the board imports from Ather: the reader (team), the parsing (model, worklist), the overlap check and a
// collision's words and actions (overlap, collide), and the row look (rows). Copied with everything they import, followed from their import lines and their
// JSDoc import() types, so the copy set is always whole.
const ENTRIES = ['team.mjs', 'model.mjs', 'worklist.mjs', 'rows.mjs', 'overlap.mjs', 'collide.mjs']
const FILES = []
for (const queue = [...ENTRIES]; queue.length > 0; ) {
  const file = queue.shift()
  if (FILES.includes(file)) continue
  FILES.push(file)
  for (const [, spec] of fs.readFileSync(path.join(from, file), 'utf8').matchAll(/(?:from\s+|import\(\s*)'(\.{1,2}\/[^']+\.mjs)'/g)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)))
}
const isCheck = process.argv.includes('--check')

/** @param {string} file */
const lf = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

const drift = []
for (const file of FILES) {
  const text = lf(path.join(from, file))
  const target = path.join(to, file)
  if (fs.existsSync(target) && lf(target) === text) continue
  if (isCheck) drift.push(file)
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
    console.log(`synced ${file}`)
  }
}
// A module no longer reached is removed here too, in every folder the copies sit in.
for (const dir of new Set(['', ...FILES.map(file => path.posix.dirname(file)).filter(dir => dir !== '.')])) {
  for (const name of fs.existsSync(path.join(to, dir)) ? fs.readdirSync(path.join(to, dir)) : []) {
    const file = path.posix.join(dir, name)
    if (!name.endsWith('.mjs') || FILES.includes(file)) continue
    if (isCheck) drift.push(`${file} (no longer shared)`)
    else {
      fs.rmSync(path.join(to, file))
      console.log(`removed ${file}`)
    }
  }
}

if (isCheck && drift.length > 0) {
  console.error(`ather-board is out of step with ather-automata: ${drift.join(', ')}. Run node ather-board/sync.mjs.`)
  process.exit(1)
}
console.log(isCheck ? 'ather-board: shared modules in step' : `ather-board: ${FILES.length} shared modules`)
