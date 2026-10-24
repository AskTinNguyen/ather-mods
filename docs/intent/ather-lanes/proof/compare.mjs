// A3's live check: the lanes the opened fold lists in a screen capture of the pane, against lanes.ps1 -Action Status
// -Json run now, by name; the pool against Status' pool lanes by count. Prints both lists and exits 1 on a missing or
// extra row.
//   node compare.mjs <screen.txt> <lanes.ps1> <repo> [<machine dir>]
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const [screenFile, script, repo, machineDir] = process.argv.slice(2)
if (!screenFile || !script || !repo) {
  console.error('usage: node compare.mjs <screen.txt> <lanes.ps1> <repo> [<machine dir>]')
  process.exit(2)
}
const status = JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Status', '-Json', '-Repo', repo, ...(machineDir ? ['-MachineDir', machineDir] : [])], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).replace(/^﻿/, ''))
const screen = fs.readFileSync(screenFile, 'utf8')
// A fold row: "  ◆ game  …", "▾ ● lane-one  …", after the pane's left edge (│) when the pane is docked; a name cut to
// fit ends in "…".
const shown = [...screen.matchAll(/(?:^|│)\s*(?:▾ )?[◆●○] (\S+)/gmu)].map(match => match[1] ?? '')
const pool = /(?:^|│)\s+pool\s+(\d+) ready · (\d+) building/mu.exec(screen)
const lanes = status.lanes.filter((/** @type {any} */ one) => !String(one.kind).startsWith('pool ('))
const pools = status.lanes.length - lanes.length
const names = lanes.map((/** @type {any} */ one) => String(one.name))
const matches = (/** @type {string} */ name) => shown.some(row => row === name || (row.endsWith('…') && name.startsWith(row.slice(0, -1))))
const missing = names.filter(name => !matches(name))
const extra = shown.filter(row => !names.some(name => row === name || (row.endsWith('…') && name.startsWith(row.slice(0, -1)))))
const shownPools = pool ? Number(pool[1]) + Number(pool[2]) : 0
console.log(`Status: ${names.join(', ')} + ${pools} pool`)
console.log(`Pane:   ${shown.join(', ')} + ${shownPools} pool`)
console.log(missing.length === 0 && extra.length === 0 && shownPools === pools ? 'same lanes' : `differ: missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'}; pool ${shownPools} vs ${pools}`)
process.exitCode = missing.length === 0 && extra.length === 0 && shownPools === pools ? 0 : 1
