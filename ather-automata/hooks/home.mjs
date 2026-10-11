// @ts-check
// Ather Automata: what the console shows, and what the session is asked when
// the person picks something. Pure: no `$`.

import { windowDecisions } from './away.mjs'
import { callId, findingAnswers, ruleAnswers, rulePrompt } from './decide.mjs'
import { issueId, issueLabel, issuePrompt } from './issues.mjs'
import { STAGE_LABELS, clockText, currentStage, cutWords, directorCalls, durationText, intentLabel, isEvening, isMine, nextStep, otherRoot, ownedIntents, pickCandidates, plural, prStatusList, shortTitle } from './model.mjs'
import { unreal } from './packs/unreal.mjs'
import { isParkedBare, listStage, needsAttention, ownerName } from './worklist.mjs'

/** @typedef {import('./packs/index.mjs').Pack} Pack */

// The Unreal pack's lists and words, kept here for the modules and tests that read them from home.
export { CREATE_GROUPS, SKILL_GROUPS, TOUR_PROMPT } from './packs/unreal.mjs'

/** @typedef {import('./model.mjs').Intent} Intent */
/** @typedef {import('./away.mjs').Away} Away */

// ---------------------------------------------------------------- what the session is asked

/** @param {Intent} intent @param {{ id: string }} finding */
const callPrompt = (intent, finding) => {
  const root = otherRoot(intent)
  return `Walk me through decision ${finding.id} on intent ${intent.slug} (${root ? `${root}/` : ''}docs/intent/${intent.slug}/findings.md): what it is about, the options and your recommendation. Then ask me to choose with a question dialog, and record my answer in the intent.`
}

// How an answer given in place names the intent to the session: its key, with its findings file when it lives in another checkout.
/** @param {Intent} intent */
const callName = intent => {
  const root = otherRoot(intent)
  return root ? `${intent.key} (${root}/docs/intent/${intent.slug}/findings.md)` : intent.key
}

/** @param {Away} away @param {readonly { id: string, question: string }[]} decisions */
const reviewPrompt = (away, decisions) =>
  [
    'I am back. Walk me through the away window, one item at a time with a question dialog each.',
    decisions.length > 0 ? `Decisions taken for me (${away.ledgerPath}): ${decisions.map(one => `${one.id} ${one.question}`).join('; ')}. For each, show the choice and why, and ask me: keep it, undo it, or talk it through; then set its Status in the ledger.` : '',
    away.parked.length > 0 ? `Actions held while I was away: ${away.parked.map(one => `${one.id} ${one.command}`).join('; ')}. For each, ask me: run it now, or drop it.` : '',
  ]
    .filter(Boolean)
    .join(' ')

export const NEW_INTENT_PROMPT =
  'Start a new intent with the intent skill (.agents/skills/intent/SKILL.md). Interview me first, one question at a time and at most three: what I want to make or change, how I will know it is done, and what it must not break. Then start it with my area and my name as Owner, and show me its prompt.md before anything is built.'

export const CREATE_SHOWN = 3
// Home's preview of teammates' intents: four rows, then "+N more ›" (D7).
export const TEAM_SHOWN = 4

/** @param {string} name */
export const skillFolder = name => (name.includes('/') ? name : `.agents/skills/${name}`)

/** @param {string} name @param {string} target */
const skillPrompt = (name, target) =>
  `Run the ${name.split('/').pop()} skill (${skillFolder(name)}/SKILL.md)${target ? ` ${target}` : ''}: read it, tell me in two lines what it will do here, then follow it.`

/** @param {string} question @param {Pack} [pack] */
export const askPrompt = (question, pack = unreal) => pack.prompts.ask(question)

// What working on an intent in this session means, said wherever a press tracks one without a view (D5).
/** @param {Pack} [pack] */
export const trackConsequence = (pack = unreal) =>
  `This session gets its next step, your ${pack.id === 'unreal' ? 'builds and PIE' : 'tests and builds'} count as its proof, other sessions see you on it; /ather untrack undoes it.`

// "fluid-snow-sand-look: Build, 8/17 done, Tin Nguyen's. Also tracked in 1 other session · active 3m ago.":
// where an intent stands, in one line, for a surface without a pane.
/** @param {Intent} intent @param {string} stage @param {string} me @param {string} [heldBy] */
export const intentStands = (intent, stage, me, heldBy = '') =>
  `${intent.slug}: ${stage}, ${intent.acceptanceTotal > 0 ? `${intent.acceptanceDone}/${intent.acceptanceTotal} done` : 'no checklist yet'}, ${isMine(intent, me) ? 'yours' : intent.owner ? `${intent.owner}'s` : 'no owner named'}.${heldBy ? ` ${heldBy}.` : ''}`

// Where an intent stands, as its own files say it: the lines under "Where it stands" in its view, and
// the reply on a surface without a pane. All of it is read from prompt.md, progress.md and findings.md
// when the list was read, so showing it costs the session nothing. What is met is what progress.md says.
/** @param {Intent} intent @param {string} stage @param {string} me @param {import('./model.mjs').PrStates} [prs] */
export const standsLines = (intent, stage, me, prs = {}) => {
  const checklist = intent.acceptanceTotal > 0 ? `${intent.acceptanceDone}/${intent.acceptanceTotal} met` : 'no checklist yet'
  const whose = isMine(intent, me) ? 'yours' : intent.owner ? `${intent.owner}'s` : 'no owner named'
  const parked = intent.status === 'parked' ? ` · parked${intent.statusNote ? `: ${shortTitle(intent.statusNote, 90)}` : ''}` : ''
  /** @param {readonly string[]} all @param {number} shown */
  const some = (all, shown) => `${all.slice(0, shown).join(' · ')}${all.length > shown ? ` · +${all.length - shown} more` : ''}`
  return [
    `${stage} · ${checklist} · ${whose}${parked}`,
    intent.currentStep ? `Now: ${intent.currentStep}` : '',
    intent.thenStep ? `Then: ${intent.thenStep}` : '',
    intent.openItems.length > 0 ? `Still open: ${some(intent.openItems.map(one => [one.id, one.text].filter(Boolean).join(' ')), 4)}` : '',
    intent.findings.length > 0 ? `Open decisions: ${some(intent.findings.map(one => `${one.id} ${cutWords(one.title, 48)}${one.isBlocking ? ' (blocking)' : ''}`), 3)}` : '',
    intent.prs.length > 0 ? `PRs: ${prStatusList(intent, prs).join(', ')}` : '',
  ].filter(line => line !== '')
}

// What stopping tracking said: done (proof stays with the intent), nothing tracked, or refused while away.
/** @param {{ result: 'untracked' | 'none' | 'away', slug: string }} outcome */
export const untrackText = outcome =>
  outcome.result === 'untracked' ? `Stopped tracking ${outcome.slug}. Its proof so far stays with the intent.` : outcome.result === 'away' ? 'End the away window first.' : 'Nothing is tracked in this session.'

/** @param {readonly Item[]} items */
export const batchPrompt = items => `Take me through these one at a time, with a question dialog for each: ${items.map((one, index) => `(${index + 1}) ${one.prompt}`).join(' ')}`

// ---------------------------------------------------------------- items

/**
 * What waits on the person. Every item goes to the session with its prompt; `kind`
 * says what else changes once it has been delivered (see settleItem in state.mjs).
 * @typedef {{ id: string, label: string, title: string, question: string, prompt: string, detail?: string, answers?: import('./decide.mjs').Answers }} ItemText `detail`: the pane's second line under `label`; `answers`: what answers it in place (0.2.0)
 * A call's `slug` is its intent's key in the pane.
 * @typedef {ItemText & ({ kind: 'call', slug: string } | { kind: 'review' } | { kind: 'lost' } | { kind: 'editor' } | { kind: 'rule', ruleIds: string[] } | { kind: 'away-end' })} Item
 */

/**
 * @typedef {{ id: string, label: string, hint: string, prompt: string, isDraft?: boolean, isTour?: boolean, work?: Work, action?: 'checked', isLook?: boolean, look?: string }} Next
 * `look`: the key of the intent whose view answers a step that only reads (model.mjs's `isLook`).
 * Something to work on: an open intent to track, or an assigned GitHub issue to start an intent from.
 * An intent's `owner` is its Owner line as written (people are matched on it), `who` the name shown,
 * `stage` where it stands in the list, `source` where it was read (origin/main, or only this checkout), `key` its name
 * in the pane (model.mjs's Intent), `repoName` its repository's short name when the list holds several checkouts' intents.
 * @typedef {{ id: string, kind: 'intent', slug: string, key: string, root: string, repoName: string, label: string, hint: string, isMine: boolean, area: string, owner: string, who: string, updatedAt: number,
 *   stage: import('./worklist.mjs').ListStage, done: number, total: number, source: 'main' | 'local', warn: string }
 *   | { id: string, kind: 'issue', issue: import('./issues.mjs').Issue, repoName: string, label: string, hint: string, prompt: string, isMine: true, area: string, updatedAt: number, stage: '' }} Work
 * @typedef {{
 *   intents: readonly Intent[], pinned: string | null, me: string, role: string, area: string, tourDone: boolean,
 *   evidence: import('./model.mjs').Evidence, away: Away, ledger: string, lost: { paths: string[], isDisclosed: boolean } | null,
 *   lock: import('./model.mjs').EditorLock, recurring: readonly { id: string, title: string, fix: string, count: number }[],
 *   issues: readonly import('./issues.mjs').Issue[], last?: string | null, sent: readonly string[], workers: number, now: number, tz: number,
 *   skills?: readonly { name: string, description: string }[], prs?: import('./model.mjs').PrStates, week?: Week | null, pack?: Pack
 * }} HomeInput `pinned` and `last`: intents' keys (the tracked one, and the one the person last worked on)
 */

/**
 * This week's figures from the week-calendar plugin, when this PC runs it.
 * @typedef {{ prsMerged: number, productive: number | null }} Week
 */

// ~/.calendar/latest.json, written by week-calendar: its figures while its week is still running.
/** @param {string | null} text @param {number} now @returns {Week | null} */
export const parseWeek = (text, now) => {
  if (!text) return null
  try {
    const data = JSON.parse(text)
    const start = Number(data?.week?.startMs), end = Number(data?.week?.endMs)
    if (!(now >= start && now < end) || !data.metrics) return null
    const productive = data.machineHours?.productiveUtilization
    return { prsMerged: Number(data.metrics.prsMerged) || 0, productive: typeof productive === 'number' ? productive : null }
  } catch {
    return null
  }
}

// "This week: 3 PRs merged · 68% productive"
/** @param {Week | null | undefined} week */
export const weekText = week =>
  week ? [`This week: ${plural(week.prsMerged, 'PR')} merged`, week.productive === null ? '' : `${Math.round(week.productive * 100)}% productive`].filter(Boolean).join(' · ') : ''

// What to work on, in one list: your open intents, then your GitHub issues that have no intent
// yet (most urgent, then most recent), then teammates' intents you could follow. Intents and issues
// from more than one checkout each carry their repository's short name.
/** @param {readonly Intent[]} intents @param {readonly import('./issues.mjs').Issue[]} issues @param {string} me @param {string} area @param {number} now @param {string} [role] @param {import('./model.mjs').PrStates} [prs] @param {Pack} [pack] @returns {Work[]} */
export const workList = (intents, issues, me, area, now, role = 'set', prs = {}, pack = unreal) => {
  // An issue already started is hidden behind its intent: one in the same checkout.
  const linked = new Set(intents.filter(one => one.issue).map(one => `${one.root}#${one.issue}`))
  const ranked = pickCandidates(intents, me, area)
  const isMany = new Set([...intents.map(one => one.root), ...issues.map(issue => issue.root ?? '')]).size > 1
  /** @param {Intent} one @returns {Work} */
  const toIntent = one => ({
    id: `intent:${one.key}`, kind: 'intent', slug: one.slug, key: one.key, root: one.root, repoName: isMany ? one.repoName : '', label: one.slug, hint: intentLabel(one, me, prs), isMine: isMine(one, me), area: one.area,
    owner: one.owner, who: ownerName(one.owner, one.firstAuthor, pack), updatedAt: one.updatedAt, stage: listStage(one, prs), done: one.acceptanceDone, total: one.acceptanceTotal, source: one.source,
    warn: isParkedBare(one) ? 'parked, no reason' : '',
  })
  return [
    ...ranked.filter(one => isMine(one, me)).map(toIntent),
    ...issues
      .filter(issue => !linked.has(`${issue.root ?? ''}#${issue.number}`))
      .map(issue => (/** @type {Work} */ ({ id: issueId(issue), kind: 'issue', issue, repoName: isMany ? (issue.repoName ?? '') : '', label: `#${issue.number} ${issue.name}`, hint: issueLabel(issue, now), prompt: issuePrompt(issue, me, role, pack.roleWords), isMine: true, area: issue.area, updatedAt: issue.updatedAt, stage: '' }))),
    ...ranked.filter(one => !isMine(one, me)).map(toIntent),
  ]
}

// ---------------------------------------------------------------- the work list: sources, search, people

// Where each piece of work comes from, in the order the list shows them. `key` is workGroup's answer.
export const WORK_GROUPS = /** @type {const} */ ([
  { key: 'mine', title: 'Your intents' },
  { key: 'issues', title: 'Assigned issues' },
  { key: 'others', title: "Teammates' intents" },
])

/** @param {Work} one @returns {'mine' | 'issues' | 'others'} */
export const workGroup = one => (one.kind === 'issue' ? 'issues' : one.isMine ? 'mine' : 'others')

// The work that matches every word of `query`: in its title, area, an issue's own title, or an intent's
// owner as written or as shown, or its key.
/** @param {readonly Work[]} work @param {string} query */
export const filterWork = (work, query) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return work.filter(one => {
    const text = `${one.label} ${one.area} ${one.kind === 'issue' ? one.issue.title : `${one.owner} ${one.who} ${one.key}`}`.toLowerCase()
    return words.every(word => text.includes(word))
  })
}

// Eight colours that read on the pane's dark page: one per person, so a name is always the same colour.
export const PEOPLE_COLOURS = ['#7aa2ff', '#ff8f6b', '#4fd1a5', '#d68cff', '#ffd166', '#5fd0e8', '#ff7eb6', '#a3d977']

// A colour for each of these people: it starts at the hash of the name and steps on to the next free
// colour when someone in the list already has it, so no two of them share one (up to eight).
/** @param {readonly string[]} names @returns {Record<string, string>} */
export const personColours = names => {
  const taken = new Set()
  /** @type {Record<string, string>} */
  const out = {}
  for (const name of [...new Set(names)].sort()) {
    let hash = 0
    for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    let at = hash % PEOPLE_COLOURS.length
    for (let tries = 0; tries < PEOPLE_COLOURS.length && taken.has(at); tries += 1) at = (at + 1) % PEOPLE_COLOURS.length
    taken.add(at)
    out[name] = PEOPLE_COLOURS[at] ?? '#7aa2ff'
  }
  return out
}

// A colour dimmed by `amount` (0.3: 30%), blended toward the page it sits on: a terminal has no opacity.
/** @param {string} hex '#rrggbb' @param {number} amount @param {string} [backdrop] */
export const dimColour = (hex, amount, backdrop = '#1a1b1e') => {
  const part = (/** @type {string} */ colour, /** @type {number} */ at) => parseInt(colour.slice(1 + at * 2, 3 + at * 2), 16)
  return `#${[0, 1, 2].map(at => Math.round(part(hex, at) * (1 - amount) + part(backdrop, at) * amount).toString(16).padStart(2, '0')).join('')}`
}

/** @param {HomeInput} input */
export const buildHome = input => {
  const { intents, pinned, me, evidence, away, now, tz } = input
  const prs = input.prs ?? {}
  const pack = input.pack ?? unreal
  // Unset ('') until the person says it: then any role's proof counts, and the Editor is assumed not needed.
  const role = input.role
  const intent = intents.find(one => one.key === pinned)
  const owned = ownedIntents(intents, me, pinned)
  // New until they take the tour, skip it or say their role, and while they own no intent.
  const isNewcomer = me !== '' && !input.tourDone && input.role === '' && owned.length === 0
  const stage = currentStage(intent, evidence, role, prs, pack)
  const roleText = input.role ? `${pack.roleLabels[input.role] ?? input.role}` : isNewcomer ? '' : 'Role not set · /ather role'
  const decisions = away.phase === 'off' ? [] : windowDecisions(input.ledger)
  const lock = input.lock
  const lockText = lock.state === 'free' ? 'Editor free' : lock.state === 'held' ? `Editor busy · ${lock.holder || 'another session'}${lock.until ? ` until ${lock.until}` : ''}` : ''

  if (away.phase === 'running') {
    const so = decisions.length + away.parked.length === 0 ? 'nothing for you yet' : `${plural(decisions.length, 'decision')} · ${away.parked.length} held`
    /** @type {Item} */
    const end = { kind: 'away-end', id: 'away-end', label: "I'm back: end the window", title: "End the window (I'm back)", question: `End the away window and review it (${so})`, prompt: '' }
    const progress = away.untilDone ? 'until done' : `until ${clockText(away.wakeAt, tz)}`
    return { actions: [], skills: [], create: [], editor: { isHeld: false, isFree: false, holder: '', until: '' }, header: { title: intent?.key ?? 'Ather', stage: 'Away', progress, track: '', stages: [], proof: '', done: 0, total: 0, sentence: so, lock: lockText, role: roleText, week: weekText(input.week) }, items: [end], open: [end], next: undefined, work: workList(intents, input.issues, me, input.area, now, 'set', {}, pack), own: [], teamPreview: { rows: [], total: 0 }, attention: [], isNewcomer: false, offerAway: false }
  }

  /** @type {Item[]} */
  const items = []
  if (away.phase === 'review') {
    const what = [decisions.length > 0 ? plural(decisions.length, 'decision') : '', away.parked.length > 0 ? plural(away.parked.length, 'held action') : ''].filter(Boolean).join(', ') || 'nothing recorded'
    items.push({ kind: 'review', id: `review:${away.startedAt}`, label: `Review: ${what}`, title: `Review what happened while you were away (${what})`, question: `While you were away: ${what}`, prompt: reviewPrompt(away, decisions) })
  }
  if (input.lost && !input.lost.isDisclosed) {
    const paths = input.lost.paths
    const named = `${(paths[0] ?? '').split('/').pop()?.replace(/\.(uasset|umap)$/i, '') ?? ''}${paths.length > 1 ? ` and ${plural(paths.length - 1, 'more')}` : ''}`
    items.push({ kind: 'lost', id: 'lost', label: 'See what a merge lost', title: `A merge dropped your edits to ${named}`, question: `A merge dropped your edits to ${named}`, prompt: `The last merge kept the other side of these binary assets, so this branch's edits to them are gone: ${paths.join(', ')}. List them for me, itemised, each marked as a lost optimisation or a broken feature, and propose how to re-apply each.` })
  }
  // A session that tracks an intent answers for that intent only: pressing another intent's call here would put it
  // in this session's chat. With nothing tracked, every call of yours is offered, each named by its intent.
  for (const one of intent ? owned.filter(each => each.key === pinned) : owned) {
    for (const finding of directorCalls(one)) {
      items.push({ kind: 'call', slug: one.key, id: callId(one.key, finding.id), label: `Decide ${finding.id} on ${one.key}`, title: `${finding.id} · ${one.key === pinned ? '' : `${one.key} · `}${finding.title}`, detail: finding.full, question: `${finding.id} on ${one.key}: ${finding.title}`, prompt: callPrompt(one, finding), answers: findingAnswers(callName(one), finding) })
    }
  }
  if (intent && pack.lockRoles.includes(role) && (stage === 'build' || stage === 'prove') && lock.state === 'held' && !lock.isStale) {
    const holder = lock.holder || 'another lane'
    items.push({ kind: 'editor', id: 'editor', label: 'Ask for the Editor', title: `Editor held by ${holder}${lock.until ? ` until ${lock.until}` : ''}: ask for a window`, question: `The Editor is held by ${holder}`, prompt: `Find the session that holds the Editor owner lock (${lock.raw}) and ask it for a short window for my next step. Wait for its answer before touching the Editor.` })
  }
  // Problems that keep coming back wait as one item, however many: eight rows of them buried the rest.
  const recurring = input.recurring
  if (recurring.length === 1) {
    const [one] = recurring
    items.push({
      kind: 'rule',
      ruleIds: [one.id],
      id: `rule:${one.id}`,
      label: 'Turn a repeated problem into a rule?',
      title: `Keeps coming back: ${one.title}`,
      detail: `"${one.title}" has come up in ${one.count} sessions.`,
      answers: ruleAnswers([one], pack.owners),
      question: `"${one.title}" has come up in ${one.count} sessions`,
      prompt: rulePrompt([one], pack.owners),
    })
  } else if (recurring.length > 1) {
    items.push({
      kind: 'rule',
      ruleIds: recurring.map(one => one.id),
      id: `rule:${recurring.map(one => one.id).join('+')}`,
      label: 'Turn repeated problems into rules?',
      title: `${recurring.length} problems keep coming back: make them rules?`,
      detail: `${recurring.length} problems have each come up in 3 or more sessions.`,
      answers: ruleAnswers(recurring, pack.owners),
      question: `${recurring.length} problems have each come up in 3 or more sessions`,
      prompt: rulePrompt(recurring, pack.owners),
    })
  }
  const open = items.filter(one => !input.sent.includes(one.id))
  // Work handed to the session in this session (an issue being started) leaves the list.
  const work = workList(intents, input.issues, me, input.area, now, role, prs, pack).filter(one => !input.sent.includes(one.id))
  const step = nextStep(role, intent, evidence, input.workers, me, prs, pack)
  const lastWork = work.find(one => one.kind === 'intent' && one.key === input.last && one.isMine)
  /** @type {Next | undefined} */
  let next
  const own = pack.ownCheck
  const isLostOpen = open.some(one => one.kind === 'lost')
  if (isLostOpen) next = undefined
  else if (isNewcomer && !intent) next = { id: 'next:tour', label: 'Take the tour', hint: 'Six short steps. Ends with your first intent started.', prompt: pack.prompts.tour, isTour: true }
  // A tech artist with PIE proven has one proof left that only they can give: their own Editor check.
  else if (intent && stage === 'prove' && own && role === own.role && evidence[own.after]?.state === 'pass' && evidence[own.rung]?.state !== 'pass') next = { id: `next:${intent.key}:checked`, label: own.label, hint: own.hint, prompt: '', action: 'checked' }
  else if (intent && step) next = { id: `next:${intent.key}:${step.key}`, ...step, ...(step.isLook ? { look: intent.key } : {}) }
  // Nothing tracked in this session: offer to continue the intent the person last worked on.
  else if (!intent && lastWork?.kind === 'intent') next = { id: lastWork.id, label: `Continue ${lastWork.key}`, hint: lastWork.hint, prompt: '', work: lastWork }
  else if (!intent && work[0]?.kind === 'intent') next = { id: work[0].id, label: `Pick up ${work[0].key}`, hint: work[0].hint, prompt: '', work: work[0] }
  else if (!intent && work[0]?.kind === 'issue') next = { id: work[0].id, label: `Start issue #${work[0].issue.number}`, hint: `${work[0].issue.name} · ${work[0].hint}`, prompt: work[0].prompt, work: work[0] }
  else if (step) next = { id: 'next:start', ...step }
  // The quick actions under the header: start something new, or pick a skill from the short list.
  const rest = work.filter(one => one !== next?.work)
  const team = rest.filter(one => !one.isMine)
  const present = new Map((input.skills ?? []).map(one => [one.name, one.description]))
  const skills = pack.skillGroups.flatMap(({ group, names }) =>
    names.filter(name => present.has(name)).map(name => ({ id: `skill:${name.split('/').pop()}`, group, name: name.split('/').pop() ?? name, description: present.get(name) ?? '', prompt: skillPrompt(name, intent ? `for intent ${intent.slug}` : '') })),
  )
  // The Editor's state decides what the session does first when making something there.
  const editor = { isHeld: lock.state === 'held' && !lock.isStale, isFree: lock.state === 'free', holder: lock.holder, until: lock.until }
  const order = pack.createOrder[role] ?? pack.createOrder[pack.roles[pack.roles.length - 1] ?? ''] ?? []
  const create = [...pack.createGroups]
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
    .map(({ group, items }) => ({ group, items: items.filter(item => item.isGlobal || present.has(item.name)).map(item => ({ id: `create:${item.name.split('/').pop()}`, name: item.name.split('/').pop() ?? item.name, verb: item.verb, description: present.get(item.name) ?? '', prompt: pack.createPrompt(item.verb, item.name, editor) })) }))
    .filter(one => one.items.length > 0)
  /** @type {{ id: string, label: string, prompt?: string, opens?: 'skills' | 'create', isPrimary?: boolean }[]} */
  const actions = [{ id: 'action:new-intent', label: '＋ New intent', prompt: NEW_INTENT_PROMPT, isPrimary: true }]
  if (skills.length > 0) actions.push({ id: 'action:skills', label: '▶ Skills', opens: 'skills' })
  if (create.length > 0) actions.push({ id: 'action:create', label: '✦ Create', opens: 'create' })
  return {
    actions,
    skills,
    create,
    editor,
    header: {
      title: intent?.key ?? 'Ather',
      // A checklist with nothing done and no one working yet is planned, not being built.
      stage: !intent ? '' : stage === 'build' && intent.acceptanceDone === 0 && !intent.hasWorker && input.workers === 0 ? 'Planned' : STAGE_LABELS[stage],
      progress: intent && intent.acceptanceTotal > 0 ? `${intent.acceptanceDone} of ${intent.acceptanceTotal} done` : '',
      track: intent ? stageTrack(stage) : '',
      stages: intent ? stageList(stage) : [],
      proof: proofText(evidence, pack),
      done: intent?.acceptanceDone ?? 0,
      total: intent?.acceptanceTotal ?? 0,
      sentence: away.phase === 'review' || isNewcomer ? '' : open.length > 0 ? 'waiting on you' : input.workers > 0 ? 'agents working' : intent ? '' : 'no intent yet',
      lock: lockText,
      role: roleText,
      week: weekText(input.week),
    },
    items,
    open,
    next,
    work,
    // With nothing tracked, the person's own other work after Next; for everyone, the team's first rows and how many (D7).
    own: intent ? [] : rest.filter(one => one.isMine).slice(0, 5),
    teamPreview: { rows: team.slice(0, TEAM_SHOWN), total: team.length },
    // The person's own intents that want a press: every item met, or parked with no reason (D5).
    attention: needsAttention(intents, me, prs).filter(one => !input.sent.includes(one.id)),
    isNewcomer,
    offerAway: !isNewcomer && away.phase === 'off' && (isEvening(now, tz) || (input.workers > 0 && open.length === 0)),
  }
}

const STAGE_ORDER = ['plan', 'build', 'prove', 'ship']
// How far along the four stages the work is; shipped, and ready to close, are past Ship.
/** @param {string} stage */
const stageIndex = stage => (stage === 'shipped' || stage === 'close' ? STAGE_ORDER.length : STAGE_ORDER.indexOf(stage))

// Each stage with where the work is: done, now or to do; the pane colours them.
/** @param {string} stage @returns {{ label: string, state: 'done' | 'now' | 'todo' }[]} */
const stageList = stage => {
  const at = stageIndex(stage)
  return STAGE_ORDER.map((key, index) => ({ label: STAGE_LABELS[/** @type {keyof typeof STAGE_LABELS} */ (key)], state: index < at ? 'done' : index === at ? 'now' : 'todo' }))
}

// "Plan ✓  Build ✓  Prove ●  Ship ○": where the work is, at a glance.
/** @param {string} stage */
const stageTrack = stage => {
  const at = stageIndex(stage)
  return STAGE_ORDER.map((key, index) => `${STAGE_LABELS[/** @type {keyof typeof STAGE_LABELS} */ (key)]} ${index < at ? '✓' : index === at ? '●' : '○'}`).join('  ')
}

// "build ✓ by session 1a2b3c4d · tests ✗": an intent's proof so far, each record another session wrote named
// by that session (its title when known, `names`), so proof a helper produced is never taken for this one's.
/** @param {import('./model.mjs').Evidence} evidence @param {Pack} pack @param {string} mine this session's first 8 hex @param {Readonly<Record<string, string>>} [names] */
export const proofLine = (evidence, pack, mine, names = {}) =>
  Object.entries(pack.proofWords)
    .filter(([rung]) => (evidence[rung]?.state ?? 'none') !== 'none')
    .map(([rung, word]) => {
      const by = evidence[rung]?.by
      const elsewhere = by && by !== mine ? ` by ${names[by] ? `"${names[by]}"` : `session ${by}`}` : ''
      return `${word} ${evidence[rung]?.state === 'pass' ? '✓' : '✗'}${elsewhere}`
    })
    .join(' · ')

// "Also tracked in 2 other sessions": the live sessions on this checkout that track the same intent;
// '' when there are none. This is the line the session itself is told, so it carries no age: Claude Code
// keeps the lane section as it first read it for the whole conversation (seen on 2.1.296), where
// "active 4m ago" would stay long after it stopped being true.
/** @param {readonly { intent: string | null }[]} peers @param {string} slug */
export const trackedByLine = (peers, slug) => {
  const same = peers.filter(lane => slug !== '' && lane.intent === slug)
  return same.length === 0 ? '' : `Also tracked in ${plural(same.length, 'other session')}`
}

// "Also tracked in 2 other sessions · active 4m ago": the same line for a person, with when the latest
// of those sessions last did something. For the pane and the dialogs, never for the session's prompt.
/** @param {readonly { intent: string | null, updatedAt: number, lastActiveAt?: number }[]} peers @param {string} slug @param {number} now */
export const heldByLine = (peers, slug, now) => {
  const line = trackedByLine(peers, slug)
  if (line === '') return ''
  const ago = now - Math.max(...peers.filter(lane => lane.intent === slug).map(lane => Number(lane.lastActiveAt ?? lane.updatedAt) || 0))
  return `${line} · ${ago < 60000 ? 'active now' : `active ${durationText(ago)} ago`}`
}

// "build ✓ · tests ✗": the proof seen so far, so a failed test is never hidden.
/** @param {import('./model.mjs').Evidence} evidence @param {Pack} pack */
const proofText = (evidence, pack) =>
  Object.entries(pack.proofWords)
    .filter(([rung]) => (evidence[rung]?.state ?? 'none') !== 'none')
    .map(([rung, word]) => `${word} ${evidence[rung]?.state === 'pass' ? '✓' : '✗'}`)
    .join(' · ')
