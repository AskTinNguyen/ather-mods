// Ather Automata: what an edit to an intent changed, in one plain line each. Three kinds only:
// done (an acceptance item met), yours (a decision now waiting on the person), changed (the
// goal, the scope, or a decision taken). Notes and log entries are the detail behind these and
// are not listed. Pure: no `$`.

import { acceptanceItems, parseFindings, section, shortTitle } from './model.mjs'

/** @typedef {{ kind: 'done' | 'yours' | 'changed', id: string, text: string }} Change */
/** @typedef {'prompt.md' | 'findings.md' | 'progress.md'} IntentFile */

// The acceptance items with an id, read the way the pane counts them (model.mjs acceptanceItems):
// "A12 (proof…): Ice tracks keep their depth. More…" → { A12: { isDone, title: 'Ice tracks keep their depth' } }
/** @param {string} prompt @param {string} progress */
const checklist = (prompt, progress) => {
  /** @type {Map<string, { isDone: boolean, title: string }>} */
  const items = new Map()
  for (const item of acceptanceItems(prompt, progress)) {
    if (item.id === '') continue
    const words = item.text.replace(/^\([^)]*\)\s*/, '').replace(/^[:.\-–—]\s*/, '')
    items.set(item.id, { isDone: item.isDone, title: shortTitle(/^(.+?)[.:](\s|$)/.exec(words)?.[1] ?? words, 48) })
  }
  return items
}

// Items that went from open to done, as "<verb> A2 · Sand look".
/** @param {Map<string, { isDone: boolean, title: string }>} was @param {Map<string, { isDone: boolean, title: string }>} now @param {string} verb @returns {Change[]} */
const newlyDone = (was, now, verb) => [...now].filter(([id, item]) => item.isDone && was.get(id)?.isDone === false).map(([id, item]) => ({ kind: /** @type {const} */ ('done'), id, text: `${verb} ${id} · ${item.title}` }))

const SCOPE_HEADINGS = ['Scope', 'Out of scope', 'Non-goals', 'Constraints']
/** @param {string} text */
const plain = text => text.replace(/\s+/g, ' ').trim()

// A ticked legacy box reads "Ticked"; once progress.md has its table, prompt.md edits change no verdict.
/** @param {string} before @param {string} after @param {string} progress @returns {Change[]} */
const promptChanges = (before, after, progress) => {
  const changes = newlyDone(checklist(before, progress), checklist(after, progress), 'Ticked')
  if (before !== '' && plain(section(before, 'Goal')) !== plain(section(after, 'Goal'))) changes.push({ kind: 'changed', id: 'goal', text: 'Goal changed' })
  if (before !== '' && SCOPE_HEADINGS.some(heading => plain(section(before, heading)) !== plain(section(after, heading)))) changes.push({ kind: 'changed', id: 'scope', text: 'Scope changed' })
  return changes
}

/** @param {string} before @param {string} after @param {string} prompt @returns {Change[]} */
const findingChanges = (before, after, prompt) => {
  /** @type {Change[]} */
  const changes = []
  const wasOpen = new Map(parseFindings(before, prompt).map(one => [one.id, one]))
  const isOpen = new Map(parseFindings(after, prompt).map(one => [one.id, one]))
  for (const [id, one] of isOpen) {
    const isNew = !new RegExp(`^##\\s+${id}\\b`, 'm').test(before)
    if (isNew && one.isDirectorCall) changes.push({ kind: 'yours', id, text: `New decision ${id} · yours` })
  }
  for (const [id, one] of wasOpen) {
    if (!isOpen.has(id) && new RegExp(`^##\\s+${id}\\b`, 'm').test(after)) changes.push({ kind: 'changed', id, text: `Decided ${id} · ${shortTitle(one.title, 40)}` })
  }
  return changes
}

// What one edit to an intent file changed. `intent` holds the intent's other files as they are now:
// findings and progress rows are read against prompt.md (a decision recorded there closes its
// finding; its ids name the rows), prompt.md against progress.md (its table says what is met).
/** @param {IntentFile} file @param {string} before @param {string} after @param {{ prompt?: string, progress?: string }} [intent] @returns {Change[]} */
export const intentChanges = (file, before, after, intent = {}) => {
  if (before === after) return []
  if (file === 'prompt.md') return promptChanges(before, after, intent.progress ?? '')
  if (file === 'progress.md') return newlyDone(checklist(intent.prompt ?? '', before), checklist(intent.prompt ?? '', after), 'Met')
  return findingChanges(before, after, intent.prompt ?? '')
}

// The intent file an edit touches: its folder name and which file, or null for anything else.
/** @param {unknown} path @returns {{ slug: string, file: IntentFile } | null} */
export const intentFileOf = path => {
  const match = typeof path === 'string' ? /docs[\\/]intent[\\/]([^\\/]+)[\\/](prompt|findings|progress)\.md$/i.exec(path) : null
  return match ? { slug: match[1], file: /** @type {IntentFile} */ (`${match[2].toLowerCase()}.md`) } : null
}

// The intent a session's own orchestration writes: its prompt.md or log.md (the orchestrator's files,
// .agents/skills/intent/SKILL.md), as its folder name and which file; null for anything else.
/** @param {unknown} path @returns {{ slug: string, file: 'prompt.md' | 'log.md' } | null} */
export const orchestrationFileOf = path => {
  const match = typeof path === 'string' ? /docs[\\/]intent[\\/]([^\\/]+)[\\/](prompt|log)\.md$/i.exec(path) : null
  return match ? { slug: match[1], file: match[2].toLowerCase() === 'prompt' ? 'prompt.md' : 'log.md' } : null
}

/** @param {Change['kind']} kind */
export const changeGlyph = kind => (kind === 'done' ? '✓' : kind === 'yours' ? '◆' : '✎')
