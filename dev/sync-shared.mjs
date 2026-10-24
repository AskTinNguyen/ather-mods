// Dev only: copies the Ather Automata modules a mod reuses (ather-automata/hooks) into <mod>/hooks/ather/, so the
// installed plugin carries them. They are the same code, byte for byte (line endings folded to LF). Never edit those
// copies by hand. Each mod names its entry modules in <mod>/shared.json ({ "entries": [...] }); everything they import,
// followed from their import lines and their JSDoc import() types, is copied with them, so the copy set is always whole.
//   node dev/sync-shared.mjs <mod>           copy them
//   node dev/sync-shared.mjs <mod> --check   fail if any copy differs (dev/test-all.mjs runs this for every mod with a shared.json)
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './branch.mjs'
import { lf, mirror } from './mirror.mjs'

const mod = process.argv.slice(2).find(arg => !arg.startsWith('--'))
if (!mod) {
  console.error('usage: node dev/sync-shared.mjs <mod> [--check]')
  process.exit(2)
}
const from = path.join(ROOT, 'ather-automata/hooks')
const to = path.join(ROOT, mod, 'hooks/ather')
const { entries } = JSON.parse(fs.readFileSync(path.join(ROOT, mod, 'shared.json'), 'utf8'))
const FILES = []
for (const queue = [...entries]; queue.length > 0; ) {
  const file = queue.shift()
  if (FILES.includes(file)) continue
  FILES.push(file)
  for (const [, spec] of lf(path.join(from, file)).matchAll(/(?:from\s+|import\(\s*)'(\.{1,2}\/[^']+\.mjs)'/g)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)))
}
const isCheck = process.argv.includes('--check')

// A module no longer reached is removed here too.
const drift = mirror({ from, to, files: FILES, isCheck })
if (drift.length > 0) {
  console.error(`${mod} is out of step with ather-automata: ${drift.join(', ')}. Run node dev/sync-shared.mjs ${mod}.`)
  process.exit(1)
}
console.log(isCheck ? `${mod}: shared modules in step` : `${mod}: ${FILES.length} shared modules`)
