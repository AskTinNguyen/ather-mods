// The machine-week report (schema 1): what each PC pushes to the agent-reports repo, and the
// local snapshot that keeps history after Claude Code cleans up old session logs.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA = 1

export function pluginVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const p of [path.join(here, '..', '..', '.claude-plugin', 'plugin.json'), path.join(here, '..', 'version.json')]) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')).version } catch {}
  }
  return 'unknown'
}

export const reportsDir = cfg => path.join(cfg.outDir, 'reports')

export function readSurvey(cfg, isoWeek) {
  try { return JSON.parse(fs.readFileSync(path.join(cfg.outDir, 'survey', `${isoWeek}.json`), 'utf8')) } catch { return {} }
}

// Claimed commits from earlier weekly snapshots, so PRs that merge weeks later still get credited.
export function snapshotCommits(cfg, beforeIsoWeek, weeks = 4) {
  let files = []
  try { files = fs.readdirSync(reportsDir(cfg)).filter(f => /^\d{4}-W\d{2}\.json$/.test(f) && f.slice(0, 8) < beforeIsoWeek).sort().slice(-weeks) } catch {}
  const out = []
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(reportsDir(cfg), f), 'utf8'))
      for (const s of r.sessions || []) for (const c of s.commits || []) if (c.repo && /\//.test(c.repo)) out.push({ repo: c.repo, hash: c.hash, sessionId: s.sessionId })
    } catch {}
  }
  return out
}

export function buildReport({ cfg, analysis, range, isoWeek, survey, cliVersions, githubStats }) {
  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    machine: cfg.machine,
    operator: cfg.operator,
    pluginVersion: pluginVersion(),
    cliVersions,
    week: {
      isoWeek,
      startUtc: new Date(range.start).toISOString(),
      endUtc: new Date(range.end).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      complete: cfg.now.getTime() >= range.end,
    },
    availableHoursPerWeek: cfg.availableHoursPerWeek,
    hours: analysis.machineHours,
    metrics: analysis.metrics,
    prsMerged: analysis.prsMerged,
    prsOpen: analysis.prsOpen,
    projects: analysis.totals.map(t => ({ project: t.project, hours: +t.hours.toFixed(2), sessions: t.sessions })),
    sessions: analysis.sessions.map(s => ({
      ...s,
      blocks: analysis.blocks.filter(b => b.sessionId === s.sessionId).map(b => ({
        start: b.start, end: b.end, project: b.project, cwd: b.cwd, models: b.models, taskType: b.taskType,
        firstMessage: b.firstMessage, commits: b.commits.map(c => c.hash),
      })),
    })),
    survey: {
      rating: survey.rating ?? null,
      mostValuable: survey.mostValuable ?? null,
      mostWasted: survey.mostWasted ?? null,
      note: survey.note ?? null,
      answeredAt: survey.answeredAt ?? null,
    },
    settings: { ignoreFolders: cfg.ignoreFolders, autoExclude: cfg.autoExclude },
    github: githubStats,
  }
}

export function writeSnapshot(cfg, isoWeek, report) {
  const dir = reportsDir(cfg)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${isoWeek}.json`)
  fs.writeFileSync(file, JSON.stringify(report, null, 2))
  return file
}
