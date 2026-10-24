// A4's reading of one session's git trace (GIT_TRACE2_EVENT) and debug log (--debug-file), the parent's A2 method:
// every git process with its argv, start, end and ancestry. The mod's are Status' (a powershell.exe in its ancestry;
// where git writes no cmd_ancestry event, as Git for Windows here did not, a git started within 10 s of a PowerShell
// spawn the mod logged) and its one for-each-ref (the argv with Lanes' format). Checked: before the pane opened and
// while it was closed no process of the mod's; while it was open none of the mod's runs status, fetch, diff or
// merge-tree, no two overlap, each Status run started exactly three git, and the PowerShell and gh spawns the debug
// log names are within A4's counts.
//   node trace.mjs <trace.json> <debug.log> <times.txt>
// times.txt: lines "<label> <ms> <clock>", with pane-open, pane-close and end (and any r-press) as the driver wrote them.
import fs from 'node:fs'

const [traceFile, debugFile, timesFile] = process.argv.slice(2)
if (!traceFile || !debugFile || !timesFile) {
  console.error('usage: node trace.mjs <trace.json> <debug.log> <times.txt>')
  process.exit(2)
}
const timeLines = fs.readFileSync(timesFile, 'utf8').trim().split(/\r?\n/).map(line => line.split(' '))
/** @param {string} label */
const timeOf = label => Number(timeLines.find(([name]) => name === label)?.[1] ?? NaN)
const opened = timeOf('pane-open')
const closed = timeOf('pane-close')
const ended = timeOf('end')
const presses = timeLines.filter(([name]) => name === 'r-press').length

/** @typedef {{ argv: string[], start: number, end: number, ancestry: string[] }} Run */
/** @type {Map<string, Run>} */
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
// A child git (a helper a git command started) is counted under its top process.
const top = [...runs.entries()].filter(([sid]) => !sid.includes('/')).map(([, run]) => run)

const spawns = fs.readFileSync(debugFile, 'utf8').split(/\r?\n/).filter(line => line.includes('Ather Lanes: spawn')).map(line => ({ at: Date.parse(line.slice(0, 24)), what: line.replace(/^.*Ather Lanes: spawn /, '') }))
const psAt = spawns.filter(one => one.what.startsWith('powershell')).map(one => one.at)
/** @param {number} from @param {number} to */
const spawnsIn = (from, to) => spawns.filter(one => one.at >= from && one.at < to)

/** @param {Run} run */
const isRefs = run => run.argv.includes('for-each-ref') && run.argv.some(arg => arg.includes('%(ahead-behind:origin/main)'))
/** @param {Run} run @param {number} [at] */
const isStatus = (run, at) =>
  !isRefs(run) && (run.ancestry.length > 0 ? run.ancestry.some(name => /^powershell(\.exe)?$/i.test(name)) : (at === undefined ? psAt : [at]).some(when => run.start >= when && run.start - when < 10000))
const mod = top.filter(run => isStatus(run) || isRefs(run)).sort((a, b) => a.start - b.start)
/** @param {number} from @param {number} to */
const modIn = (from, to) => mod.filter(run => run.start >= from && run.start < to)
// The words of a git command, without the -c settings and the -C folder the caller added.
/** @param {Run} run */
const words = run => run.argv.slice(1).filter((arg, index, all) => !['-c', '-C'].includes(arg) && !['-c', '-C'].includes(all[index - 1] ?? '')).join(' ')

const before = modIn(0, opened)
const open = modIn(opened, closed)
const after = modIn(closed, Infinity)
const banned = open.filter(run => run.argv.some(arg => /^(status|fetch|diff|merge-tree)$/.test(arg)))
const overlaps = open.filter((run, index) => index > 0 && run.start < (open[index - 1]?.end ?? 0))
const perStatus = psAt.filter(at => at >= opened && at < closed).map(at => top.filter(run => isStatus(run, at)).map(words))
const openSpawns = spawnsIn(opened, closed)
const powershell = openSpawns.filter(one => one.what.startsWith('powershell')).length
const gh = openSpawns.filter(one => one.what.startsWith('gh')).length

const checks = [
  ['no git of the mod’s and no spawn before the pane opened', before.length === 0 && spawnsIn(0, opened).length === 0],
  ['none of the mod’s git runs status, fetch, diff or merge-tree', banned.length === 0],
  ['no two of the mod’s git overlap', overlaps.length === 0],
  ['each Status run started exactly three git', perStatus.length > 0 && perStatus.every(list => list.length === 3)],
  [`PowerShell at most ${6 + presses} (6 plus one per r), gh at most 3`, powershell <= 6 + presses && gh <= 3],
  ['no git of the mod’s and no spawn while closed', after.length === 0 && spawnsIn(closed, Infinity).length === 0],
]
console.log(`git processes in the trace: ${top.length}; the mod's: ${mod.length} (Status' ${mod.filter(run => isStatus(run)).length}, for-each-ref ${mod.filter(isRefs).length})`)
console.log(`open ${Math.round((closed - opened) / 60000)} min, then closed ${Math.round((ended - closed) / 60000)} min; spawns while open: powershell ${powershell}, git ${openSpawns.filter(one => one.what.startsWith('git')).length}, gh ${gh}`)
console.log(`git per Status run: ${perStatus.map(list => list.length).join(', ')} (${[...new Set(perStatus.flat())].join(' | ')})`)
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
const pass = checks.every(([, ok]) => ok)
console.log(pass ? 'A4: pass' : 'A4: FAIL')
process.exitCode = pass ? 0 : 1
