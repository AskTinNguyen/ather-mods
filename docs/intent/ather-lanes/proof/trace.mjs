// A4's reading of one session's git trace (GIT_TRACE2_EVENT) and debug log (--debug-file), the parent's A2 method:
// every git process with its argv, start, end and ancestry; the mod's are Status' (a powershell.exe in its ancestry)
// and its one for-each-ref (the argv with Lanes' format). Checked: before the pane opened and while it was closed no
// process of the mod's; while it was open none of the mod's runs status, fetch, diff or merge-tree, no two of them
// overlap, and the PowerShell and gh spawns the debug log names are within A4's counts.
//   node trace.mjs <trace.json> <debug.log> <times.txt>
// times.txt: lines "<label> <ms> <clock>", with pane-open, pane-close and end (and any r-press) as the driver wrote them.
import fs from 'node:fs'

const [traceFile, debugFile, timesFile] = process.argv.slice(2)
if (!traceFile || !debugFile || !timesFile) {
  console.error('usage: node trace.mjs <trace.json> <debug.log> <times.txt>')
  process.exit(2)
}
const times = Object.fromEntries(fs.readFileSync(timesFile, 'utf8').trim().split(/\r?\n/).map(line => line.split(' ')).map(([label, ms]) => [label, Number(ms)]))
const presses = fs.readFileSync(timesFile, 'utf8').split(/\r?\n/).filter(line => line.startsWith('r-press')).length

/** @type {Map<string, { argv: string[], start: number, end: number, ancestry: string[] }>} */
const runs = new Map()
for (const line of fs.readFileSync(traceFile, 'utf8').split(/\r?\n/)) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    continue
  }
  const run = runs.get(event.sid) ?? { argv: [], start: 0, end: 0, ancestry: [] }
  const at = Date.parse(event.time)
  if (event.event === 'start') Object.assign(run, { argv: event.argv ?? [], start: at })
  if (event.event === 'cmd_ancestry') run.ancestry = event.ancestry ?? []
  if (event.event === 'exit' || event.event === 'atexit') run.end = Math.max(run.end, at)
  runs.set(event.sid, run)
}
// A child git (a sub-process of a git command, such as a hook or a helper) is counted under its top process.
const top = [...runs.entries()].filter(([sid]) => !sid.includes('/')).map(([, run]) => run)
const isStatus = (/** @type {{ ancestry: string[] }} */ run) => run.ancestry.some(name => /^powershell(\.exe)?$/i.test(name))
const isRefs = (/** @type {{ argv: string[] }} */ run) => run.argv.includes('for-each-ref') && run.argv.some(arg => arg.includes('%(ahead-behind:origin/main)'))
const mod = top.filter(run => isStatus(run) || isRefs(run)).sort((a, b) => a.start - b.start)
const inWindow = (/** @type {number} */ from, /** @type {number} */ to) => mod.filter(run => run.start >= from && run.start < to)
const before = inWindow(0, times['pane-open'] ?? 0)
const open = inWindow(times['pane-open'] ?? 0, times['pane-close'] ?? Infinity)
const closed = inWindow(times['pane-close'] ?? Infinity, Infinity)
const banned = open.filter(run => run.argv.some(arg => /^(status|fetch|diff|merge-tree)$/.test(arg)))
const overlaps = open.filter((run, index) => index > 0 && run.start < (open[index - 1]?.end ?? 0))
const statusRuns = new Set(open.filter(isStatus).map(run => Math.round(run.start / 2000)))

const spawns = fs.readFileSync(debugFile, 'utf8').split(/\r?\n/).filter(line => line.includes('Ather Lanes: spawn')).map(line => ({ at: Date.parse(line.slice(0, 24)), what: line.replace(/^.*Ather Lanes: spawn /, '') }))
const spawnsIn = (/** @type {number} */ from, /** @type {number} */ to) => spawns.filter(one => one.at >= from && one.at < to)
const openSpawns = spawnsIn(times['pane-open'] ?? 0, times['pane-close'] ?? Infinity)
const powershell = openSpawns.filter(one => one.what.startsWith('powershell')).length
const gh = openSpawns.filter(one => one.what.startsWith('gh')).length

const report = [
  `git processes in the trace: ${top.length}; the mod's: ${mod.length} (Status' ${mod.filter(isStatus).length}, for-each-ref ${mod.filter(isRefs).length})`,
  `before the pane opened: ${before.length} of the mod's git, ${spawnsIn(0, times['pane-open'] ?? 0).length} spawns`,
  `while open (${Math.round(((times['pane-close'] ?? 0) - (times['pane-open'] ?? 0)) / 60000)} min): ${open.length} git of the mod's; argv of each kind: ${[...new Set(open.map(run => run.argv.slice(1).filter(arg => !arg.startsWith('-')).slice(0, 2).join(' ')))].join(' | ')}`,
  `  status/fetch/diff/merge-tree among them: ${banned.length}; overlapping pairs: ${overlaps.length}; Status runs seen in git: ${statusRuns.size}`,
  `  spawns logged: powershell ${powershell} (at most ${6 + presses}), gh ${gh} (at most 3), git ${openSpawns.filter(one => one.what.startsWith('git')).length}`,
  `while closed (${Math.round(((times.end ?? 0) - (times['pane-close'] ?? 0)) / 60000)} min): ${closed.length} git of the mod's, ${spawnsIn(times['pane-close'] ?? Infinity, Infinity).length} spawns`,
]
const pass = before.length === 0 && spawnsIn(0, times['pane-open'] ?? 0).length === 0 && banned.length === 0 && overlaps.length === 0 && powershell <= 6 + presses && gh <= 3 && closed.length === 0 && spawnsIn(times['pane-close'] ?? Infinity, Infinity).length === 0 && open.length > 0
console.log([...report, pass ? 'A4: pass' : 'A4: FAIL'].join('\n'))
process.exitCode = pass ? 0 : 1
