#!/usr/bin/env node
// week-calendar: builds a self-contained HTML calendar of this week's Claude Code sessions and,
// with --export, the machine-week report the agent-reports repo collects.
//
// Reads ~/.claude/projects/**/*.jsonl (subagent logs included), runs git read commands and
// read-only `gh api` calls, and writes only under ~/.calendar/.
//
// node build-calendar.mjs [--theme dark|light] [--accent #hex] [--color-by project|task]
//                         [--week-start monday|sunday] [--week-offset 0|-1|...]
//                         [--list-untitled] [--export] [--no-github] [--no-auto-exclude]
//                         [--machine NAME] [--available-hours 168] [--ignore a,b] [--git-emails a,b]
//                         [--home DIR] [--projects-dir DIR] [--out-dir DIR] [--now ISO]
//
// Settings not given as flags come from ~/.calendar/config.json, which the plugin writes from
// its userConfig. Overrides: ~/.calendar/excluded.json { "exclude": [ids], "include": [ids] },
// session summaries: ~/.calendar/titles.json { "<sessionId>": "summary" },
// weekly survey: ~/.calendar/survey/<isoWeek>.json.
//
// Attribution: each git commit/rebase/merge/pull/cherry-pick/revert/am call a session (or its
// subagents) ran claims the commits made while that call ran; hashes printed by git are used
// when present. A session is productive when it pushed successfully or any of its commits is
// on GitHub. Outliers: a session of 4h+ where 80%+ of turns started by themselves (schedules,
// loops, plugin or SDK drivers) is excluded from totals and reports.

import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './lib/config.mjs'
import { readSessions } from './lib/logs.mjs'
import { createGit } from './lib/git.mjs'
import { createGitHub } from './lib/github.mjs'
import { analyze } from './lib/analyze.mjs'
import { buildColors, renderHtml } from './lib/render.mjs'
import { buildReport, readSurvey, snapshotCommits, writeSnapshot } from './lib/report.mjs'
import { weekRange, isoWeekLabel, DAY } from './lib/util.mjs'

const cfg = loadConfig()
const listUntitled = !!cfg.args['list-untitled']
const exporting = !!cfg.args.export
if (listUntitled) cfg.github = false

const display = weekRange(cfg.now, cfg.prefs.weekStart, cfg.weekOffset)
const iso = weekRange(cfg.now, 'monday', cfg.weekOffset)
const isoWeek = isoWeekLabel(iso.start)
const lookbackStart = Math.min(display.start, iso.start) - 28 * DAY

const readJson = (file, dflt) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return dflt } }
const overrides = readJson(cfg.excludeFile, {})
const savedTitles = readJson(cfg.titlesFile, {})
const survey = readSurvey(cfg, isoWeek)

const sessions = readSessions(cfg.projectsDir, lookbackStart)
const git = createGit()
const gh = createGitHub(cfg)
const common = { cfg, sessions, git, gh, lookbackStart, now: cfg.now, overrides, savedTitles, survey }
const snaps = snapshotCommits(cfg, isoWeek)

const shown = analyze({ ...common, range: display, snapshotCommits: snaps })

if (listUntitled) {
  const out = shown.sessions.filter(s => s.needsTitle).map(s => ({ sessionId: s.sessionId, firstMessage: s.firstMessage.slice(0, 500) }))
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  process.exit(0)
}

// ---------- calendar ----------
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const data = {
  generatedAt: new Date().toISOString(),
  timeZone: tz,
  machine: cfg.machine,
  week: { start: display.startDate, end: display.endDate, startMs: display.start, endMs: display.end, isoWeek: isoWeekLabel(display.start) },
  prefs: cfg.prefs,
  totalHours: shown.totalHours,
  totals: shown.totals,
  colorOf: buildColors(cfg.prefs, shown.totals, shown.blocks),
  blocks: shown.blocks,
  sessions: shown.sessions,
  machineHours: shown.machineHours,
  metrics: shown.metrics,
  prsMerged: shown.prsMerged,
  survey: { isoWeek, answered: !!survey.answeredAt, ...survey },
  noCommitSessions: shown.sessions.filter(s => s.noCommit && !s.excluded).sort((a, b) => b.end - a.end),
  excludedSessions: shown.sessions.filter(s => s.excluded).sort((a, b) => b.minutes - a.minutes),
}

fs.mkdirSync(cfg.outDir, { recursive: true })
const base = `week-${data.week.start}`
const jsonPath = path.join(cfg.outDir, `${base}.json`)
const htmlPath = path.join(cfg.outDir, `${base}.html`)
const html = renderHtml(data)
fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2))
fs.writeFileSync(htmlPath, html)
// latest.* is always the current week; a build of another week (the Monday job) leaves it alone.
if (cfg.weekOffset === 0) {
  fs.writeFileSync(path.join(cfg.outDir, 'latest.html'), html)
  fs.writeFileSync(path.join(cfg.outDir, 'latest.json'), JSON.stringify(data, null, 2))
}
// Remember the style given as flags, so unattended builds draw the same calendar.
if (['theme', 'accent', 'color-by', 'week-start'].some(k => cfg.args[k] !== undefined)) {
  fs.writeFileSync(path.join(cfg.outDir, 'prefs.json'), JSON.stringify({ theme: cfg.prefs.theme, accent: cfg.prefs.accent, colorBy: cfg.prefs.colorBy, weekStart: cfg.prefs.weekStart }, null, 2) + '\n')
}

// ---------- machine-week report (always the Monday-start ISO week) ----------
let reportPath = null
if (exporting) {
  const isoAnalysis = display.start === iso.start ? shown : analyze({ ...common, range: iso, snapshotCommits: snaps })
  const cliVersions = [...new Set([...sessions.values()].flatMap(s => [...s.versions]))].sort()
  const report = buildReport({ cfg, analysis: isoAnalysis, range: iso, isoWeek, survey, cliVersions, githubStats: gh.stats() })
  reportPath = writeSnapshot(cfg, isoWeek, report)
}
gh.save()

const m = shown.metrics, h = shown.machineHours
process.stdout.write(JSON.stringify({
  html: htmlPath,
  json: jsonPath,
  report: reportPath,
  isoWeek,
  week: data.week,
  timeZone: tz,
  machine: cfg.machine,
  prsMerged: shown.prsMerged.map(p => ({ repo: p.repo, number: p.number, title: p.title, mergedAt: p.mergedAt })),
  hours: { available: h.available, busy: h.busy, productive: h.productive, waitingOnPerson: h.waitingOnPerson, automated: h.automated, idle: h.idle },
  productiveUtilization: h.productiveUtilization,
  metrics: { costUsd: m.costUsd, noCommitRate: m.noCommitRate, typedPromptsPerBusyHour: m.typedPromptsPerBusyHour, commits: m.commits, commitsByAttribution: m.commitsByAttribution },
  sessionHours: +shown.totalHours.toFixed(2),
  projects: shown.totals.slice(0, 8).map(t => ({ project: t.project, hours: +t.hours.toFixed(2), sessions: t.sessions })),
  sessions: shown.sessions.length,
  untitled: shown.sessions.filter(s => s.needsTitle).length,
  excluded: data.excludedSessions.map(s => ({ sessionId: s.sessionId, title: s.title, project: s.project, minutes: s.minutes, reason: s.excludeReason })),
  noCommit: data.noCommitSessions.map(s => ({ sessionId: s.sessionId, title: s.title, project: s.project, minutes: s.minutes, end: new Date(s.end).toString() })),
  github: gh.stats(),
}, null, 2) + '\n')
