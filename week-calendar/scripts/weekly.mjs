#!/usr/bin/env node
// The weekly job each agent PC runs (Windows Task Scheduler, Mondays early morning):
// build last week's report and publish it. Logs go to ~/.calendar/logs/.
//
// node weekly.mjs [--week-offset -1] [--dry-run]

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const cfg = loadConfig()
const offset = String(cfg.args['week-offset'] ?? '-1')
const extra = cfg.args['dry-run'] ? ['--dry-run'] : []
const logDir = path.join(cfg.outDir, 'logs')
fs.mkdirSync(logDir, { recursive: true })
const logFile = path.join(logDir, `weekly-${new Date().toISOString().slice(0, 10)}.log`)
const write = s => fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${s}\n`)

function step(script, args) {
  write(`run ${script} ${args.join(' ')}`)
  const r = spawnSync(process.execPath, [path.join(here, script), ...args], { encoding: 'utf8', maxBuffer: 64 << 20 })
  write(`exit ${r.status}\n${(r.stdout || '').slice(0, 4000)}${r.stderr ? `\nstderr: ${r.stderr.slice(0, 4000)}` : ''}`)
  return r.status === 0
}

const built = step('build-calendar.mjs', ['--export', '--week-offset', offset])
const published = built && step('publish-report.mjs', ['--week-offset', offset, ...extra])
write(built && published ? 'done' : 'failed')
process.exit(built && published ? 0 : 1)
