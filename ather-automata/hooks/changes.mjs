// @ts-check
// Ather Automata: what an edit to an intent changed, in one plain line each. Three kinds only:
// done (a checklist item ticked), yours (a decision now waiting on the person), changed (the
// goal, the scope, or a decision taken). Notes and log entries are the detail behind these and
// are not listed. Pure: no `$`.

import { parseFindings, section, shortTitle } from './model.mjs'

/** @typedef {{ kind: 'done' | 'yours' | 'changed', id: string, text: string }} Change */

// "- [x] A12 (proof…): Ice tracks keep their depth. More…" → { A12: { isDone, title } }
/** @param {string} prompt */
const checklist = prompt => {
  /** @type {Map<string, { isDone: boolean, title: string }>} */
  const items = new Map()
  for (const match of section(prompt, 'Acceptance').matchAll(/^\s*-\s*\[( |x|X)\]\s*(.+)$/gm)) {
    const line = match[2]
    const id = /^\**(A\d+[a-z]?)\b/.exec(line)?.[1]
    if (!id) continue
    const words = line.replace(/^\**A\d+[a-z]?\**\s*/, '').replace(/^\([^)]*\)\s*/, '').replace(/^[:.\-–—]\s*/, '')
    items.set(id, { isDone: match[1] !== ' ', title: shortTitle(/^(.+?)[.:](\s|$)/.exec(words)?.[1] ?? words, 48) })
  }
  return items
}

const SCOPE_HEADINGS = ['Scope', 'Out of scope', 'Non-goals', 'Constraints']
/** @param {string} text */
const plain = text => text.replace(/\s+/g, ' ').trim()

/** @param {string} before @param {string} after @returns {Change[]} */
const promptChanges = (before, after) => {
  /** @type {Change[]} */
  const changes = []
  const was = checklist(before)
  for (const [id, item] of checklist(after)) {
    if (item.isDone && was.get(id)?.isDone === false) changes.push({ kind: 'done', id, text: `Ticked ${id} · ${item.title}` })
  }
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

// What one edit to an intent file changed. `prompt` is the intent's prompt.md, which findings
// are read against (a decision recorded there closes its finding).
/** @param {'prompt.md' | 'findings.md'} file @param {string} before @param {string} after @param {string} [prompt] @returns {Change[]} */
export const intentChanges = (file, before, after, prompt = '') => (before === after ? [] : file === 'prompt.md' ? promptChanges(before, after) : findingChanges(before, after, prompt))

// The intent file an edit touches: its folder name and which file, or null for anything else.
/** @param {unknown} path @returns {{ slug: string, file: 'prompt.md' | 'findings.md' } | null} */
export const intentFileOf = path => {
  const match = typeof path === 'string' ? /docs[\\/]intent[\\/]([^\\/]+)[\\/](prompt|findings)\.md$/i.exec(path) : null
  return match ? { slug: match[1], file: /** @type {'prompt.md' | 'findings.md'} */ (`${match[2].toLowerCase()}.md`) } : null
}

/** @param {Change['kind']} kind */
export const changeGlyph = kind => (kind === 'done' ? '✓' : kind === 'yours' ? '◆' : '✎')
