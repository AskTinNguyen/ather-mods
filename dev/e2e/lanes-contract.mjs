// Ather Lanes' contract with the S2 lane scripts (ather-lanes A6), on Windows: the real `lanes.ps1 -Action Status -Json`
// on a scratch repository with two worktrees (one registered, one not) and a scratch machine folder, read by Lanes'
// readers; the same lanes read from files alone as the closed pane reads them (D8: the sidecar Register wrote and the
// lanes folder's listing); and a real `editor-slot.ps1 -Action Take -Isolated` slot file and the pointer its Sync writes, read as A2 (i)
// says. Everything is written under the temp folder: the scripts are copied there first, every call names
// -MachineDir, and the slot is taken -Isolated. The scripts come from LANES_SCRIPTS, else S2_ROOT's
// .agents/skills/s2-agent-lanes/scripts; with neither, or off Windows, it is skipped and says so.
//   node dev/e2e/lanes-contract.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { parseEditorLock } from '../../ather-lanes/hooks/ather/packs/unreal.mjs'
import { laneRecords, NO_SOURCES, statusOfFiles } from '../../ather-lanes/hooks/records.mjs'
import { readSidecar, readSlot, readStatus } from '../../ather-lanes/hooks/sources.mjs'

const from = process.env.LANES_SCRIPTS || (process.env.S2_ROOT ? path.join(process.env.S2_ROOT, '.agents/skills/s2-agent-lanes/scripts') : '')
if (process.platform !== 'win32') {
  console.log('skipped: the lanes contract test runs on Windows only (lanes.ps1 is PowerShell)')
  process.exit(0)
}
if (!from || !fs.existsSync(path.join(from, 'lanes.ps1'))) {
  console.log(`skipped: the lanes contract test did not run. Set LANES_SCRIPTS to a folder with lanes.ps1${from ? ` (none in ${from})` : ''}`)
  process.exit(0)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-contract-'))
const skill = path.join(work, 'skill')
fs.cpSync(path.dirname(from), skill, { recursive: true, filter: source => !source.includes(`${path.sep}.git`) })
const scripts = path.join(skill, path.basename(from))
const main = path.join(work, 'game')
const lanes = path.join(work, 'lanes')
const machine = path.join(work, 'machine')
fs.mkdirSync(machine, { recursive: true })

const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', S2_MACHINE_DIR: '' }
/** @param {string[]} args @param {string} [cwd] */
const git = (args, cwd = main) => execFileSync('git', args, { cwd, env, encoding: 'utf8' })
/** @param {string} script @param {string[]} args */
const ps = (script, args) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, script), ...args], { cwd: work, env, encoding: 'utf8' })

let failures = 0
let checks = 0
/** @param {string} name @param {boolean} ok @param {unknown} [seen] */
const check = (name, ok, seen) => {
  checks++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(seen)}`}`)
  if (!ok) failures++
}


// Everything is made, run and read in the temp folder, which goes whatever happens.
try {
  fs.mkdirSync(main, { recursive: true })
  git(['init', '-q', '-b', 'main'])
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'one'])
  git(['worktree', 'add', '-q', '-b', 'feat/one', path.join(lanes, 'lane-one')])
  git(['worktree', 'add', '-q', '-b', 'feat/two', path.join(lanes, 'lane-two')])
  ps('lanes.ps1', ['-Action', 'Register', '-Name', 'lane-one', '-Path', path.join(lanes, 'lane-one'), '-Intent', 'demo-intent', '-Tier', 'T1', '-Slot', 'light', '-MachineDir', machine, '-Repo', main])

  const status = readStatus(ps('lanes.ps1', ['-Action', 'Status', '-Json', '-Repo', main, '-MachineDir', machine]))
  const byName = new Map((status?.lanes ?? []).map(one => [one.name, one]))
  check('Status -Json reads as Lanes reads it', status !== null, status)
  check('three worktrees: lane 0 and two lanes', status?.lanes.length === 3, status?.lanes.map(one => one.name))
  check('lane 0 is the main checkout', byName.get('game')?.kind === 'main checkout (lane 0)', byName.get('game'))
  const one = byName.get('lane-one')
  check('the registered lane: kind lane, sidecar registered', one?.kind === 'lane' && one?.sidecar === 'registered', one)
  check('the registered lane: branch feat/one, intent demo-intent, tier T1, slot need light', one?.branch === 'feat/one' && one?.intent === 'demo-intent' && one?.tier === 'T1' && one?.slotNeed === 'light', one)
  const two = byName.get('lane-two')
  check('an unregistered lane', two?.sidecar === 'unregistered' && two?.kind === 'lane', two)
  check('machineDir is the scratch folder', path.resolve(status?.machineDir ?? '') === path.resolve(machine), status?.machineDir)
  const records = laneRecords({ ...NO_SOURCES, status })
  check('each record keeps Status’ kind', records.every(record => record.kind === byName.get(record.name)?.kind), records.map(record => record.kind))

  // D8: what the closed pane reads instead of Status, before any Status run and after one.
  const sidecars = fs.readdirSync(path.join(machine, 'lanes')).map(name => readSidecar(fs.readFileSync(path.join(machine, 'lanes', name), 'utf8'))).filter(one => one !== null)
  const entries = fs.readdirSync(lanes).filter(name => fs.existsSync(path.join(lanes, name, '.git')))
  const fields = (/** @type {import('../../ather-lanes/hooks/sources.mjs').Status | null} */ one) => JSON.stringify((one?.lanes ?? []).map(lane => [lane.name, lane.kind, lane.sidecar, lane.intent, lane.tier, lane.slotNeed, path.resolve(lane.path).toLowerCase()]).sort())
  check('the sidecar Register wrote reads as Status reads it', sidecars.length === 1 && sidecars[0]?.name === 'lane-one' && sidecars[0]?.intent === 'demo-intent' && sidecars[0]?.slotNeed === 'light', sidecars)
  const fromFiles = statusOfFiles({ kept: null, main, lanesRoot: lanes, machineDir: machine, sidecars, entries })
  check('from files alone, before any Status: the same lanes, kinds and sidecars', fields(fromFiles) === fields(status), { fromFiles: fields(fromFiles), status: fields(status) })
  check('from files after a Status: the same, branches kept', fields(statusOfFiles({ kept: status, main, lanesRoot: lanes, machineDir: machine, sidecars, entries })) === fields(status) && statusOfFiles({ kept: status, main, lanesRoot: lanes, machineDir: machine, sidecars, entries }).lanes.every(lane => lane.branch === byName.get(lane.name)?.branch))

  ps('editor-slot.ps1', ['-Action', 'Take', '-Kind', 'full', '-Lane', 'lane-one', '-Minutes', '45', '-MachineDir', machine, '-Repo', main, '-Isolated'])
  const now = new Date()
  const minutes = now.getHours() * 60 + now.getMinutes()
  const slot = readSlot('full-1', fs.readFileSync(path.join(machine, 'slots/full-1.txt'), 'utf8'), minutes)
  const pointer = parseEditorLock(fs.readFileSync(path.join(machine, 'EDITOR_OWNER.txt'), 'utf8'), minutes)
  check('a real slot file: holder lane-one, kind full, time left', slot?.holder === 'lane-one' && slot?.kind === 'full' && (slot?.leftMinutes ?? 0) > 40, slot)
  check('A2 (i): holder and end equal parseEditorLock of the pointer Sync wrote', slot?.holder === pointer.holder && slot?.until === pointer.until, { slot, pointer })
  ps('editor-slot.ps1', ['-Action', 'Release', '-Lane', 'lane-one', '-MachineDir', machine, '-Repo', main, '-Isolated'])
  check('released: no slot file left', !fs.existsSync(path.join(machine, 'slots/full-1.txt')))
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
console.log(`${checks - failures}/${checks} passed`)
process.exitCode = failures ? 1 : 0
