// @ts-check
// Ather Automata: what the console shows, and what the session is asked when
// the person picks something. Pure: no `$`.

import { windowDecisions } from './away.mjs'
import { issueLabel, issuePrompt } from './issues.mjs'
import { OWNERS, ROLE_LABELS, STAGE_LABELS, clockText, currentStage, directorCalls, intentLabel, isEvening, isMine, nextStep, ownedIntents, pickCandidates, plural } from './model.mjs'

/** @typedef {import('./model.mjs').Intent} Intent */
/** @typedef {import('./away.mjs').Away} Away */

// ---------------------------------------------------------------- what the session is asked

/** @param {Intent} intent @param {{ id: string }} finding */
const callPrompt = (intent, finding) =>
  `Walk me through decision ${finding.id} on intent ${intent.slug} (docs/intent/${intent.slug}/findings.md): what it is about, the options and your recommendation. Then ask me to choose with a question dialog, and record my answer in the intent.`

/** @param {Away} away @param {readonly { id: string, question: string }[]} decisions */
const reviewPrompt = (away, decisions) =>
  [
    'I am back. Walk me through the away window, one item at a time with a question dialog each.',
    decisions.length > 0 ? `Decisions taken for me (${away.ledgerPath}): ${decisions.map(one => `${one.id} ${one.question}`).join('; ')}. For each, show the choice and why, and ask me: keep it, undo it, or talk it through; then set its Status in the ledger.` : '',
    away.parked.length > 0 ? `Actions held while I was away: ${away.parked.map(one => `${one.id} ${one.command}`).join('; ')}. For each, ask me: run it now, or drop it.` : '',
  ]
    .filter(Boolean)
    .join(' ')

export const TOUR_PROMPT = 'Give me the Ather tour: follow .agents/skills/ather-tour/SKILL.md step by step.'

/** @param {string} question */
export const askPrompt = question =>
  `I asked Ather: "${question}" Answer briefly in plain words. Ather is this studio's Claude Code mod (docs/design-docs/s2-director-kit.md, section 5): /ather shows what needs me and the next step, /ather tour walks a newcomer through the workflow, /away hands over while I am away. If the question is about my work instead, answer from this checkout.`

/** @param {readonly Item[]} items */
export const batchPrompt = items => `Take me through these one at a time, with a question dialog for each: ${items.map((one, index) => `(${index + 1}) ${one.prompt}`).join(' ')}`

// ---------------------------------------------------------------- items

/**
 * What waits on the person. Every item goes to the session with its prompt; `kind`
 * says what else changes once it has been delivered (see settleItem in state.mjs).
 * @typedef {{ id: string, label: string, title: string, question: string, prompt: string }} ItemText
 * @typedef {ItemText & ({ kind: 'call' } | { kind: 'review' } | { kind: 'lost' } | { kind: 'editor' } | { kind: 'rule', ruleId: string } | { kind: 'away-end' })} Item
 */

/**
 * @typedef {{ id: string, label: string, hint: string, prompt: string, isDraft?: boolean, isTour?: boolean, work?: Work, action?: 'checked' }} Next
 * Something to work on: an open intent to track, or an assigned GitHub issue to start an intent from.
 * @typedef {{ id: string, kind: 'intent', slug: string, label: string, hint: string, isMine: boolean, area: string }
 *   | { id: string, kind: 'issue', issue: import('./issues.mjs').Issue, label: string, hint: string, prompt: string, isMine: true, area: string }} Work
 * @typedef {{
 *   intents: readonly Intent[], pinned: string | null, me: string, role: string, area: string, tourDone: boolean,
 *   evidence: import('./model.mjs').Evidence, away: Away, ledger: string, lost: { paths: string[], isDisclosed: boolean } | null,
 *   lock: import('./model.mjs').EditorLock, recurring: readonly { id: string, title: string, fix: string, count: number }[],
 *   issues: readonly import('./issues.mjs').Issue[], last?: string | null, sent: readonly string[], workers: number, now: number, tz: number
 * }} HomeInput
 */

// What to work on, in one list: your open intents, then your GitHub issues that have no intent
// yet (most urgent, then most recent), then teammates' intents you could follow.
/** @param {readonly Intent[]} intents @param {readonly import('./issues.mjs').Issue[]} issues @param {string} me @param {string} area @param {number} now @param {string} [role] @returns {Work[]} */
export const workList = (intents, issues, me, area, now, role = 'set') => {
  const linked = new Set(intents.map(one => one.issue).filter(Boolean))
  const ranked = pickCandidates(intents, me, area)
  /** @param {Intent} one @returns {Work} */
  const toIntent = one => ({ id: `intent:${one.slug}`, kind: 'intent', slug: one.slug, label: one.slug, hint: intentLabel(one, me), isMine: isMine(one, me), area: one.area })
  return [
    ...ranked.filter(one => isMine(one, me)).map(toIntent),
    ...issues.filter(issue => !linked.has(issue.number)).map(issue => (/** @type {Work} */ ({ id: `issue:${issue.number}`, kind: 'issue', issue, label: `#${issue.number} ${issue.title}`, hint: issueLabel(issue, now), prompt: issuePrompt(issue, me, role), isMine: true, area: issue.area }))),
    ...ranked.filter(one => !isMine(one, me)).map(toIntent),
  ]
}

/** @param {HomeInput} input */
export const buildHome = input => {
  const { intents, pinned, me, evidence, away, now, tz } = input
  // Unset ('') until the person says it: then any role's proof counts, and the Editor is assumed not needed.
  const role = input.role
  const intent = intents.find(one => one.slug === pinned)
  const owned = ownedIntents(intents, me, pinned)
  // New until they take the tour, skip it or say their role, and while they own no intent.
  const isNewcomer = !input.tourDone && input.role === '' && owned.length === 0
  const stage = currentStage(intent, evidence, role)
  const roleText = input.role ? `as ${ROLE_LABELS[/** @type {keyof typeof ROLE_LABELS} */ (input.role)] ?? input.role}` : 'role not set (/ather role)'
  const decisions = away.phase === 'off' ? [] : windowDecisions(input.ledger)
  const lock = input.lock
  const lockText = lock.state === 'free' ? 'Editor free' : lock.state === 'held' ? `Editor: ${lock.holder || 'held'}${lock.until ? ` until ${lock.until}` : ''}` : ''

  if (away.phase === 'running') {
    const so = decisions.length + away.parked.length === 0 ? 'nothing for you yet' : `${plural(decisions.length, 'decision')} · ${away.parked.length} held`
    /** @type {Item} */
    const end = { kind: 'away-end', id: 'away-end', label: "I'm back: end the window", title: "End the window (I'm back)", question: `End the away window and review it (${so})`, prompt: '' }
    const progress = away.untilDone ? 'until done' : `until ${clockText(away.wakeAt, tz)}`
    return { header: { title: intent?.slug ?? 'Ather', stage: 'Away', progress, track: '', proof: '', sentence: so, lock: lockText, role: roleText }, items: [end], open: [end], next: undefined, work: workList(intents, input.issues, me, input.area, now), picks: [], isNewcomer: false, offerAway: false }
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
  for (const one of owned) {
    for (const finding of directorCalls(one)) {
      items.push({ kind: 'call', id: `call:${one.slug}:${finding.id}`, label: `Decide ${finding.id} on ${one.slug}`, title: `${finding.id} · ${one.slug === pinned ? '' : `${one.slug} · `}${finding.title}`, question: `${finding.id} on ${one.slug}: ${finding.title}`, prompt: callPrompt(one, finding) })
    }
  }
  if (intent && (role === 'techart' || role === 'designer') && (stage === 'build' || stage === 'prove') && lock.state === 'held' && !lock.isStale) {
    const holder = lock.holder || 'another lane'
    items.push({ kind: 'editor', id: 'editor', label: 'Ask for the Editor', title: `Editor held by ${holder}${lock.until ? ` until ${lock.until}` : ''}: ask for a window`, question: `The Editor is held by ${holder}`, prompt: `Find the session that holds the Editor owner lock (${lock.raw}) and ask it for a short window for my next step. Wait for its answer before touching the Editor.` })
  }
  for (const one of input.recurring) {
    items.push({
      kind: 'rule',
      ruleId: one.id,
      id: `rule:${one.id}`,
      label: 'Turn a repeated problem into a rule?',
      title: `Keeps happening: ${one.title} (${one.count} sessions)`,
      question: `"${one.title}" has come up in ${one.count} sessions`,
      prompt: `The trap "${one.title}" has come up in ${one.count} separate sessions. Its fix each time: ${one.fix} Ask me with a question dialog whether to make it a rule. If yes, draft the change that prevents it (the AGENTS.md line or skill step, at the closest authority AGENTS.md allows) and show me the diff for review by the owners (${OWNERS}); do not commit.`,
    })
  }
  const open = items.filter(one => !input.sent.includes(one.id))
  // Work handed to the session in this session (an issue being started) leaves the list.
  const work = workList(intents, input.issues, me, input.area, now, role).filter(one => !input.sent.includes(one.id))
  const step = nextStep(role, intent, evidence, input.workers, me)
  const lastWork = work.find(one => one.kind === 'intent' && one.slug === input.last && one.isMine)
  /** @type {Next | undefined} */
  let next
  const isLostOpen = open.some(one => one.kind === 'lost')
  if (isLostOpen) next = undefined
  else if (isNewcomer && !intent) next = { id: 'next:tour', label: 'New here? Take the tour', hint: 'How S2 works with Claude Code, in six short steps, ending with your first intent started.', prompt: TOUR_PROMPT, isTour: true }
  // A tech artist with PIE proven has one proof left that only they can give: their own Editor check.
  else if (intent && stage === 'prove' && role === 'techart' && evidence.pie.state === 'pass' && evidence.editor.state !== 'pass') next = { id: `next:${intent.slug}:checked`, label: 'I checked it in the Editor', hint: 'PIE proof ✓ · your own Editor check is the last proof.', prompt: '', action: 'checked' }
  else if (intent && step) next = { id: `next:${intent.slug}:${step.key}`, ...step }
  // Nothing tracked in this session: offer to continue the intent the person last worked on.
  else if (!intent && lastWork) next = { id: lastWork.id, label: `Continue ${lastWork.label}`, hint: lastWork.hint, prompt: '', work: lastWork }
  else if (!intent && work[0]?.kind === 'intent') next = { id: work[0].id, label: `Pick up ${work[0].slug}`, hint: work[0].hint, prompt: '', work: work[0] }
  else if (!intent && work[0]?.kind === 'issue') next = { id: work[0].id, label: `Start issue #${work[0].issue.number}`, hint: `${work[0].issue.title} · ${work[0].hint}`, prompt: work[0].prompt, work: work[0] }
  else if (step) next = { id: 'next:start', ...step }
  return {
    header: {
      title: intent?.slug ?? 'Ather',
      // A checklist with nothing done and no one working yet is planned, not being built.
      stage: !intent ? '' : stage === 'build' && intent.acceptanceDone === 0 && !intent.hasWorker && input.workers === 0 ? 'Planned' : STAGE_LABELS[stage],
      progress: intent && intent.acceptanceTotal > 0 ? `${intent.acceptanceDone} of ${intent.acceptanceTotal} done` : '',
      track: intent ? stageTrack(stage) : '',
      proof: proofText(evidence),
      sentence: away.phase === 'review' ? '' : isNewcomer ? 'new here? start with the tour' : open.length > 0 ? 'waiting on you' : input.workers > 0 ? 'agents working' : intent ? '' : 'no intent yet',
      lock: lockText,
      role: roleText,
    },
    items,
    open,
    next,
    work,
    // With nothing tracked: the rest of the list after Next, for the pane.
    picks: intent ? [] : work.filter(one => one !== next?.work).slice(0, 5),
    isNewcomer,
    offerAway: !isNewcomer && away.phase === 'off' && (isEvening(now, tz) || (input.workers > 0 && open.length === 0)),
  }
}

// "Plan ✓  Build ✓  Prove ●  Ship ○": where the work is, at a glance.
/** @param {string} stage */
const stageTrack = stage => {
  const order = ['plan', 'build', 'prove', 'ship']
  const at = stage === 'shipped' ? order.length : order.indexOf(stage)
  return order.map((key, index) => `${STAGE_LABELS[/** @type {keyof typeof STAGE_LABELS} */ (key)]} ${index < at ? '✓' : index === at ? '●' : '○'}`).join('  ')
}

const PROOF_WORDS = { build: 'build', automation: 'tests', readback: 'read-back', pie: 'PIE', editor: 'Editor check' }

// "build ✓ · tests ✗": the proof seen so far, so a failed test is never hidden.
/** @param {import('./model.mjs').Evidence} evidence */
const proofText = evidence =>
  Object.entries(PROOF_WORDS)
    .filter(([rung]) => evidence[/** @type {keyof typeof evidence} */ (rung)].state !== 'none')
    .map(([rung, word]) => `${word} ${evidence[/** @type {keyof typeof evidence} */ (rung)].state === 'pass' ? '✓' : '✗'}`)
    .join(' · ')
