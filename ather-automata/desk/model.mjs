// @ts-check
// Ather Automata: the decision desk. Every director call waiting on the owner in the checkouts a run
// names, as one page's data (deskOf), and what a session records of the page's answers (planOf).
// Pure: no `$`, no Node. The intents come parsed (model.mjs parseIntent); what a call is and what an
// answer hands a session are the pane's own (directorCalls, findingAnswers), so the desk and the pane
// never disagree.

import { findingAnswers } from '../hooks/decide.mjs'
import { directorCalls } from '../hooks/model.mjs'

/**
 * A checkout as read from its base branch.
 * @typedef {{ name: string, url: string, base: string, sha: string, intents: readonly import('../hooks/model.mjs').Intent[] }} Checkout
 * `name`: the repository's short name; `url`: its web address ('' when origin is not on GitHub); `sha`: the base commit read
 * @typedef {{ letter: string, label: string, text: string, isRecommended: boolean }} DeskOption
 * @typedef {{ id: string, repo: string, slug: string, intent: string, owner: string, updatedAt: number,
 *   finding: string, question: string, isBlocking: boolean, options: DeskOption[], source: string, link: string }} DeskItem
 * `id`: `<repo>/<slug>/<finding>`, the key of its answer; `question`: the finding's heading, whole; `source`: the finding as written
 * @typedef {{ name: string, url: string, base: string, sha: string, intents: number, waiting: number }} DeskRepo
 * @typedef {{ version: 1, at: number, repos: DeskRepo[], items: DeskItem[] }} Desk
 * @typedef {'answered' | 'recorded' | 'withdrawn'} AnswerState
 * @typedef {{ id: string, repo: string, slug: string, finding: string, question: string, choice: string, words: string, state: AnswerState, at: number, by?: string, pr?: string }} Answer
 * One `answers` document of the page's db. `choice`: an option's letter, or '' for `words`, the owner's own answer
 */

// "F-3" before "F-10"; ids without a number keep their order.
/** @param {string} id */
const findingNumber = id => Number(/\d+/.exec(id)?.[0] ?? Number.MAX_SAFE_INTEGER)

/** @param {Checkout} checkout @param {string} slug */
const findingsLink = (checkout, slug) => (checkout.url ? `${checkout.url}/blob/${checkout.base}/docs/intent/${slug}/findings.md` : '')

// The desk's data: each checkout's open director calls, blocking ones first, then the intents changed
// most recently, then by finding number. Repositories keep the order the run named them in.
/** @param {readonly Checkout[]} checkouts @param {number} at @returns {Desk} */
export const deskOf = (checkouts, at) => {
  /** @type {DeskItem[]} */
  const items = []
  const repos = checkouts.map(checkout => {
    const open = checkout.intents.filter(intent => intent.status !== 'completed')
    const calls = open.flatMap(intent =>
      directorCalls(intent).map(finding => ({
        id: `${checkout.name}/${intent.slug}/${finding.id}`,
        repo: checkout.name,
        slug: intent.slug,
        intent: intent.title,
        owner: intent.owner,
        updatedAt: intent.updatedAt,
        finding: finding.id,
        question: finding.full,
        isBlocking: finding.isBlocking,
        options: finding.options.map(({ letter, label, text, isRecommended }) => ({ letter, label, text, isRecommended })),
        source: finding.source,
        link: findingsLink(checkout, intent.slug),
      })),
    )
    calls.sort((a, b) => Number(b.isBlocking) - Number(a.isBlocking) || b.updatedAt - a.updatedAt || a.slug.localeCompare(b.slug) || findingNumber(a.finding) - findingNumber(b.finding))
    items.push(...calls)
    return { name: checkout.name, url: checkout.url, base: checkout.base, sha: checkout.sha, intents: open.length, waiting: calls.length }
  })
  return { version: 1, at, repos, items }
}

// ---------------------------------------------------------------- recording the answers

/**
 * @typedef {{ id: string, slug: string, finding: string, answer: string, prompt: string }} ToRecord `answer`: what was chosen, as the PR names it
 * @typedef {{ repo: string, url: string, base: string, decisions: ToRecord[] }} RepoPlan
 * @typedef {{ id: string, why: string }} Skipped
 * @typedef {{ record: RepoPlan[], settled: string[], waiting: string[], ask: Skipped[] }} Plan
 * `record`: what a session records now, per repository; `settled`: answered or recorded, and the base branch reads the finding
 * closed; `waiting`: recorded, its PR not merged yet; `ask`: answers that cannot be recorded as they stand, and why
 */

// What a session records of the page's answers against a fresh desk (D4). An answer is recorded once:
// `recorded` ones wait for their PR, `withdrawn` ones are left alone, and one whose finding the base
// branch no longer lists is settled. A letter that is no longer among the finding's options (the
// finding was rewritten) is asked again rather than guessed.
/** @param {Desk} desk @param {readonly Answer[]} answers @returns {Plan} */
export const planOf = (desk, answers) => {
  const items = new Map(desk.items.map(item => [item.id, item]))
  /** @type {Map<string, RepoPlan>} */
  const record = new Map()
  /** @type {Plan} */
  const plan = { record: [], settled: [], waiting: [], ask: [] }
  for (const answer of answers) {
    if (answer.state === 'withdrawn') continue
    const item = items.get(answer.id)
    if (!item) {
      plan.settled.push(answer.id)
      continue
    }
    if (answer.state === 'recorded') {
      plan.waiting.push(answer.id)
      continue
    }
    const offered = findingAnswers(item.slug, { id: item.finding, options: item.options })
    const words = answer.words.trim()
    const option = offered.options.find(one => one.letter === answer.choice)
    if (answer.choice !== '' && !option) {
      plan.ask.push({ id: answer.id, why: `option ${answer.choice} is no longer one of ${item.finding}'s options` })
      continue
    }
    if (!option && words === '') {
      plan.ask.push({ id: answer.id, why: 'the answer names no option and has no words' })
      continue
    }
    const repo = desk.repos.find(one => one.name === item.repo)
    const entry = record.get(item.repo) ?? { repo: item.repo, url: repo?.url ?? '', base: repo?.base ?? 'main', decisions: [] }
    entry.decisions.push({ id: item.id, slug: item.slug, finding: item.finding, answer: option ? `${option.letter}: ${option.label}` : `"${words}"`, prompt: option ? option.prompt : offered.typed(words) })
    record.set(item.repo, entry)
  }
  // Repositories in the desk's order.
  plan.record = desk.repos.map(repo => record.get(repo.name)).filter(entry => entry !== undefined)
  return plan
}

// The plan as the desk skill reads it: per repository, each decision and the prompt it is recorded with.
/** @param {Plan} plan */
export const planText = plan => {
  const lines = []
  if (plan.record.length === 0) lines.push('Nothing to record.')
  for (const repo of plan.record) {
    lines.push(`## ${repo.repo} (into ${repo.base})`, '')
    for (const one of repo.decisions) lines.push(`- ${one.id}: ${one.answer}`, `  Prompt: ${one.prompt}`)
    lines.push('')
  }
  if (plan.ask.length) lines.push('## Ask again', '', ...plan.ask.map(one => `- ${one.id}: ${one.why}`), '')
  if (plan.waiting.length) lines.push(`Recorded, PR not merged yet: ${plan.waiting.join(', ')}`)
  if (plan.settled.length) lines.push(`Settled on the base branch: ${plan.settled.join(', ')}`)
  return lines.join('\n').trimEnd()
}
