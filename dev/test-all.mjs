// Type-check, then run the unit tests and the end-to-end harnesses against ../ather-automata (and the board's overlap check), and
// ather-board's unit tests (its copies of Ather's modules must match first).
// The mod is plain .mjs: nothing to compile. Run from anywhere: `node dev/test-all.mjs`.
// `--only <stage>` runs one stage: copies, paseo, type-check, unit, repos, board, lanes or s2 (CI runs paseo on its own).
// Type-checking needs the engine's API types (dev/typecheck.mjs says where it finds them); without them it is skipped and says so.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOD = path.resolve(HERE, '../ather-automata')
const BOARD = path.resolve(HERE, '../ather-board')
const LANES = path.resolve(HERE, '../ather-lanes')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-test-'))
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' })

// Copies a folder: .mjs files rewritten, everything else as it is, subfolders too (packs/, fixtures/).
const copy = (from, to, rewrite = s => s) => {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    if (entry.isDirectory()) copy(source, path.join(to, entry.name), rewrite)
    else if (entry.name.endsWith('.mjs')) fs.writeFileSync(path.join(to, entry.name), rewrite(fs.readFileSync(source, 'utf8')))
    else fs.copyFileSync(source, path.join(to, entry.name))
  }
}

// `node --test ather-automata/tests/*.test.mjs` resolves 'claude-code/testing' through this link.
const link = path.resolve(HERE, '../node_modules/claude-code')
fs.mkdirSync(link, { recursive: true })
fs.writeFileSync(path.join(link, 'package.json'), JSON.stringify({ name: 'claude-code', type: 'module', exports: { './testing': './testing.mjs' } }))
fs.writeFileSync(path.join(link, 'testing.mjs'), `export * from '${new URL('./shim/node-test.mjs', import.meta.url).href}'
`)

const NODE = `"${process.execPath}"`
const PASEO = path.resolve(HERE, '../paseo')
const e2e = path.join(HERE, 'e2e')

const STAGES = ['copies', 'paseo', 'type-check', 'unit', 'repos', 'board', 'lanes', 's2']
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
if (only !== null && !STAGES.includes(only)) {
  console.error(`--only takes one of ${STAGES.join(', ')}, not "${only}".`)
  process.exit(2)
}
/** @param {string} name @param {() => void} run */
const stage = (name, run) => {
  if (only !== null && only !== name) return
  console.log(`== ${name}`)
  run()
}

// The e2e helpers read the mod's hooks from dev/e2e/out/hooks.
fs.rmSync(path.join(e2e, 'out'), { recursive: true, force: true })
copy(path.join(MOD, 'hooks'), path.join(e2e, 'out/hooks'))

// Every copy matches its source: the Paseo versions' copies of the mods' shared code, the copies of Ather's modules
// in every mod that names them in its shared.json, and Claude Code's copies of the repository's skills.
stage('copies', () => {
  sh(`${NODE} server/sync.mjs --check`, path.join(PASEO, 'ather-automata'))
  sh(`${NODE} server/embed.mjs --check`, path.join(PASEO, 'week-calendar'))
  for (const mod of fs.readdirSync(path.resolve(HERE, '..')).filter(name => fs.existsSync(path.resolve(HERE, '..', name, 'shared.json')))) sh(`${NODE} sync-shared.mjs ${mod} --check`, HERE)
  sh(`${NODE} skills.mjs --check`, HERE)
})

// The Paseo versions type-check, and the Paseo plugin's server runs over a real checkout (dev/e2e/paseo.mts), once
// `npm install` has run in each (skipped, and said so, before that).
stage('paseo', () => {
  for (const plugin of ['ather-automata', 'week-calendar']) {
    const dir = path.join(PASEO, plugin)
    if (fs.existsSync(path.join(dir, 'node_modules/typescript'))) sh(`${NODE} node_modules/typescript/bin/tsc --noEmit`, dir)
    else console.log(`skipped: npm install in paseo/${plugin} to type-check it`)
  }
  const PASEO_ATHER = path.join(PASEO, 'ather-automata')
  if (!fs.existsSync(path.join(PASEO_ATHER, 'node_modules/@getpaseo'))) console.log('skipped: the Paseo e2e did not run. npm install in paseo/ather-automata to run it')
  else {
    sh(`node --no-warnings --import ./server/test-resolve.mjs --experimental-strip-types "${path.join(e2e, 'paseo.mts')}" "${path.join(WORK, 'paseo-report.md')}"`, PASEO_ATHER)
  }
})

stage('type-check', () => sh(`${NODE} typecheck.mjs`, HERE))

// A mod's unit tests in a folder of their own under WORK: its hooks and any other folders it reads
// (`also`), its tests with 'claude-code/testing' pointed at the shim, and one main.mjs that runs them all.
stage('unit', () => {
  const shim = path.join(HERE, 'shim/testing.mjs').replace(/\\/g, '/')
  const runUnit = (mod, name, also = []) => {
    const dir = path.join(WORK, name)
    for (const folder of ['hooks', ...also]) copy(path.join(mod, folder), path.join(dir, folder))
    copy(path.join(mod, 'tests'), path.join(dir, 'tests'), s => s.replace(/from 'claude-code\/testing'/g, `from 'file:///${shim.replace(/^\//, '')}'`))
    const tests = fs.readdirSync(path.join(mod, 'tests')).filter(f => f.endsWith('.test.mjs'))
    fs.writeFileSync(path.join(dir, 'main.mjs'), `${tests.map(f => `import './tests/${f}'`).join('\n')}\nimport { run } from 'file:///${shim.replace(/^\//, '')}'\nawait run()\n`)
    sh('node main.mjs', dir)
  }
  // This repository's own intents, where the tests look for them (../../docs/intent from tests/): tests/acceptance.test.mjs reads four.
  copy(path.resolve(HERE, '../docs/intent'), path.join(WORK, 'docs/intent'))
  runUnit(MOD, 'unit')
  // The board's hooks carry their copies of Ather's; its tests read its page too.
  runUnit(BOARD, 'board', ['page'])
  // Ather Lanes' readers, records and pane lines, on fixtures (tests/fixtures/).
  runUnit(LANES, 'lanes')
  // The dev tools' own tests (dev/*.test.mjs) run under node --test as they are.
  sh(`${NODE} --test ${fs.readdirSync(HERE).filter(f => f.endsWith('.test.mjs')).map(f => `"${path.join(HERE, f)}"`).join(' ')}`, HERE)
})

// Several real git checkouts under the temp folder: needs no S2 checkout.
stage('repos', () => {
  sh(`node repos.mjs "${path.join(WORK, 'checkouts-report.md')}"`, e2e)
})

// Ather Board's overlap check through the engine, on real git: needs no S2 checkout either.
stage('board', () => {
  sh(`node board.mjs "${path.join(WORK, 'board-report.md')}"`, e2e)
})

// Ather Lanes against the real S2 lane scripts, on Windows, when LANES_SCRIPTS or S2_ROOT names them (skipped, and
// said so, otherwise): Status' JSON and a real slot file read by Lanes' readers, all in the temp folder.
stage('lanes', () => sh('node lanes-contract.mjs', e2e))

// The S2 run copies an S2 checkout's docs/intent. Without S2_ROOT it is skipped and says so: this is for
// people who do not work on the game (web, tools) and have no S2 checkout on their PC. A S2_ROOT that is
// set but wrong still fails in run.mjs. A change to what an S2 session sees still needs one run with S2_ROOT.
stage('s2', () => {
  if (!process.env.S2_ROOT) console.log('skipped: the S2 e2e did not run. Set S2_ROOT to an S2 checkout to run it (not needed for non-game work)')
  else {
    // --layouts <dir> passes through: the e2e run writes every pane laid out at 72 and 110 columns there.
    const layouts = process.argv.includes('--layouts') ? path.resolve(process.argv[process.argv.indexOf('--layouts') + 1]) : null
    sh(`node run.mjs "${path.join(WORK, 'e2e-report.md')}"${layouts ? ` --layouts "${layouts}"` : ''}`, e2e)
    console.log(`report: ${path.join(WORK, 'e2e-report.md')}`)
  }
})
