// Keeps a folder of copies in step with its source, file for file: what ather-board/sync.mjs,
// paseo/ather-automata/server/sync.mjs and dev/skills.mjs share. Each says which files to copy, how to change them on
// the way (or not), and which files in the copy folder are its own; this compares, writes and removes.
// Line endings are folded to LF on both sides, whatever the checkout's git settings did to them.
import fs from 'node:fs'
import path from 'node:path'

/** @param {string} file */
export const lf = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

/** Every file under a folder, as forward-slash paths relative to it. @param {string} dir @returns {string[]} */
export const filesIn = dir =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter(entry => entry.isFile()).map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    : []

/**
 * Copies `files` (forward-slash paths relative to `from`) into `to`, each through `transform`, and removes every other
 * file in `to` that `owns` claims (all of them, unless told otherwise), along with any folder a removal left empty.
 * With `isCheck` it changes nothing and returns what differs instead.
 * @param {{ from: string, to: string, files: string[], isCheck: boolean, transform?: (text: string) => string, owns?: (file: string) => boolean }} options
 * @returns {string[]} what differs (with isCheck), or nothing
 */
export const mirror = ({ from, to, files, isCheck, transform = text => text, owns = () => true }) => {
  const drift = []
  const wanted = new Set(files)
  const stale = filesIn(to).filter(file => !wanted.has(file) && owns(file))
  for (const file of files) {
    const text = transform(lf(path.join(from, file)))
    const target = path.join(to, file)
    if (fs.existsSync(target) && lf(target) === text) continue
    if (isCheck) drift.push(file)
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, text)
      console.log(`synced ${file}`)
    }
  }
  for (const file of stale) {
    if (isCheck) drift.push(`${file} (no source)`)
    else {
      fs.rmSync(path.join(to, file))
      console.log(`removed ${file}`)
      for (let dir = path.dirname(path.join(to, file)); dir.startsWith(to + path.sep) && fs.readdirSync(dir).length === 0; dir = path.dirname(dir)) fs.rmdirSync(dir)
    }
  }
  return drift
}
