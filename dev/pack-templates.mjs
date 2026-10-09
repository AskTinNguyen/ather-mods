// Writes ather-automata/templates/intent-setup.zip from the folder beside it: the bundle that
// `/ather setup` hands a session. The same bytes on every machine: entries sorted, stored without
// compression, one fixed timestamp, line endings as committed. No dependency.
// `node dev/pack-templates.mjs` writes it; `--check` exits 1 when the committed zip is out of step.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FROM = path.resolve(HERE, '../ather-automata/templates/intent-setup')
const ZIP = `${FROM}.zip`
const isCheck = process.argv.includes('--check')

// Every file under the folder, as its zip name ("files/docs/intent/README.md").
/** @param {string} dir @returns {string[]} */
const walk = dir =>
  fs.readdirSync(path.join(FROM, dir), { withFileTypes: true }).flatMap(entry => {
    const name = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) return walk(name)
    return entry.name === '.DS_Store' ? [] : [name]
  })

const TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
/** @param {Buffer} bytes */
const crc32 = bytes => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// 1980-01-01 00:00, the earliest date the format holds.
const DOS_TIME = 0
const DOS_DATE = 0x21
// A regular file, rw-r--r--, written as from Unix so extracted files get ordinary permissions.
const MADE_BY = 0x031e
const MODE = (0o100644 << 16) >>> 0

/** @param {number[]} fields pairs of (size in bytes, value) */
const record = (...fields) => {
  const out = Buffer.alloc(fields.reduce((sum, size, index) => (index % 2 === 0 ? sum + size : sum), 0))
  let at = 0
  for (let index = 0; index < fields.length; index += 2) {
    if (fields[index] === 2) out.writeUInt16LE(fields[index + 1], at)
    else out.writeUInt32LE(fields[index + 1], at)
    at += fields[index]
  }
  return out
}

const build = () => {
  /** @type {Buffer[]} */
  const locals = []
  /** @type {Buffer[]} */
  const central = []
  let offset = 0
  // Sorted by code unit, not by locale, so the order is the same everywhere.
  for (const name of walk('').sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    // Line endings as committed, whatever the checkout's git settings did to them.
    const data = Buffer.from(fs.readFileSync(path.join(FROM, name), 'utf8').replace(/\r\n/g, '\n'), 'utf8')
    const file = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    // Flag 0x0800: the name is UTF-8.
    const local = Buffer.concat([record(4, 0x04034b50, 2, 10, 2, 0x0800, 2, 0, 2, DOS_TIME, 2, DOS_DATE, 4, crc, 4, data.length, 4, data.length, 2, file.length, 2, 0), file, data])
    central.push(Buffer.concat([record(4, 0x02014b50, 2, MADE_BY, 2, 10, 2, 0x0800, 2, 0, 2, DOS_TIME, 2, DOS_DATE, 4, crc, 4, data.length, 4, data.length, 2, file.length, 2, 0, 2, 0, 2, 0, 2, 0, 4, MODE, 4, offset), file]))
    locals.push(local)
    offset += local.length
  }
  const directory = Buffer.concat(central)
  return Buffer.concat([...locals, directory, record(4, 0x06054b50, 2, 0, 2, 0, 2, central.length, 2, central.length, 4, directory.length, 4, offset, 2, 0)])
}

const zip = build()
const current = fs.existsSync(ZIP) ? fs.readFileSync(ZIP) : null
if (current?.equals(zip)) console.log('templates: intent-setup.zip matches its folder')
else if (isCheck) {
  console.error('ather-automata/templates/intent-setup.zip is out of step with templates/intent-setup/: run `node dev/pack-templates.mjs`')
  process.exit(1)
} else {
  fs.writeFileSync(ZIP, zip)
  console.log(`wrote ${path.relative(path.resolve(HERE, '..'), ZIP)} (${zip.length} bytes)`)
}
