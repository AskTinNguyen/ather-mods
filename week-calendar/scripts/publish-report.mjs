#!/usr/bin/env node
// Publishes this machine's weekly report to the agent-reports repo:
// ~/.calendar/reports/<isoWeek>.json -> <clone>/reports/<isoWeek>/<machine>.json, secrets redacted,
// then commit and push (retrying with backoff, rebasing on a rejected push).
//
// node publish-report.mjs [--week-offset 0|-1] [--iso-week 2026-W40] [--dry-run] [--allow-any-repo]
//
// The clone lives at ~/.calendar/agent-reports unless reportsRepoPath says otherwise.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadConfig } from './lib/config.mjs'
import { redact } from './lib/secrets.mjs'
import { weekRange, isoWeekLabel } from './lib/util.mjs'

const cfg = loadConfig()
const dryRun = !!cfg.args['dry-run']
const isoWeek = cfg.args['iso-week'] || isoWeekLabel(weekRange(cfg.now, 'monday', cfg.weekOffset).start)
const source = path.join(cfg.outDir, 'reports', `${isoWeek}.json`)
const repoDir = cfg.reportsRepoPath
const machineFile = cfg.machine.replace(/[^A-Za-z0-9._-]+/g, '-')

const log = (...a) => process.stderr.write(a.join(' ') + '\n')
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...opts }).trim()
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function fail(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg, isoWeek }) + '\n')
  process.exit(1)
}

// The reports repo holds only reports. A code repo here (a wrong setting) would mean cloning it and
// pushing a report into it, so a URL whose repo name does not mention reports needs --allow-any-repo.
const repoName = String(cfg.reportsRepoUrl).replace(/[\\/]+$/, '').split(/[\\/:]/).pop().replace(/\.git$/, '')
if (!/report/i.test(repoName) && !cfg.args['allow-any-repo']) {
  fail(`Reports repo "${cfg.reportsRepoUrl}" does not look like an agent-reports repo. Set the plugin's Reports repo to the team's agent-reports repo (default https://github.com/AskTinNguyen/agent-reports.git), or pass --allow-any-repo.`)
}

if (!fs.existsSync(source)) fail(`No report for ${isoWeek} at ${source}. Run build-calendar.mjs --export first.`)

// ---------- clone or update ----------
function retry(what, fn) {
  let last
  for (const wait of [0, 2000, 4000, 8000, 16000]) {
    if (wait) { log(`${what} failed, retrying in ${wait / 1000}s`); sleep(wait) }
    try { return fn() } catch (err) { last = err }
  }
  throw last
}

try {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    fs.mkdirSync(path.dirname(repoDir), { recursive: true })
    retry('clone', () => git(['clone', '--quiet', cfg.reportsRepoUrl, repoDir]))
  } else {
    const hasUpstream = (() => { try { git(['-C', repoDir, 'rev-parse', '@{u}']); return true } catch { return false } })()
    if (hasUpstream) retry('pull', () => git(['-C', repoDir, 'pull', '--rebase', '--quiet']))
  }
} catch (err) {
  fail(`Could not clone or update ${cfg.reportsRepoUrl}: ${String(err.stderr || err.message).trim().split('\n').at(-1)}`)
}

// ---------- write the redacted report ----------
const report = JSON.parse(fs.readFileSync(source, 'utf8'))
const { value, counts } = redact(report)
value.redactions = counts
const rel = path.join('reports', isoWeek, `${machineFile}.json`)
const dest = path.join(repoDir, rel)
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, JSON.stringify(value, null, 2) + '\n')

const changed = git(['-C', repoDir, 'status', '--porcelain', '--', rel]).length > 0
if (!changed) {
  process.stdout.write(JSON.stringify({ ok: true, isoWeek, file: dest, changed: false, redactions: counts }) + '\n')
  process.exit(0)
}
git(['-C', repoDir, 'add', '--', rel])
git(['-C', repoDir, 'commit', '--quiet', '-m', `report: ${cfg.machine} ${isoWeek}`])

if (dryRun) {
  process.stdout.write(JSON.stringify({ ok: true, isoWeek, file: dest, changed: true, pushed: false, dryRun: true, redactions: counts }) + '\n')
  process.exit(0)
}

// ---------- push ----------
try {
  retry('push', () => {
    try {
      git(['-C', repoDir, 'push', '--quiet', '-u', 'origin', 'HEAD'])
    } catch (err) {
      if (/rejected|fetch first|non-fast-forward/i.test(String(err.stderr))) git(['-C', repoDir, 'pull', '--rebase', '--quiet'])
      throw err
    }
  })
} catch (err) {
  fail(`Push failed: ${String(err.stderr || err.message).trim().split('\n').at(-1)}`)
}
process.stdout.write(JSON.stringify({ ok: true, isoWeek, file: dest, changed: true, pushed: true, redactions: counts }) + '\n')
