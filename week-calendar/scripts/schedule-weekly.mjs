#!/usr/bin/env node
// Creates (or replaces) the weekly scheduled task on this PC: Mondays 06:00 local time, run
// ~/.calendar/bin/weekly.mjs, which builds last week's report and pushes it to agent-reports.
// Windows: Task Scheduler (current user, no admin rights). Elsewhere: prints a crontab line.
//
// node schedule-weekly.mjs [--time 06:00] [--remove]

import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseArgs } from './lib/config.mjs'

const args = parseArgs(process.argv.slice(2))
const NAME = 'week-calendar weekly report'
const time = /^\d{2}:\d{2}$/.test(args.time || '') ? args.time : '06:00'
const script = path.join(os.homedir(), '.calendar', 'bin', 'weekly.mjs')

if (process.platform !== 'win32') {
  const [hh, mm] = time.split(':')
  process.stdout.write(`Add this line with \`crontab -e\`:\n${Number(mm)} ${Number(hh)} * * 1 "${process.execPath}" "${script}"\n`)
  process.exit(0)
}

if (args.remove) {
  execFileSync('schtasks', ['/Delete', '/TN', NAME, '/F'], { stdio: 'inherit' })
  process.exit(0)
}

execFileSync('schtasks', [
  '/Create', '/F', '/TN', NAME, '/SC', 'WEEKLY', '/D', 'MON', '/ST', time,
  '/TR', `"${process.execPath}" "${script}"`,
], { stdio: 'inherit' })
process.stdout.write(`Scheduled "${NAME}": Mondays ${time}, ${script}\nRemove with: node schedule-weekly.mjs --remove\n`)
