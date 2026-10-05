import type { Register } from 'claude-code'

const AGENT = 'week-calendar'
const AGENT_TYPE = `week-calendar:${AGENT}`

// "what did I do this week" / "write my weekly report" (and close variants)
export const REPORT_ASK = /\bwhat\s+did\s+i\s+(do|get\s+done|work\s+on)\s+this\s+week\b|\bwrite\s+(me\s+)?(up\s+)?my\s+weekly\s+report\b/i

// The scripts copied to ~/.calendar/bin, so the weekly scheduled task has a path that survives plugin updates.
const SCRIPT_FILES = [
  'build-calendar.mjs', 'publish-report.mjs', 'weekly.mjs', 'schedule-weekly.mjs',
  'lib/util.mjs', 'lib/config.mjs', 'lib/logs.mjs', 'lib/git.mjs', 'lib/github.mjs',
  'lib/analyze.mjs', 'lib/render.mjs', 'lib/report.mjs', 'lib/secrets.mjs',
]

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

// What the week-calendar agent may run: the calendar scripts and git reads, one plain command at a time.
export function bashVerdict(command: string): string | null {
  const cmd = command.trim()
  if (/[;&|><`]|\$\(/.test(cmd)) return 'week-calendar runs one plain command at a time: no pipes, redirects or chaining.'
  const isScript = /^node\s+("[^"]*(build-calendar|publish-report)\.mjs"|\S*(build-calendar|publish-report)\.mjs)(\s|$)/.test(cmd)
  const isGitRead = /^git(\s+-C\s+("[^"]*"|\S+))?\s+(log|show|rev-parse|status|diff|config\s+(--get\s+)?user\.(email|name))(\s|$)/.test(cmd)
  return isScript || isGitRead ? null : 'week-calendar may only run git read commands, build-calendar.mjs and publish-report.mjs.'
}

// Where the week-calendar agent may write: ~/.calendar and its own agent memory.
export function writeVerdict(filePath: string, home: string): string | null {
  const target = norm(filePath)
  const h = norm(home)
  const inCalendar = target.startsWith(`${h}/.calendar/`)
  const inMemory = target.startsWith(`${h}/.claude/agent-memory/`) && /week-calendar/.test(target)
  return !target.includes('/../') && (inCalendar || inMemory)
    ? null
    : `week-calendar may only write under ~/.calendar/ or its own agent memory, not ${filePath}`
}

function agentPrompt(scripts: string, home: string) {
  const build = `node "${scripts}/build-calendar.mjs"`
  const publish = `node "${scripts}/publish-report.mjs"`
  return `You are week-calendar. Your only job is the weekly calendar and weekly effectiveness report of the user's Claude Code sessions. You never do any other task.

## Tools and limits
- Bash: only to run the two scripts below and \`git\` read commands. One plain command per call: no redirects, pipes or chaining.
- You write files ONLY under ${home}/.calendar/ and in your own agent memory directory. Never anywhere else.
- The only data that leaves this PC is the weekly report the publish script pushes to the team's private agent-reports repo.

## Scripts
${build} --theme <dark|light> --accent <#rrggbb> --color-by <project|task> --week-start <monday|sunday> --export
- --list-untitled prints the sessions that have no title (sessionId + first typed message), without building.
- --week-offset -1 builds last week instead of this one.
- It reads ~/.claude/projects/**/*.jsonl (subagent logs too), converts times to local time, names projects by their git remote,
  makes one block per session (a new block after any gap over 30 minutes), credits each commit to the session whose git call made it,
  checks pushes and PRs merged (read-only gh api), and computes agent-busy, productive, waiting-on-a-person and idle hours.
  It writes ${home}/.calendar/latest.html and latest.json, and with --export the weekly snapshot ${home}/.calendar/reports/<isoWeek>.json.
  It prints a JSON summary that includes isoWeek.
- Outliers: a session that ran 4h+ where 80%+ of its turns started by themselves (scheduled tasks, loops, plugin or SDK drivers)
  is excluded from totals and reports automatically; it stays on the calendar, greyed out. So are routine runs: commitless sessions of
  3 minutes or less whose title recurs 5+ times in the week (butlers, schedulers) or in which nobody typed; the calendar draws them as
  ticks on each day's edge. Add --no-auto-exclude only when asked.
${publish} [--week-offset -1]
- Pushes ${home}/.calendar/reports/<isoWeek>.json (secrets redacted) to the agent-reports repo. Run it only when the request asks
  to publish, or after saving a survey.

## Preferences (memory)
Your preferences live in your agent memory directory as \`preferences.md\` with exactly these four lines:
theme: dark|light
accent: #rrggbb
color-by: project|task
week-start: monday|sunday

Every run, first read preferences.md from your memory directory.
- If it is missing or incomplete AND the request does not contain the answers, do nothing else and reply with exactly:
  NEEDS_PREFERENCES
  1. Style: dark or light?
  2. One accent color (name or hex)?
  3. Color blocks by project or by task type?
  4. Week starts on Monday or Sunday?
- If the request contains the answers, convert the color to a hex value, write preferences.md (and add a one-line pointer to it in MEMORY.md
  in your memory directory if that file exists or your memory instructions ask for one), then continue.
- Always follow the saved preferences; only change them when the request explicitly gives new ones.

## Excluding or including sessions
When the request asks to exclude (or include, count, put back) a session, find it in ${home}/.calendar/latest.json "sessions"
by title, first message, project or time. If more than one could match, list them and do nothing. Then edit
${home}/.calendar/excluded.json, { "exclude": [sessionIds], "include": [sessionIds] }: to exclude, add the id to exclude and drop it
from include; to include, the reverse (include also overrides the automatic outlier rule). Create the file if missing. Then rebuild.

## Saving the weekly survey
When the request gives survey answers, write ${home}/.calendar/survey/<isoWeek>.json (isoWeek from the request, else from the build output):
{ "rating": 1-5, "mostValuable": { "sessionId": "...", "title": "..." } or null, "mostWasted": { ... } or null,
  "noCommitReasons": { "<sessionId>": "blocked" | "exploratory" | "abandoned" | "parked" }, "note": "..." or null,
  "answeredAt": "<ISO time now>" }
Keep fields already in the file that the request does not change. Then rebuild with --export and run the publish script.

## Each run
1. Read preferences (above).
2. Run the build with --list-untitled and the preference flags. For each session listed, sum up its first typed message in 3 to 5 words
   (plain words, no quotes, no trailing period). Merge them into ${home}/.calendar/titles.json, a JSON object { "<sessionId>": "<summary>" },
   keeping the entries already there. Skip this step if the list is empty.
3. Run the build with the preference flags and --export.
4. Reply briefly: the HTML path, the isoWeek, PRs merged, productive time (percent), agent-busy / waiting / idle hours,
   hours per project (top 5), the no-commit sessions (title, project, end time) newest first, and any excluded sessions with their reason.
   The full data is in ${home}/.calendar/latest.json.`
}

export const register: Register = (on, options) => {
  // agentId -> whether that loop is a week-calendar agent
  const ours = new Map<string, boolean>()
  let home = ''

  on('session.start', async ($, e, next) => {
    home = ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/')
    const root = $.plugin.root.replace(/\\/g, '/')
    const bin = `${home}/.calendar/bin`

    // Settings for the scripts, from the plugin's userConfig; empty fields keep the scripts' defaults.
    const str = (k: string) => String(options[k] ?? '').trim()
    const config: Record<string, unknown> = {}
    if (str('machineName')) config.machineName = str('machineName')
    if (str('operator')) config.operator = str('operator')
    if (Number(options.availableHoursPerWeek) > 0) config.availableHoursPerWeek = Number(options.availableHoursPerWeek)
    if (str('reportsRepoUrl')) config.reportsRepoUrl = str('reportsRepoUrl')
    if (str('githubLogin')) config.githubLogin = str('githubLogin')
    if (str('ignoreFolders')) config.ignoreFolders = str('ignoreFolders').split(',').map(s => s.trim()).filter(Boolean)
    if (str('gitEmails')) config.gitEmails = str('gitEmails').split(',').map(s => s.trim()).filter(Boolean)
    try { await $.fs.write(`${home}/.calendar/config.json`, JSON.stringify(config, null, 2) + '\n') } catch {}

    // A stable copy of the scripts for the scheduled task.
    try {
      const manifest = JSON.parse(String(await $.fs.read(`${root}/.claude-plugin/plugin.json`)))
      for (const f of SCRIPT_FILES) {
        const src = String(await $.fs.read(`${root}/scripts/${f}`))
        const dest = `${bin}/${f}`
        let cur = ''
        try { cur = String(await $.fs.read(dest)) } catch {}
        if (cur !== src) await $.fs.write(dest, src)
      }
      await $.fs.write(`${bin}/version.json`, JSON.stringify({ version: manifest.version }) + '\n')
    } catch {}

    await $.agent.register({
      name: AGENT,
      description:
        "Builds the weekly calendar and effectiveness report of the user's Claude Code sessions (local HTML in ~/.calendar/; PRs merged, " +
        'productive agent time). Use it to (re)generate the calendar, before any weekly report, to exclude or include sessions ' +
        '(outliers such as automated polling sessions), to save weekly survey answers, and to publish the weekly report to the team repo. ' +
        'If it answers NEEDS_PREFERENCES, ask the user those four questions with AskUserQuestion, then run it again with the answers in the prompt.',
      prompt: agentPrompt(`${root}/scripts`, home),
      tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob'],
      memory: 'user',
    })
    return next(e)
  })

  // Keep the agent inside its lane.
  on('tool.call', async ($, e, next) => {
    if (!e.agentId) return next(e)
    if (!ours.has(e.agentId)) {
      const agents = await $.agent.list()
      const found = agents.find(a => a.id === e.agentId)
      if (!found) return next(e)
      ours.set(e.agentId, found.type === AGENT_TYPE || found.type === AGENT)
    }
    if (!ours.get(e.agentId)) return next(e)

    const input = e as unknown as Record<string, unknown>
    if (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'MultiEdit' || e.tool === 'NotebookEdit') {
      const deny = writeVerdict(String(input.file_path ?? input.notebook_path ?? ''), home)
      if (deny) return { deny }
    }
    if (e.tool === 'Bash') {
      const deny = bashVerdict(String(input.command ?? ''))
      if (deny) return { deny }
    }
    if (e.tool === 'PowerShell') return { deny: 'week-calendar runs its scripts through Bash only.' }
    return next(e)
  })

  // The weekly-report rule.
  on('prompt.submit', async ($, e, next) => {
    if (!REPORT_ASK.test(e.text)) return next(e)
    const rule = [
      'Weekly report rule (week-calendar plugin):',
      `1. First regenerate the calendar: call the Agent tool with subagent_type "${AGENT_TYPE}" and prompt "Regenerate this week's calendar."`,
      '   If it answers NEEDS_PREFERENCES, ask the user its four questions with AskUserQuestion (style dark/light, one accent color,',
      '   color by project or task type, week starts Monday or Sunday), then call it again with the answers in the prompt.',
      `2. Read ${home}/.calendar/latest.json (sessions, totals, metrics, machineHours, prsMerged, noCommitSessions, survey).`,
      '3. Reply with exactly 3 lines, then the calendar path on a 4th line:',
      '   Line 1: what the user mainly got done this week (from merged PR titles, session titles and commit subjects), with the number of PRs they authored',
      '   (metrics.prsAuthored; prsMerged entries with yours: true) and how many teammate PRs they contributed commits to.',
      '   Line 2: which project took the most time, with its hours (parallel sessions counted once, excluded sessions left out), and the productive time percent.',
      '   Line 3: which no-commit sessions to pick up first next week (most recent and longest first, by title).',
      '4. Unless latest.json survey.answered is true, run the weekly survey with AskUserQuestion, one call with three questions:',
      '   rating ("5 Excellent", "4 Good", "3 Okay", "1-2 Poor"); most valuable session (the three sessions with the most busyHours, by title);',
      '   most wasted session (up to three of the longest no-commit or excluded sessions that are not automated, plus "None"). If there are no-commit sessions, a second call',
      '   asks the reason for up to four of the longest: blocked, exploratory, abandoned or parked.',
      `   Then call the Agent tool with subagent_type "${AGENT_TYPE}": "Save the weekly survey for <survey.isoWeek>: <the answers as JSON with sessionIds>. Then rebuild and publish."`,
      '   If the user dismisses the survey, skip it without asking again in this conversation.',
    ].join('\n')
    return next({ ...e, context: [...(e.context ?? []), rule] })
  })
}
