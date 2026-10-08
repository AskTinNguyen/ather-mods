// @ts-check
// Ather Automata: the GitHub issues assigned to the person, as things to work on.
// Read with `gh issue list --assignee @me`; Ather never writes to GitHub. Pure: no `$`.

import { durationText } from './model.mjs'

/**
 * @typedef {{ number: number, title: string, name: string, url: string, labels: string[], updatedAt: number, area: string, isUrgent: boolean,
 *   key?: string, root?: string, repo?: string, repoName?: string }} Issue
 * Read from one of several checkouts: `key` names it in the pane (its number in the session's own checkout,
 * `<repoName>#<number>` in another), `root` is the checkout it was read in, `repo` and `repoName` its repository.
 */

// An issue's id in the pane and in what was sent to the session.
/** @param {Issue} issue */
export const issueId = issue => `issue:${issue.key ?? issue.number}`

// The checkout an issue was read in when it is not the session's own, else ''.
/** @param {Issue} issue */
export const issueOtherRoot = issue => (issue.key !== undefined && issue.key !== String(issue.number) ? (issue.root ?? '') : '')

// Labels to studio areas (docs/intent/README.md#areas): the first label that names one wins.
const AREA_LABELS = [
  [/\bboss/i, 'Bosses'],
  [/\benem(y|ies)\b/i, 'Enemies'],
  [/\bcombat\b/i, 'Combat'],
  [/\bai\b|behavior.?tree/i, 'AI'],
  [/anim|character|locomotion|traversal/i, 'Characters & Animation'],
  [/\bvfx\b|niagara|effects?\b/i, 'VFX'],
  [/level|world|environment|map\b/i, 'World & Levels'],
  [/audio|sound|music/i, 'Audio'],
  [/\bui\b|\bux\b|hud|menu/i, 'UI'],
  [/perf|optimi[sz]/i, 'Optimization'],
  [/pipeline|build|\bci\b|jenkins/i, 'Pipeline'],
  [/tool|editor/i, 'Tools'],
]

/** @param {readonly string[]} labels */
export const areaFromLabels = labels => {
  for (const [pattern, area] of AREA_LABELS) if (labels.some(label => /** @type {RegExp} */ (pattern).test(label))) return /** @type {string} */ (area)
  return 'Unsorted'
}

// The words of a title, without its bracket tags or task prefix: "[QA][Steam][BVT]: Boss shield
// stays up" is "Boss shield stays up"; "task_S02_VFX_rain-particles-on-low-settings" is "Rain particles
// on low settings". The tags it drops are returned too, since they often name the area.
/** @param {string} title @returns {{ name: string, tags: string[] }} */
export const issueName = title => {
  const tags = [...title.matchAll(/\[([^\]]+)\]/g)].map(match => match[1])
  let name = title.replace(/\[[^\]]*\]/g, ' ').replace(/^[\s:\-–—]+/, '')
  const task = /^task_S\d+_((?:[A-Za-z]+_)*?)([a-z0-9][a-z0-9-]*)$/.exec(name.trim())
  if (task) {
    tags.push(...task[1].split('_').filter(Boolean))
    name = task[2].replace(/-/g, ' ')
  }
  name = name.replace(/\s+/g, ' ').trim()
  return { name: name ? name.charAt(0).toUpperCase() + name.slice(1) : title.trim(), tags }
}

// `gh issue list --json number,title,url,labels,updatedAt` output, most urgent then most recent first.
/** @param {string} json @returns {Issue[]} */
export const parseIssues = json => {
  /** @type {any[]} */
  let rows
  try {
    rows = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(rows)) return []
  return rows
    .filter(row => Number.isInteger(row?.number) && typeof row?.title === 'string')
    .map(row => {
      const labels = (Array.isArray(row.labels) ? row.labels : []).map((/** @type {any} */ label) => String(label?.name ?? label)).filter(Boolean)
      const { name, tags } = issueName(row.title)
      return {
        number: row.number,
        title: row.title.trim(),
        name,
        url: String(row.url ?? ''),
        labels,
        updatedAt: Date.parse(String(row.updatedAt ?? '')) || 0,
        // Labels first; without one, the title's own tags ("BOSS-ENE", "VFX") often say it.
        area: areaFromLabels(labels) === 'Unsorted' ? areaFromLabels(tags) : areaFromLabels(labels),
        isUrgent: labels.some(label => /priority:\s*(high|urgent|critical)|\bP0\b|\bP1\b|blocker/i.test(label)),
      }
    })
    .sort(issueOrder)
}

// Most urgent, then most recent first.
/** @param {Issue} a @param {Issue} b */
export const issueOrder = (a, b) => Number(b.isUrgent) - Number(a.isUrgent) || b.updatedAt - a.updatedAt

// "high priority · Combat · 3 months ago": what matters first, so a cut row keeps it.
/** @param {Issue} issue @param {number} now */
export const issueLabel = (issue, now) => {
  const age = now - issue.updatedAt
  const days = Math.floor(age / 86400000)
  const when = days >= 60 ? `${Math.floor(days / 30)} months ago` : days >= 2 ? `${days} days ago` : days === 1 ? 'yesterday' : durationText(age) === '0m' ? 'just now' : 'today'
  return [issue.isUrgent ? 'high priority' : '', issue.area === 'Unsorted' ? '' : issue.area, when].filter(Boolean).join(' · ')
}

// What the session is asked when the person picks an issue to work on.
/** @param {Issue} issue @param {string} me @param {string} [role] '' when the person has not said it @param {string} [roleWords] the pack's roles, in words */
export const issuePrompt = (issue, me, role = 'set', roleWords = 'designer, tech artist or engineer') =>
  [
    issueOtherRoot(issue) ? `The issue is in the checkout at ${issueOtherRoot(issue)}: run gh and its skills there, and create the intent under ${issueOtherRoot(issue)}/docs/intent.` : '',
    `Start an intent from GitHub issue #${issue.number} ("${issue.title}"${issue.url ? `, ${issue.url}` : ''}).`,
    `First run the issue preflight (.agents/skills/issue-preflight/SKILL.md) with --issue ${issue.number}; if it finds overlapping work, stop and tell me what it found.`,
    `Otherwise start the intent with the intent skill (.agents/skills/intent/SKILL.md): Owner: ${me || 'me'}, Area: ${issue.area === 'Unsorted' ? 'ask me' : issue.area}, and the header line "- Issue: #${issue.number}". Draft the goal and the done checklist from the issue (gh issue view ${issue.number}).`,
    'Show me prompt.md before anything is built. Do not comment on, assign or close the issue.',
    role === '' ? `Ather does not know my role yet: ask me (${roleWords}) and record it with the mcp__ather-automata__profile tool.` : '',
  ]
    .filter(Boolean)
    .join(' ')

// An issue's address, when it is one a Link may carry (https, printable ASCII); else none.
/** @param {string} url */
export function issueLink(url) {
  try {
    const href = new URL(url).href
    return href.startsWith('https://') && /^[\x21-\x7e]+$/.test(href) && href.length <= 2048 ? href : ''
  } catch {
    return ''
  }
}
