// @ts-check
// Ather Automata: what the S2 workflow's files say. Intents, people, time, the
// Editor lock, the four stages and the one next step. Pure: no `$`.

import { unreal } from './packs/unreal.mjs'

// The Unreal pack's names, kept here for the modules and tests that read them from the model.
export { ROLES, ROLE_LABELS, OWNERS, AREAS, parseRole, parseEditorLock } from './packs/unreal.mjs'

/** @typedef {import('./packs/index.mjs').Pack} Pack */

export const STAGE_LABELS = { plan: 'Plan', build: 'Build', prove: 'Prove', ship: 'Ship', close: 'Ready to close', shipped: 'Shipped' }

// The issue an intent names: "#28887", "sipherxyz/S2#28887", a link ending "issues/28887", or "28887".
/** @param {string} text */
const issueNumber = text => {
  const match = /#(\d+)|issues\/(\d+)/.exec(text) ?? /^\s*(\d+)\s*$/.exec(text)
  return match ? Number(match[1] ?? match[2]) : null
}

/** @param {string} text @param {Pack} [pack] */
export const normalizeArea = (text, pack = unreal) => pack.normalizeArea(text)

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

// The same text whole, for a surface that wraps it: no label, every sentence, cut only past `max`.
/** @param {string} text @param {number} [max] */
export const fullTitle = (text, max = 400) => {
  const plain = plainText(text).replace(/^(found|finding|problem|issue|question|context|summary|note|observed)\s*:\s*/i, '').trim()
  const capital = plain.charAt(0).toUpperCase() + plain.slice(1)
  return capital.length <= max ? capital : `${capital.slice(0, max - 1)}…`
}

// ---------------------------------------------------------------- intents

/** @param {string} text @param {string} name */
const field = (text, name) => new RegExp(`^\\s*-\\s*${name}:\\s*(.+)$`, 'mi').exec(text)?.[1]?.trim() ?? ''

/** @param {string} text @param {string} heading */
export const section = (text, heading) => {
  const start = new RegExp(`^##\\s+${heading}\\b.*$`, 'mi').exec(text)
  if (!start) return ''
  const rest = text.slice(start.index + start[0].length)
  const end = /^##\s+/m.exec(rest)
  return end ? rest.slice(0, end.index) : rest
}

// Every section headed so, in order: "## Acceptance" and a later "## Acceptance, rev 2" both count.
/** @param {string} text @param {string} heading */
const sections = (text, heading) =>
  text
    .split(/^(?=##\s)/m)
    .filter(part => new RegExp(`^##\\s+${heading}\\b`, 'i').test(part))
    .map(part => part.replace(/^.*$/m, ''))
    .join('\n')

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
      const headFull = fullTitle(rest.replace(/\|\s*(blocking|status):.*$/i, '').replace(/^\([^)]*\)\s*:?\s*/, '').replace(/^:\s*/, ''))
      const bodyFull = fullTitle(body.trim().split('\n').find(line => line.trim() !== '' && !line.trim().startsWith('#')) ?? '')
      return { id, title: headTitle || bodyTitle || id, full: headFull || bodyFull || id, isBlocking, isDirectorCall, isOpen: !isClosed }
    })
    .filter(one => one.isOpen)
    .map(({ isOpen: _open, ...one }) => one)
}

// ---------------------------------------------------------------- acceptance and PRs
//
// One writer per fact (.agents/skills/intent/SKILL.md): prompt.md's Acceptance lists the items
// ("- A1: ..."), progress.md's Acceptance table says which are met, progress.md's "- PR:" line
// names the PRs. Intents from before that rule tick "- [x]" boxes in prompt.md instead.

// "A1", "B3", "SL15", "A12a": an acceptance id at the start of an item or a table cell.
const ITEM_ID = /^\**([A-Z]{1,3}[0-9]+[a-z]?)\**(?=[\s:.(]|$)/
// A verdict that counts as met: its leading word ("met on main", "Pass", "passed", "done", "✓", "✅").
const MET = /^(met|pass|passed|done|✓|✔|✅)(?![\p{L}\p{N}])/iu

// progress.md's Acceptance table as id → verdict, or null when it has none (or no rows yet).
// The verdict column is the one headed Verdict, Status or Result, else the second.
/** @param {string} progress */
const acceptanceVerdicts = progress => {
  const rows = section(progress, 'Acceptance')
    .split(/\r?\n/)
    .filter(line => /^\s*\|/.test(line))
    .map(line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => plainText(cell)))
  const header = rows[0]
  if (!header) return null
  const named = header.findIndex(cell => /^(verdict|status|result)$/i.test(cell))
  const column = named < 0 ? 1 : named
  /** @type {Map<string, string>} */
  const verdicts = new Map()
  for (const row of rows.slice(1)) {
    const id = ITEM_ID.exec(row[0] ?? '')?.[1]
    if (id) verdicts.set(id, row[column] ?? '')
  }
  return verdicts.size > 0 ? verdicts : null
}

/** @typedef {{ id: string, text: string, isDone: boolean }} AcceptanceItem `text` is what follows the id ('' id: a legacy box without one) */

// "A2 (owed): Sand look." → { id: 'A2', text: '(owed): Sand look.' }
/** @param {string} line */
const splitItem = line => {
  const match = ITEM_ID.exec(line)
  return { id: match?.[1] ?? '', text: match ? line.slice(match[0].length).trim() : line }
}

// The acceptance items and which are done. Ids come from prompt.md's top-level items; met-ness
// from progress.md's table, whose rows for ids prompt.md does not list are ignored. Without a
// table, legacy "- [x]" boxes count as before; without either, every listed item is open.
/** @param {string} prompt @param {string} progress @returns {AcceptanceItem[]} */
export const acceptanceItems = (prompt, progress) => {
  const lines = sections(prompt, 'Acceptance').split(/\r?\n/)
  /** @type {Map<string, string>} */
  const listed = new Map()
  for (const line of lines) {
    const item = splitItem(/^-\s+(?:\[[ xX]\]\s*)?(.+)$/.exec(line)?.[1] ?? '')
    if (item.id !== '' && !listed.has(item.id)) listed.set(item.id, item.text)
  }
  const verdicts = acceptanceVerdicts(progress)
  if (verdicts && listed.size > 0) return [...listed].map(([id, text]) => ({ id, text, isDone: MET.test(verdicts.get(id) ?? '') }))
  const boxes = lines.flatMap(line => {
    const box = /^\s*-\s*\[( |x|X)\]\s*(.*)$/.exec(line)
    return box ? [{ ...splitItem(box[2] ?? ''), isDone: box[1] !== ' ' }] : []
  })
  if (boxes.length > 0) return boxes
  return [...listed].map(([id, text]) => ({ id, text, isDone: false }))
}

// The text before a file's first "## " heading: where its "- Field:" lines live.
/** @param {string} text */
const headerOf = text => text.split(/^##\s/m)[0] ?? ''

// The PR numbers on progress.md's "- PR:" line, then any on a legacy prompt.md one.
// "- PR: #32372, #32398", "- PRs: sipherxyz/s2#1", "- PR: none yet".
/** @param {string} progress @param {string} prompt @returns {number[]} */
export const intentPrs = (progress, prompt) => {
  const numbers = [progress, prompt].flatMap(text =>
    [...headerOf(text).matchAll(/^\s*-\s*PRs?\s*:\s*(.+)$/gim)].flatMap(line => [...(line[1] ?? '').matchAll(/#(\d+)|pull\/(\d+)/g)].map(match => Number(match[1] ?? match[2]))),
  )
  return [...new Set(numbers)]
}

/**
 * @typedef {'MERGED' | 'OPEN' | 'CLOSED' | 'UNREAD'} PrState what gh last said about a PR; UNREAD when it could not say
 * @typedef {Readonly<Record<string, PrState>>} PrStates PR number → its last read state
 */

// Open, with a checklist whose every item is met: the only intents whose PRs decide anything.
/** @param {Intent} intent */
export const isAllMet = intent => intent.status !== 'completed' && intent.acceptanceTotal > 0 && intent.acceptanceDone === intent.acceptanceTotal

// Every item met and every named PR merged, yet not closed: the orchestrator's Close step is owed.
// An intent with no PR named is not ready: nothing says the work has landed.
/** @param {Intent} intent @param {PrStates} prs */
export const isReadyToClose = (intent, prs) => isAllMet(intent) && intent.prs.length > 0 && intent.prs.every(number => prs[number] === 'MERGED')

// "#32372 MERGED", "#32398 not read yet": each PR the intent names, with what gh last said.
/** @param {Intent} intent @param {PrStates} prs */
export const prStatusList = (intent, prs) => intent.prs.map(number => `#${number} ${prs[number] === 'UNREAD' ? 'could not be read' : (prs[number] ?? 'not read yet')}`)

/**
 * @typedef {{ slug: string, prompt: string, findings: string, progress: string, files: readonly string[], hasDebrief: boolean, updatedAt: number, source: 'main' | 'local', firstAuthor: string }} IntentFiles
 * `updatedAt`: when it last changed (its last commit on main, or its files'); `source`: where it was read; `firstAuthor`: who first committed its folder
 * @typedef {ReturnType<typeof parseIntent>} Intent
 */

/** @param {IntentFiles} input @param {Pack} [pack] */
export const parseIntent = (input, pack = unreal) => {
  const { prompt, progress } = input
  // "parked: weather presets merged…" is a status too: take the leading word.
  const status = /^[a-z]+/.exec(field(prompt, 'Status').toLowerCase())?.[0] ?? 'unknown'
  const items = acceptanceItems(prompt, progress)
  return {
    slug: input.slug,
    title: /^#\s+(.+)$/m.exec(prompt)?.[1]?.trim() ?? input.slug,
    goal: shortTitle(/^(.+?[.!?])(\s|$)/.exec(section(prompt, 'Goal').replace(/\s+/g, ' ').trim())?.[1] ?? section(prompt, 'Goal').replace(/\s+/g, ' ').trim(), 110),
    area: normalizeArea(field(prompt, 'Area'), pack),
    owner: field(prompt, 'Owner'),
    issue: issueNumber(field(prompt, 'Issue')),
    status,
    // Why it is parked (or blocked): what follows the status word.
    statusNote: field(prompt, 'Status').replace(/^[a-z]+\s*[:\-–—]?\s*/i, '').trim(),
    acceptanceDone: items.filter(item => item.isDone).length,
    acceptanceTotal: items.length,
    prs: intentPrs(progress, prompt),
    findings: parseFindings(input.findings, prompt),
    hasReview: input.files.some(name => /review/i.test(name)) || /\b(plan|opus|design)[- ]review\b|reviewed by|after (an? )?(opus )?review/i.test(prompt + progress.slice(0, 20000)),
    hasWorker: /^\s*[-*]?\s*\**worker\**\s*[:=-]\s*\S/im.test(progress) || /^(###\s+S\d+|-\s+S\d+\b)/m.test(progress),
    hasDebrief: input.hasDebrief,
    updatedAt: input.updatedAt,
    source: input.source,
    firstAuthor: input.firstAuthor,
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
  return intents.filter(one => one.status === 'active' || one.status === 'parked').sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
}

/** @param {readonly Intent[]} intents @param {string} text */
export const searchIntents = (intents, text) => {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3)
  return intents.filter(one => {
    const hay = `${one.slug} ${one.title} ${one.area} ${one.owner}`.toLowerCase().split(/[^a-z0-9]+/)
    return one.status !== 'completed' && words.length > 0 && words.every(word => hay.some(part => part.startsWith(word)))
  })
}

/** @param {Intent} one @param {string} me @param {PrStates} [prs] */
export const intentLabel = (one, me, prs = {}) => {
  const mine = isMine(one, me)
  const calls = mine ? directorCalls(one).length : 0
  const progress = one.acceptanceTotal > 0 ? `${one.acceptanceDone}/${one.acceptanceTotal}${isReadyToClose(one, prs) ? ' · ready to close' : ''}` : 'no checklist'
  return `${one.slug} · ${one.area} · ${progress}${calls > 0 ? ` · ${calls} need${calls === 1 ? 's' : ''} you` : ''}${!mine && one.owner ? ` · ${one.owner}` : ''}${one.status === 'parked' ? ` · parked${one.statusNote ? `: ${shortTitle(one.statusNote, 90)}` : ''}` : ''}`
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

/** @typedef {import('./packs/unreal.mjs').EditorLock} EditorLock */

// A session's name from Claude Code's record of it (the lines a grep for its titles found):
// the last title the person or the session set, else the last one Claude Code generated.
/** @param {string} lines @returns {string} */
export const sessionTitle = lines => {
  const rows = lines.split(/\r?\n/)
  /** @param {string} kind */
  const last = kind => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const found = new RegExp(`"${kind}":"([^"]*)"`).exec(rows[index] ?? '')
      if (found) return found[1] ?? ''
    }
    return ''
  }
  const raw = last('customTitle') || last('aiTitle')
  let title = raw
  try {
    title = JSON.parse(`"${raw}"`)
  } catch {
    // an escape grep cut in half: the raw text is close enough
  }
  return title.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 60)
}

// ---------------------------------------------------------------- stages and the next step

/** @typedef {import('./packs/index.mjs').Rung} Rung */
/** @typedef {Record<string, Rung>} Evidence the pack's rungs; the Unreal pack's are build, automation, readback, pie and editor */

/** @param {Pack} [pack] @returns {Evidence} */
export const emptyEvidence = (pack = unreal) => pack.emptyEvidence()

// A Status of completed wins; then every item met with every PR merged is ready to close, whatever proof this session saw.
/** @param {Intent | undefined} intent @param {Evidence} evidence @param {string} role @param {PrStates} [prs] @param {Pack} [pack] @returns {keyof typeof STAGE_LABELS} */
export const currentStage = (intent, evidence, role, prs = {}, pack = unreal) => {
  if (intent?.status === 'completed') return intent.hasDebrief ? 'shipped' : 'ship'
  if (!intent || intent.acceptanceTotal === 0) return 'plan'
  if (isReadyToClose(intent, prs)) return 'close'
  if (intent.acceptanceDone < intent.acceptanceTotal) return 'build'
  return pack.isProven(evidence, role) ? 'ship' : 'prove'
}

/**
 * The one next step for the tracked intent and the person's role.
 * @param {string} role @param {Intent | undefined} intent @param {Evidence} evidence @param {number} workers @param {string} me @param {PrStates} [prs] @param {Pack} [pack]
 * @returns {{ key: string, label: string, prompt: string, hint: string, isDraft?: boolean } | undefined}
 */
export const nextStep = (role, intent, evidence, workers, me, prs = {}, pack = unreal) => {
  if (!intent) return { key: 'start', label: 'Start an intent', prompt: '/intent ', hint: 'Type what you want after /intent; the intent skill takes it from there.', isDraft: true }
  const slug = intent.slug
  if (!isMine(intent, me)) {
    return { key: 'follow', label: 'See where it stands', hint: `${intent.owner || 'Its owner'}'s intent: a short summary, nothing is changed.`, prompt: `Explain intent ${slug} to me in under ten lines: what it is for, which stage it is in (Plan, Build, Prove, Ship) and why, which decisions are open and whose they are, and what the next step would be. Read docs/intent/${slug}/ only; change nothing.` }
  }
  const stage = currentStage(intent, evidence, role, prs, pack)
  if (stage === 'close') {
    const named = andList(intent.prs.map(number => `#${number}`))
    return {
      key: 'close',
      label: 'Close the intent',
      hint: `Every item is met and ${intent.prs.length === 1 ? `PR ${named} is` : `PRs ${named} are`} merged; the session closes it the intent skill's way.`,
      prompt: `Close intent ${slug} as step 5 (Close) of .agents/skills/intent/SKILL.md says. Ather reads every acceptance row in docs/intent/${slug}/progress.md as met and ${intent.prs.length === 1 ? `PR ${named} as` : `PRs ${named} as`} merged: confirm both from the files and gh first, and stop and tell me if either is not so. Then set Status: completed in prompt.md, add the changelog line, and commit as the skill says.`,
    }
  }
  if (stage === 'plan') {
    return { key: 'checklist', label: 'Write the "done" checklist', hint: 'The session drafts it and shows you before any work starts.', prompt: `Draft the acceptance checklist for intent ${slug} in docs/intent/${slug}/prompt.md: items with ids (A1, A2, ...), each with the proof that will show it is done, and no checkboxes (whether an item is met lives in progress.md). Show it to me before the worker starts.` }
  }
  if (stage === 'build') {
    if (!intent.hasReview && !intent.hasWorker && intent.acceptanceDone === 0 && workers === 0) {
      return { key: 'review', label: 'Get the plan checked', hint: 'A second agent looks for gaps and wrong assumptions before anyone builds.', prompt: `Have an Opus agent review the plan for intent ${slug} (docs/intent/${slug}/prompt.md) against the repository before any worker starts: gaps, risks, wrong assumptions. Fold the accepted findings into the intent and show me what changed.` }
    }
    if (intent.hasWorker || workers > 0) {
      return { key: 'progress', label: 'See how the work is going', hint: 'A five-line status against the checklist.', prompt: `Summarise intent ${slug} against its checklist: what is done with evidence, what is next, what is blocked. Five lines.` }
    }
    return { key: 'brief', label: 'Start the work', hint: pack.prompts.briefHint, prompt: pack.prompts.brief(role, slug) }
  }
  if (stage === 'prove') {
    const missing = role === '' ? [pack.anyProofText] : pack.requiredRungs(role).filter(rung => evidence[rung]?.state !== 'pass').map(rung => pack.rungLabels[rung] ?? rung)
    const prompt = pack.prompts.prove(role, slug)
    const own = pack.ownCheck && role === pack.ownCheck.role ? pack.ownCheck.proveHint : ''
    return { key: 'prove', label: 'Prove it works', hint: `Still needed: ${andList(missing)}. Ather reads this from tool output, not from what the session says.${own}`, prompt }
  }
  if (stage === 'ship' && intent.status === 'completed') {
    return {
      key: 'debrief',
      label: 'Write up what was learned',
      hint: 'What was proven, lost and decided, and rules worth keeping.',
      prompt: `Debrief intent ${slug}. List what was proven and with what evidence, what was lost or overwritten (lost optimisation vs broken feature), every decision taken on my behalf, and the gotchas we hit. Write it to ${pack.debriefPath(slug)}, and propose which recurring gotchas should become a skill or AGENTS.md rule for the owners (${pack.owners}).`,
    }
  }
  if (stage === 'ship') {
    return { key: 'land', label: 'Ship it', hint: pack.prompts.shipHint(role), prompt: pack.prompts.ship(role, slug) }
  }
  return undefined
}
