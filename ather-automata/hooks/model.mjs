// @ts-check
// Ather Automata: what the S2 workflow's files say. Intents, people, time, the
// Editor lock, the four stages and the one next step. Pure: no `$`.

export const ROLES = /** @type {const} */ (['engineer', 'techart', 'designer'])
export const ROLE_LABELS = { engineer: 'Engineer', techart: 'Tech artist', designer: 'Designer' }
export const OWNERS = 'Tin Nguyen, CanhNguyen and VuTruong'
const RUNG_LABELS = { build: 'a build that succeeded', automation: 'passing tests', readback: 'a read-back check', pie: 'a PIE proof', editor: 'your own Editor check' }
export const STAGE_LABELS = { plan: 'Plan', build: 'Build', prove: 'Prove', ship: 'Ship', shipped: 'Shipped' }

// The studio's intent areas (docs/intent/README.md#areas, decided 2026-10-03).
export const AREAS = ['Tools', 'Combat', 'AI', 'Enemies', 'Bosses', 'Characters & Animation', 'VFX', 'World & Levels', 'Audio', 'UI', 'Pipeline', 'Optimization']

// The issue an intent names: "#28887", "sipherxyz/S2#28887", a link ending "issues/28887", or "28887".
/** @param {string} text */
const issueNumber = text => {
  const match = /#(\d+)|issues\/(\d+)/.exec(text) ?? /^\s*(\d+)\s*$/.exec(text)
  return match ? Number(match[1] ?? match[2]) : null
}

/** @param {string} text @returns {(typeof ROLES)[number] | null} */
export const parseRole = text => {
  const words = text.toLowerCase()
  if (/design/.test(words)) return 'designer'
  if (/tech\s*-?\s*art/.test(words)) return 'techart'
  if (/engineer|programmer|coder|developer/.test(words)) return 'engineer'
  return null
}

/** @param {string} text */
export const normalizeArea = text => AREAS.find(area => area.toLowerCase() === text.trim().toLowerCase()) ?? 'Unsorted'

/** @param {string} name */
const personKey = name => name.toLowerCase().replace(/[^a-z0-9]/g, '')

// "Tin Nguyen" matches "TinNguyen"; "TienPham" matches "TienPhamProducerAther".
/** @param {string} a @param {string} b */
export const isSamePerson = (a, b) => {
  const x = personKey(a)
  const y = personKey(b)
  return x !== '' && y !== '' && (x.startsWith(y) || y.startsWith(x))
}

// "a", "a and b", "a, b and c".
/** @param {readonly string[]} items */
export const andList = items => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

/** @param {number} count @param {string} one @param {string} [many] */
export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

// The closest of a few command words to a typo ("tuor" → "tour"), or null.
/** @param {string} word @param {readonly string[]} words */
export const closestWord = (word, words) => {
  // Edits between two words, a swap of neighbours counting as one ("tuor" is one edit from "tour").
  const distance = (/** @type {string} */ a, /** @type {string} */ b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
    const at = (/** @type {number} */ i, /** @type {number} */ j) => d[i]?.[j] ?? 0
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost)
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1)
        const row = d[i]
        if (row) row[j] = best
      }
    }
    return at(a.length, b.length)
  }
  const ranked = words.map(candidate => ({ candidate, cost: distance(word.toLowerCase(), candidate) })).sort((x, y) => x.cost - y.cost)
  return ranked[0] && ranked[0].cost <= 1 && word.length >= 3 ? ranked[0].candidate : null
}

/** @param {string} me */
export const personId = me => personKey(me) || 'anyone'

// ---------------------------------------------------------------- text

/** @param {string} markdown */
const plainText = markdown =>
  markdown
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

// A row title: plain text, no "Found:" label, the first sentence, cut at a word.
/** @param {string} text @param {number} [max] */
export const shortTitle = (text, max = 80) => {
  const plain = plainText(text).replace(/^(found|finding|problem|issue|question|context|summary|note|observed)\s*:\s*/i, '')
  if (plain === '') return ''
  const capital = plain.charAt(0).toUpperCase() + plain.slice(1)
  const sentence = (/^(.+?[.?!])(\s|$)/.exec(capital)?.[1] ?? capital).replace(/\.$/, '')
  if (sentence.length <= max) return sentence
  const cut = sentence.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '')}…`
}

// ---------------------------------------------------------------- intents

/** @param {string} text @param {string} name */
const field = (text, name) => new RegExp(`^\\s*-\\s*${name}:\\s*(.+)$`, 'mi').exec(text)?.[1]?.trim() ?? ''

/** @param {string} text @param {string} heading */
const section = (text, heading) => {
  const start = new RegExp(`^##\\s+${heading}\\b.*$`, 'mi').exec(text)
  if (!start) return ''
  const rest = text.slice(start.index + start[0].length)
  const end = /^##\s+/m.exec(rest)
  return end ? rest.slice(0, end.index) : rest
}

const CLOSED = /\b(accepted|rejected|resolved|closed|superseded|withdrawn|answered)\b/i

// Open findings. Template heading: "## F-<n> (date, rev r) | blocking: yes|no | status: open (owner)".
/** @param {string} findings @param {string} prompt */
export const parseFindings = (findings, prompt) => {
  const decisions = section(prompt, 'Decisions')
  return findings
    .split(/^(?=##\s+F)/m)
    .filter(part => /^##\s+F[\w-]*\d/.test(part))
    .map(part => {
      const heading = /^##\s+(F[\w-]*)\s*(.*)$/m.exec(part)
      const id = heading?.[1] ?? 'F?'
      const rest = heading?.[2] ?? ''
      const body = part.slice((heading?.[0] ?? '').length)
      const headStatus = /status:\s*(\w+)(?:\s*\(([^)]*)\))?/i.exec(rest)
      const headBlocking = /blocking:\s*(yes|no)\b/i.exec(rest)
      const owner = headStatus?.[2]?.trim() ?? ''
      const statusLine = /^\s*[-*]?\s*\**(status|resolution)\**\s*:\s*(.+)$/im.exec(body)
      const isClosed = headStatus
        ? (headStatus[1] ?? '').toLowerCase() !== 'open'
        : CLOSED.test(rest) || (statusLine !== null && CLOSED.test(statusLine[2] ?? '')) || new RegExp(`\\b${id.replace(/-/g, '\\-')}\\b`).test(decisions)
      const isBlocking = headBlocking ? headBlocking[1]?.toLowerCase() === 'yes' : /blocking:\s*yes/i.test(part) || (/\bblocking\b/i.test(rest) && !/non-blocking/i.test(rest))
      const isDirectorCall = owner ? /director|producer|design|production|user/i.test(owner) : /\(a\)\s/.test(body) || /director|design lead|production call/i.test(body)
      const headTitle = shortTitle(rest.replace(/\|\s*(blocking|status):.*$/i, '').replace(/^\([^)]*\)\s*:?\s*/, '').replace(/^:\s*/, ''))
      const bodyTitle = shortTitle(body.trim().split('\n').find(line => line.trim() !== '' && !line.trim().startsWith('#')) ?? '')
      return { id, title: headTitle || bodyTitle || id, isBlocking, isDirectorCall, isOpen: !isClosed }
    })
    .filter(one => one.isOpen)
    .map(({ isOpen: _open, ...one }) => one)
}

/**
 * @typedef {{ slug: string, prompt: string, findings: string, progress: string, files: readonly string[], hasDebrief: boolean, mtimeMs: number }} IntentFiles
 * @typedef {ReturnType<typeof parseIntent>} Intent
 */

/** @param {IntentFiles} input */
export const parseIntent = input => {
  const { prompt, progress } = input
  // "parked: weather presets merged…" is a status too: take the leading word.
  const status = /^[a-z]+/.exec(field(prompt, 'Status').toLowerCase())?.[0] ?? 'unknown'
  const boxes = [...section(prompt, 'Acceptance').matchAll(/^\s*-\s*\[( |x|X)\]/gm)]
  return {
    slug: input.slug,
    title: /^#\s+(.+)$/m.exec(prompt)?.[1]?.trim() ?? input.slug,
    area: normalizeArea(field(prompt, 'Area')),
    owner: field(prompt, 'Owner'),
    issue: issueNumber(field(prompt, 'Issue')),
    status,
    acceptanceDone: boxes.filter(box => box[1] !== ' ').length,
    acceptanceTotal: boxes.length,
    findings: parseFindings(input.findings, prompt),
    hasReview: input.files.some(name => /review/i.test(name)) || /\b(plan|opus|design)[- ]review\b|reviewed by|after (an? )?(opus )?review/i.test(prompt + progress.slice(0, 20000)),
    hasWorker: /^\s*[-*]?\s*\**worker\**\s*[:=-]\s*\S/im.test(progress) || /^(###\s+S\d+|-\s+S\d+\b)/m.test(progress),
    hasDebrief: input.hasDebrief,
    mtimeMs: input.mtimeMs,
  }
}

/** @param {Intent | undefined} intent */
export const directorCalls = intent => (intent && intent.status !== 'completed' ? intent.findings.filter(one => one.isDirectorCall || one.isBlocking) : [])

/** @param {{ owner: string }} intent @param {string} me */
export const isMine = (intent, me) => me !== '' && isSamePerson(intent.owner, me)

// The open intents that are yours, the tracked one first.
/** @param {readonly Intent[]} intents @param {string} me @param {string | null} pinned */
export const ownedIntents = (intents, me, pinned) => {
  const mine = intents.filter(one => one.status !== 'completed' && isMine(one, me))
  return [...mine.filter(one => one.slug === pinned), ...mine.filter(one => one.slug !== pinned)]
}

// The Owner line of an intent's prompt.md.
/** @param {string} prompt */
export const intentOwner = prompt => field(prompt, 'Owner')

// Who to offer first when picking: yours, then your area, then open decisions, then the most recent.
/** @param {readonly Intent[]} intents @param {string} me @param {string} area */
export const pickCandidates = (intents, me, area) => {
  const rank = (/** @type {Intent} */ one) => (me !== '' && isSamePerson(one.owner, me) ? 0 : 4) + (area !== '' && one.area !== area ? 2 : 0) + (directorCalls(one).length > 0 ? 0 : 1)
  return intents.filter(one => one.status === 'active' || one.status === 'parked').sort((a, b) => rank(a) - rank(b) || b.mtimeMs - a.mtimeMs)
}

/** @param {readonly Intent[]} intents @param {string} text */
export const searchIntents = (intents, text) => {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3)
  return intents.filter(one => {
    const hay = `${one.slug} ${one.title} ${one.area} ${one.owner}`.toLowerCase().split(/[^a-z0-9]+/)
    return one.status !== 'completed' && words.length > 0 && words.every(word => hay.some(part => part.startsWith(word)))
  })
}

/** @param {Intent} one @param {string} me */
export const intentLabel = (one, me) => {
  const mine = isMine(one, me)
  const calls = mine ? directorCalls(one).length : 0
  const progress = one.acceptanceTotal > 0 ? `${one.acceptanceDone}/${one.acceptanceTotal}` : 'no checklist'
  return `${one.slug} · ${one.area} · ${progress}${calls > 0 ? ` · ${calls} need${calls === 1 ? 's' : ''} you` : ''}${!mine && one.owner ? ` · ${one.owner}` : ''}${one.status === 'parked' ? ' · parked' : ''}`
}

// ---------------------------------------------------------------- time and the Editor lock

/** @param {number} ms @param {number} tz */
export const localMinutes = (ms, tz) => {
  const local = new Date(ms + tz * 60000)
  return local.getUTCHours() * 60 + local.getUTCMinutes()
}

/** @param {number} ms @param {number} tz */
export const clockText = (ms, tz) => {
  const minutes = localMinutes(ms, tz)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** @param {number} ms */
export const durationText = ms => {
  const total = Math.max(0, Math.round(ms / 60000))
  return total >= 60 ? `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}m` : `${total}m`
}

/** @param {string} text */
export const parseTzOffset = text => {
  const match = /([+-])(\d{2}):?(\d{2})/.exec(text.trim())
  return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : null
}

// Evening by the person's clock: when "Heading off?" is offered unasked.
/** @param {number} ms @param {number} tz */
export const isEvening = (ms, tz) => {
  const hour = Math.floor(localMinutes(ms, tz) / 60)
  return hour >= 20 || hour < 5
}

/**
 * @typedef {{ state: 'free' | 'held' | 'unknown', holder: string, until: string, isStale: boolean, raw: string }} EditorLock
 * @param {string | null} raw @param {number} nowMinutes @returns {EditorLock}
 */
export const parseEditorLock = (raw, nowMinutes) => {
  const text = (raw ?? '').trim()
  if (text === '') return { state: 'unknown', holder: '', until: '', isStale: false, raw: text }
  const free = /free\s+since\s+(\d{1,2}:\d{2})/i.exec(text)
  if (free || /^free\b/i.test(text)) return { state: 'free', holder: '', until: free?.[1] ?? '', isStale: false, raw: text }
  const until = /until\s+(\d{1,2}:\d{2})/i.exec(text)?.[1] ?? ''
  const named = /(?:holder|owner)\s*[:=]\s*([^,;\n]+)|held by\s+([^,;\n]+)/i.exec(text)
  const holder = (named?.[1] ?? named?.[2] ?? text.split(/\r?\n/)[0] ?? '').replace(/\buntil\b.*$/i, '').trim()
  const end = /^(\d{1,2}):(\d{2})$/.exec(until)
  const endMinutes = end ? Number(end[1]) * 60 + Number(end[2]) : null
  const isStale = endMinutes !== null && nowMinutes - endMinutes > 30 && nowMinutes - endMinutes < 12 * 60
  return { state: 'held', holder: holder.slice(0, 60), until, isStale, raw: text }
}

// ---------------------------------------------------------------- stages and the next step

/** @typedef {{ state: 'none' | 'pass' | 'fail', detail: string }} Rung */
/** @typedef {Record<'build' | 'automation' | 'readback' | 'pie' | 'editor', Rung>} Evidence */

/** @returns {Evidence} */
export const emptyEvidence = () => ({
  build: { state: 'none', detail: '' },
  automation: { state: 'none', detail: '' },
  readback: { state: 'none', detail: '' },
  pie: { state: 'none', detail: '' },
  editor: { state: 'none', detail: '' },
})

/** @param {string} role @returns {Array<keyof Evidence>} */
const requiredRungs = role => (role === 'engineer' ? ['build', 'automation'] : role === 'techart' ? ['editor', 'pie'] : ['pie'])

/** @param {Intent | undefined} intent @param {Evidence} evidence @param {string} role @returns {keyof typeof STAGE_LABELS} */
export const currentStage = (intent, evidence, role) => {
  if (intent?.status === 'completed') return intent.hasDebrief ? 'shipped' : 'ship'
  if (!intent || intent.acceptanceTotal === 0) return 'plan'
  if (intent.acceptanceDone < intent.acceptanceTotal) return 'build'
  return isProven(evidence, role) ? 'ship' : 'prove'
}

// With no role set, any role's proof counts: a PIE proof, or a build that succeeded with passing tests.
/** @param {Evidence} evidence @param {string} role */
const isProven = (evidence, role) =>
  role === '' ? evidence.pie.state === 'pass' || (evidence.build.state === 'pass' && evidence.automation.state === 'pass') : requiredRungs(role).every(rung => evidence[rung].state === 'pass')

/**
 * The one next step for the tracked intent and the person's role.
 * @param {string} role @param {Intent | undefined} intent @param {Evidence} evidence @param {number} workers @param {string} me
 * @returns {{ key: string, label: string, prompt: string, hint: string, isDraft?: boolean } | undefined}
 */
export const nextStep = (role, intent, evidence, workers, me) => {
  if (!intent) return { key: 'start', label: 'Start an intent', prompt: '/intent ', hint: 'Type what you want after /intent; the intent skill takes it from there.', isDraft: true }
  const slug = intent.slug
  if (!isMine(intent, me)) {
    return { key: 'follow', label: 'See where it stands', hint: `${intent.owner || 'Its owner'}'s intent: a short summary, nothing is changed.`, prompt: `Explain intent ${slug} to me in under ten lines: what it is for, which stage it is in (Plan, Build, Prove, Ship) and why, which decisions are open and whose they are, and what the next step would be. Read docs/intent/${slug}/ only; change nothing.` }
  }
  const stage = currentStage(intent, evidence, role)
  if (stage === 'plan') {
    return { key: 'checklist', label: 'Write the "done" checklist', hint: 'The session drafts it and shows you before any work starts.', prompt: `Draft the acceptance checklist for intent ${slug} in docs/intent/${slug}/prompt.md: checkable items, each with the proof that will show it is done. Show it to me before the worker starts.` }
  }
  if (stage === 'build') {
    if (!intent.hasReview && !intent.hasWorker && intent.acceptanceDone === 0 && workers === 0) {
      return { key: 'review', label: 'Get the plan checked', hint: 'A second agent looks for gaps and wrong assumptions before anyone builds.', prompt: `Have an Opus agent review the plan for intent ${slug} (docs/intent/${slug}/prompt.md) against the repository before any worker starts: gaps, risks, wrong assumptions. Fold the accepted findings into the intent and show me what changed.` }
    }
    if (intent.hasWorker || workers > 0) {
      return { key: 'progress', label: 'See how the work is going', hint: 'A five-line status against the checklist.', prompt: `Summarise intent ${slug} against its checklist: what is done with evidence, what is next, what is blocked. Five lines.` }
    }
    const brief =
      role !== 'techart' && role !== 'designer'
        ? `Dispatch a background Opus worker for intent ${slug} using .agents/skills/intent/assets/worker-brief.md: exact paths, the acceptance checks it must prove, the shared-tree rule, no commits in the shared checkout.`
        : `Dispatch one background Opus worker for intent ${slug} as the only Editor MCP user: take the Editor owner lock first, read back every write, never save a package that does not compile, release the lock when done. Use .agents/skills/intent/assets/worker-brief.md.`
    return { key: 'brief', label: 'Start the work', hint: 'A background agent does the work, briefed the studio way for your role.', prompt: brief }
  }
  if (stage === 'prove') {
    const missing = role === '' ? ['a PIE proof, or a build that succeeded with passing tests'] : requiredRungs(role).filter(rung => evidence[rung].state !== 'pass').map(rung => RUNG_LABELS[rung])
    const prompt =
      role === '' || role === 'engineer'
        ? `Prove intent ${slug}: build S2Editor Development with the output written to a log file, report the build's own Result: line, then run the relevant automation tests and report the counts.`
        : role === 'techart'
          ? `Prove intent ${slug}: record a PIE proof with the map and capture path, and tell me which asset the change never touched to open in the Editor for my own check.`
          : `Prove intent ${slug} in PIE with the MainChar test simulation templates (.agents/skills/mainchar-test-simulation/SKILL.md) and record the proof path.`
    const own = role === 'techart' ? ' After your own Editor check, type /ather checked.' : ''
    return { key: 'prove', label: 'Prove it works', hint: `Still needed: ${missing.join(' and ')}. Ather reads this from tool output, not from what the session says.${own}`, prompt }
  }
  if (stage === 'ship' && intent.status === 'completed') {
    return {
      key: 'debrief',
      label: 'Write up what was learned',
      hint: 'What was proven, lost and decided, and rules worth keeping.',
      prompt: `Debrief intent ${slug}. List what was proven and with what evidence, what was lost or overwritten (lost optimisation vs broken feature), every decision taken on my behalf, and the gotchas we hit. Write it to Saved/AtherAutomata/debriefs/${slug}.md, and propose which recurring gotchas should become a skill or AGENTS.md rule for the owners (${OWNERS}).`,
    }
  }
  if (stage === 'ship') {
    const prompt =
      role === 'designer'
        ? `Summarise intent ${slug} for an owner to land: what changed, the evidence for each checklist item, and what is still owed.`
        : `Prepare intent ${slug} for landing: extract the change onto a clean branch in its own worktree, audit the diff and every binary asset for lost edits, open the PR from .github/pull_request_template.md, then wait for my go before merging.`
    return { key: 'land', label: 'Ship it', hint: role === 'designer' ? 'Summarises the work so an owner can land it.' : 'A clean PR; nothing merges without your go.', prompt }
  }
  return undefined
}
