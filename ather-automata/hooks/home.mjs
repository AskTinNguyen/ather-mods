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

export const NEW_INTENT_PROMPT =
  'Start a new intent with the intent skill (.agents/skills/intent/SKILL.md). Interview me first, one question at a time and at most three: what I want to make or change, how I will know it is done, and what it must not break. Then start it with my area and my name as Owner, and show me its prompt.md before anything is built.'

// The skills worth one press, by what they are for. Only those present in .agents/skills show.
// A name is a folder under .agents/skills; a path names one elsewhere (the manual library).
export const SKILL_GROUPS = [
  { group: 'Review and proof', names: ['thermo-nuclear-code-quality-review', 'editor-video-walkthrough'] },
  { group: 'Authoring', names: ['unreal-editor-agent-authoring'] },
  { group: 'Agentic testing', names: ['mainchar-test-simulation', 'talab', 'unreal-pie-character-measurement', 'unreal-agent-feature-harness', 'unreal-test-harness', 'unreal-insights-pie-frame-capture'] },
  { group: 'Git and pull requests', names: ['pr-to-main', 'babysit-pr', 's2-github-pr-review', 's2-worktree-cleanup', 'git-poller-storm'] },
  { group: 'Explain it to me', names: ['bro', '.agents/skill-library/visuals/show-me'] },
]

// Making things in the Editor: the skills that build content through MCP, grouped by what is made,
// each led by what it does. The first three of a group show; the rest wait behind More.
export const CREATE_GROUPS = [
  { group: 'VFX and look', items: [
    { name: 'unreal-niagara-mcp', verb: 'Make or tune a Niagara effect' },
    { name: 'sw-environment-preset-from-reference', verb: 'Build a weather and sky preset from a reference image' },
    { name: 'metahuman-groom-wardrobe', verb: 'Turn grooms into MetaHuman wardrobe items' },
    { name: '.agents/skill-library/vfx/arena-pattern-vfx-designer', verb: 'Design arena pattern telegraphs' },
  ] },
  { group: 'Characters and animation', items: [
    { name: 'author-child-visual-montage-sync', verb: 'Sync a child visual montage to its parent' },
    { name: 'author-curve3d-motion-profiles', verb: 'Author a motion profile (Curve3D)' },
    { name: '.agents/skill-library/animation/ninetails-tail-shape-authoring', verb: 'Shape the NineTails tails' },
    { name: '.agents/skill-library/animation/ninetails-tail-animation-bake', verb: 'Bake NineTails tail animation' },
  ] },
  { group: 'AI and encounters', items: [
    { name: 'bt-graph', verb: 'Edit a Behavior Tree' },
    { name: 'boss-bt-authoring', verb: 'Design a boss or elite fight' },
    { name: 'team-move-rule-book-authoring', verb: 'Make a Team Move rule book for a squad' },
    { name: 's2-goai-config-authoring', verb: 'Set up GOAI NPC behaviour' },
    { name: 'qte-content-authoring', verb: 'Add a QTE' },
    { name: '.agents/skill-library/ai-enemy/behavior-tree-pattern-template-authoring', verb: 'Make a reusable Behavior Tree pattern' },
    { name: '.agents/skill-library/testing/map-session-test-setup', verb: 'Set up a boss-room test session' },
  ] },
  { group: 'Enemies', items: [
    { name: '.agents/skill-library/ai-enemy/enemy-qualification-verifier', verb: 'Check an enemy against its GDD' },
    { name: 'maintain-sipher-montage-tools', verb: 'Tune enemy montage frame data' },
  ] },
  { group: 'Levels and cinematics', items: [
    { name: 'level-cinematics-authoring', verb: 'Direct a Level Cinematic' },
    { name: 'traversal-module-authoring', verb: 'Build traversal modules' },
    { name: 'unreal-demo-gym-authoring', verb: 'Make a demo or test gym level' },
    { name: 'sipher-navmesh-bake', verb: 'Bake navmesh for a level' },
    { name: '.agents/skill-library/authoring/sipher-smart-object-mcp-workflow', verb: 'Author Smart Objects' },
  ] },
  { group: 'Audio', items: [{ name: '.agents/skill-library/audio/ability-beat-audio-authoring', verb: 'Time combat SFX to ability beats' }] },
  { group: 'Anything else', items: [{ name: 'unreal-mcp', verb: 'Edit any live asset' }] },
]
export const CREATE_SHOWN = 3

// Which groups come first, by role: what each role makes most.
const CREATE_ORDER = {
  techart: ['VFX and look', 'Characters and animation', 'Levels and cinematics', 'AI and encounters', 'Enemies', 'Audio', 'Anything else'],
  designer: ['AI and encounters', 'Enemies', 'Levels and cinematics', 'Characters and animation', 'VFX and look', 'Audio', 'Anything else'],
  engineer: ['AI and encounters', 'Levels and cinematics', 'VFX and look', 'Characters and animation', 'Enemies', 'Audio', 'Anything else'],
}

/** @param {string} verb @param {string} name @param {{ isHeld: boolean, holder: string, until: string }} editor */
const createPrompt = (verb, name, editor) =>
  `I want to ${verb.charAt(0).toLowerCase()}${verb.slice(1)} in the Unreal Editor. Use the ${name.split('/').pop()} skill (${skillFolder(name)}/SKILL.md). First ask me what I want, one question at a time and at most three. Then record it as an intent with the intent skill, take the Editor owner lock as AGENTS.md says${editor.isHeld ? ` (it is held by ${editor.holder || 'another lane'}${editor.until ? ` until ${editor.until}` : ''}: ask that lane for a window first)` : ''}, build it in the Editor, and show me the result.`

/** @param {string} name */
export const skillFolder = name => (name.includes('/') ? name : `.agents/skills/${name}`)

/** @param {string} name @param {string} target */
const skillPrompt = (name, target) =>
  `Run the ${name.split('/').pop()} skill (${skillFolder(name)}/SKILL.md)${target ? ` ${target}` : ''}: read it, tell me in two lines what it will do here, then follow it.`

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
 * @typedef {ItemText & ({ kind: 'call' } | { kind: 'review' } | { kind: 'lost' } | { kind: 'editor' } | { kind: 'rule', ruleIds: string[] } | { kind: 'away-end' })} Item
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
 *   issues: readonly import('./issues.mjs').Issue[], last?: string | null, sent: readonly string[], workers: number, now: number, tz: number,
 *   skills?: readonly { name: string, description: string }[], prs?: import('./model.mjs').PrStates
 * }} HomeInput
 */

// What to work on, in one list: your open intents, then your GitHub issues that have no intent
// yet (most urgent, then most recent), then teammates' intents you could follow.
/** @param {readonly Intent[]} intents @param {readonly import('./issues.mjs').Issue[]} issues @param {string} me @param {string} area @param {number} now @param {string} [role] @param {import('./model.mjs').PrStates} [prs] @returns {Work[]} */
export const workList = (intents, issues, me, area, now, role = 'set', prs = {}) => {
  const linked = new Set(intents.map(one => one.issue).filter(Boolean))
  const ranked = pickCandidates(intents, me, area)
  /** @param {Intent} one @returns {Work} */
  const toIntent = one => ({ id: `intent:${one.slug}`, kind: 'intent', slug: one.slug, label: one.slug, hint: intentLabel(one, me, prs), isMine: isMine(one, me), area: one.area })
  return [
    ...ranked.filter(one => isMine(one, me)).map(toIntent),
    ...issues.filter(issue => !linked.has(issue.number)).map(issue => (/** @type {Work} */ ({ id: `issue:${issue.number}`, kind: 'issue', issue, label: `#${issue.number} ${issue.name}`, hint: issueLabel(issue, now), prompt: issuePrompt(issue, me, role), isMine: true, area: issue.area }))),
    ...ranked.filter(one => !isMine(one, me)).map(toIntent),
  ]
}

/** @param {HomeInput} input */
export const buildHome = input => {
  const { intents, pinned, me, evidence, away, now, tz } = input
  const prs = input.prs ?? {}
  // Unset ('') until the person says it: then any role's proof counts, and the Editor is assumed not needed.
  const role = input.role
  const intent = intents.find(one => one.slug === pinned)
  const owned = ownedIntents(intents, me, pinned)
  // New until they take the tour, skip it or say their role, and while they own no intent.
  const isNewcomer = me !== '' && !input.tourDone && input.role === '' && owned.length === 0
  const stage = currentStage(intent, evidence, role, prs)
  const roleText = input.role ? `${ROLE_LABELS[/** @type {keyof typeof ROLE_LABELS} */ (input.role)] ?? input.role}` : isNewcomer ? '' : 'Role not set · /ather role'
  const decisions = away.phase === 'off' ? [] : windowDecisions(input.ledger)
  const lock = input.lock
  const lockText = lock.state === 'free' ? 'Editor free' : lock.state === 'held' ? `Editor: ${lock.holder || 'held'}${lock.until ? ` until ${lock.until}` : ''}` : ''

  if (away.phase === 'running') {
    const so = decisions.length + away.parked.length === 0 ? 'nothing for you yet' : `${plural(decisions.length, 'decision')} · ${away.parked.length} held`
    /** @type {Item} */
    const end = { kind: 'away-end', id: 'away-end', label: "I'm back: end the window", title: "End the window (I'm back)", question: `End the away window and review it (${so})`, prompt: '' }
    const progress = away.untilDone ? 'until done' : `until ${clockText(away.wakeAt, tz)}`
    return { actions: [], skills: [], create: [], editor: { isHeld: false, isFree: false, holder: '', until: '' }, header: { title: intent?.slug ?? 'Ather', stage: 'Away', progress, track: '', stages: [], proof: '', done: 0, total: 0, sentence: so, lock: lockText, role: roleText }, items: [end], open: [end], next: undefined, work: workList(intents, input.issues, me, input.area, now), picks: [], isNewcomer: false, offerAway: false }
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
      question: `"${one.title}" has come up in ${one.count} sessions`,
      prompt: `The trap "${one.title}" has come up in ${one.count} separate sessions. Its fix each time: ${one.fix} Ask me with a question dialog whether to make it a rule. If yes, draft the change that prevents it (the AGENTS.md line or skill step, at the closest authority AGENTS.md allows) and show me the diff for review by the owners (${OWNERS}); do not commit.`,
    })
  } else if (recurring.length > 1) {
    items.push({
      kind: 'rule',
      ruleIds: recurring.map(one => one.id),
      id: `rule:${recurring.map(one => one.id).join('+')}`,
      label: 'Turn repeated problems into rules?',
      title: `${recurring.length} problems keep coming back: make them rules?`,
      question: `${recurring.length} problems have each come up in 3 or more sessions`,
      prompt: `These traps keep coming back, each in several separate sessions: ${recurring.map((one, index) => `(${index + 1}) "${one.title}", ${one.count} sessions; its fix each time: ${one.fix}`).join(' ')} Ask me in one question dialog (multiSelect, one option per trap, labels short enough to stand alone) which to make rules. For each I pick, draft the change that prevents it (the AGENTS.md line or skill step, at the closest authority AGENTS.md allows) and show me the diffs for review by the owners (${OWNERS}); do not commit.`,
    })
  }
  const open = items.filter(one => !input.sent.includes(one.id))
  // Work handed to the session in this session (an issue being started) leaves the list.
  const work = workList(intents, input.issues, me, input.area, now, role, prs).filter(one => !input.sent.includes(one.id))
  const step = nextStep(role, intent, evidence, input.workers, me, prs)
  const lastWork = work.find(one => one.kind === 'intent' && one.slug === input.last && one.isMine)
  /** @type {Next | undefined} */
  let next
  const isLostOpen = open.some(one => one.kind === 'lost')
  if (isLostOpen) next = undefined
  else if (isNewcomer && !intent) next = { id: 'next:tour', label: 'Take the tour', hint: 'Six short steps. Ends with your first intent started.', prompt: TOUR_PROMPT, isTour: true }
  // A tech artist with PIE proven has one proof left that only they can give: their own Editor check.
  else if (intent && stage === 'prove' && role === 'techart' && evidence.pie.state === 'pass' && evidence.editor.state !== 'pass') next = { id: `next:${intent.slug}:checked`, label: 'I checked it in the Editor', hint: 'PIE proof ✓ · your own Editor check is the last proof.', prompt: '', action: 'checked' }
  else if (intent && step) next = { id: `next:${intent.slug}:${step.key}`, ...step }
  // Nothing tracked in this session: offer to continue the intent the person last worked on.
  else if (!intent && lastWork) next = { id: lastWork.id, label: `Continue ${lastWork.label}`, hint: lastWork.hint, prompt: '', work: lastWork }
  else if (!intent && work[0]?.kind === 'intent') next = { id: work[0].id, label: `Pick up ${work[0].slug}`, hint: work[0].hint, prompt: '', work: work[0] }
  else if (!intent && work[0]?.kind === 'issue') next = { id: work[0].id, label: `Start issue #${work[0].issue.number}`, hint: `${work[0].issue.name} · ${work[0].hint}`, prompt: work[0].prompt, work: work[0] }
  else if (step) next = { id: 'next:start', ...step }
  // The quick actions under the header: start something new, or pick a skill from the short list.
  const present = new Map((input.skills ?? []).map(one => [one.name, one.description]))
  const skills = SKILL_GROUPS.flatMap(({ group, names }) =>
    names.filter(name => present.has(name)).map(name => ({ id: `skill:${name.split('/').pop()}`, group, name: name.split('/').pop() ?? name, description: present.get(name) ?? '', prompt: skillPrompt(name, intent ? `for intent ${intent.slug}` : '') })),
  )
  // The Editor's state decides what the session does first when making something there.
  const editor = { isHeld: lock.state === 'held' && !lock.isStale, isFree: lock.state === 'free', holder: lock.holder, until: lock.until }
  const order = CREATE_ORDER[/** @type {keyof typeof CREATE_ORDER} */ (role)] ?? CREATE_ORDER.designer
  const create = [...CREATE_GROUPS]
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
    .map(({ group, items }) => ({ group, items: items.filter(item => present.has(item.name)).map(item => ({ id: `create:${item.name.split('/').pop()}`, name: item.name.split('/').pop() ?? item.name, verb: item.verb, description: present.get(item.name) ?? '', prompt: createPrompt(item.verb, item.name, editor) })) }))
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
      title: intent?.slug ?? 'Ather',
      // A checklist with nothing done and no one working yet is planned, not being built.
      stage: !intent ? '' : stage === 'build' && intent.acceptanceDone === 0 && !intent.hasWorker && input.workers === 0 ? 'Planned' : STAGE_LABELS[stage],
      progress: intent && intent.acceptanceTotal > 0 ? `${intent.acceptanceDone} of ${intent.acceptanceTotal} done` : '',
      track: intent ? stageTrack(stage) : '',
      stages: intent ? stageList(stage) : [],
      proof: proofText(evidence),
      done: intent?.acceptanceDone ?? 0,
      total: intent?.acceptanceTotal ?? 0,
      sentence: away.phase === 'review' || isNewcomer ? '' : open.length > 0 ? 'waiting on you' : input.workers > 0 ? 'agents working' : intent ? '' : 'no intent yet',
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

const PROOF_WORDS = { build: 'build', automation: 'tests', readback: 'read-back', pie: 'PIE', editor: 'Editor check' }

// "build ✓ · tests ✗": the proof seen so far, so a failed test is never hidden.
/** @param {import('./model.mjs').Evidence} evidence */
const proofText = evidence =>
  Object.entries(PROOF_WORDS)
    .filter(([rung]) => evidence[/** @type {keyof typeof evidence} */ (rung)].state !== 'none')
    .map(([rung, word]) => `${word} ${evidence[/** @type {keyof typeof evidence} */ (rung)].state === 'pass' ? '✓' : '✗'}`)
    .join(' · ')
