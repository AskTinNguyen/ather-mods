// Dev only: copies the Ather Automata modules a mod reuses (ather-automata/hooks) into <mod>/hooks/ather/, so the
// installed plugin carries them. They are the same code, byte for byte (line endings folded to LF). Never edit those
// copies by hand. Each mod names its entry modules in <mod>/shared.json ({ "entries": [...] }); everything they import,
// followed from their import lines and their JSDoc import() types, is copied with them, so the copy set is always whole.
//   node dev/sync-shared.mjs <mod>           copy them
//   node dev/sync-shared.mjs <mod> --check   fail if any copy differs (dev/test-all.mjs runs this for every mod with a shared.json)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mod = process.argv.slice(2).find(arg => !arg.startsWith('--'))
if (!mod) {
  console.error('usage: node dev/sync-shared.mjs <mod> [--check]')
  process.exit(2)
}
const from = path.join(root, 'ather-automata/hooks')
const to = path.join(root, mod, 'hooks/ather')
const { entries } = JSON.parse(fs.readFileSync(path.join(root, mod, 'shared.json'), 'utf8'))
const FILES = []
for (const queue = [...entries]; queue.length > 0; ) {
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
  console.error(`${mod} is out of step with ather-automata: ${drift.join(', ')}. Run node dev/sync-shared.mjs ${mod}.`)
  process.exit(1)
}
console.log(isCheck ? `${mod}: shared modules in step` : `${mod}: ${FILES.length} shared modules`)
