// @ts-check
// Intent completion from one source each (.agents/skills/intent/SKILL.md): ids in prompt.md,
// verdicts in progress.md's Acceptance table, PRs on progress.md's "- PR:" line.
// Namespace imports, so a missing export fails its own test rather than the whole file.
import fs from 'node:fs'

import { describe, expect, test } from 'claude-code/testing'

import * as changes from '../hooks/changes.mjs'
import * as prs from '../hooks/prs.mjs'
import * as model from '../hooks/model.mjs'
import * as state from '../hooks/state.mjs'

const ME = 'Tin Nguyen'
const IDS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']

/** @param {string} acceptance @param {string} [status] */
const promptOf = (acceptance, status = 'active') => `# Board\n\n- Status: ${status}\n- Area: Tools\n- Owner: ${ME}\n\n## Goal\n\nA board.\n\n## Acceptance\n\n${acceptance}\n\n## Decisions\n\n- D1: none.\n`
/** @param {readonly (readonly [string, string])[]} rows @param {string} [pr] */
const progressOf = (rows, pr = '- PR: #32372') =>
  `# Board: Progress\n\n- Working under rev: 1\n${pr}\n\n## Acceptance\n\n| Item | Verdict | Evidence |\n| --- | --- | --- |\n${rows.map(([id, verdict]) => `| ${id} | ${verdict} | proof/${id}.png |`).join('\n')}\n\n## Steps\n\n- PR #99999 mentioned in a step, not the header.\n`
/** @param {string} prompt @param {string} progress */
const parsed = (prompt, progress) => model.parseIntent({ slug: 'board', prompt, findings: '', progress, files: [], hasDebrief: false, updatedAt: 1, source: 'local', firstAuthor: '' })

// The new format: ids with their proof, no boxes; sub-bullets belong to the item above.
const NEW_PROMPT = promptOf(IDS.map(id => `- ${id}: Thing ${id}. Proof: tests.\n  - a detail, not an item`).join('\n'))
const ALL_MET = progressOf(IDS.map(id => [id, 'met']))

describe('acceptance from one source', () => {
  test('ids without boxes and a progress table with every row met read 6/6', () => {
    const intent = parsed(NEW_PROMPT, ALL_MET)
    expect([intent.acceptanceDone, intent.acceptanceTotal]).toEqual([6, 6])
    expect(model.intentLabel(intent, ME)).toContain('6/6')
  })

  test('a legacy intent with boxes and no table counts its boxes, as before', () => {
    const legacy = promptOf('- [x] A1: Snow look.\n- [ ] A2: Sand look.\n  - [x] a ticked sub-item counts too, as it always did')
    expect([parsed(legacy, '').acceptanceDone, parsed(legacy, '').acceptanceTotal]).toEqual([2, 3])
    // A progress.md without an Acceptance table leaves the boxes in charge.
    const noTable = '# P\n\n- PR: none yet\n\n## Steps\n\n| Item | Verdict |\n| --- | --- |\n| A1 | open |\n'
    expect(parsed(legacy, noTable).acceptanceDone).toBe(2)
  })

  test('once a table exists it decides, even where prompt.md still has boxes', () => {
    const boxed = promptOf(IDS.map(id => `- [ ] ${id}: Thing ${id}.`).join('\n'))
    expect(parsed(boxed, ALL_MET).acceptanceDone).toBe(6)
  })

  test('a row for an id prompt.md does not list is ignored', () => {
    const progress = progressOf([['B1', 'met'], ['B2', 'open'], ['Z9', 'met'], ['B9', 'met']])
    const intent = parsed(promptOf('- B1: One.\n- B2: Two.'), progress)
    expect([intent.acceptanceDone, intent.acceptanceTotal]).toEqual([1, 2])
  })

  test('a verdict counts as met by its leading word: met, pass, passed, done, ✓ or ✅; a missing row is open', () => {
    const prompt = promptOf(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'].map(id => `- ${id}: x.`).join('\n'))
    const progress = progressOf([['A1', 'met on main (#1)'], ['A2', 'Pass'], ['A3', '**Done**'], ['A4', '✓'], ['A5', 'not done'], ['A6', 'partly done'], ['A7', 'metric pending'], ['A8', 'PASSED'], ['A9', '✅ S6']])
    expect(model.acceptanceItems(prompt, progress).map(item => item.isDone)).toEqual([true, true, true, true, false, false, false, true, true, false])
  })

  test('the verdict column is found by its heading; an id leads a longer Item cell', () => {
    const progress = '# P\n\n## Acceptance evidence\n\n| Item | Status | Evidence |\n| --- | --- | --- |\n| B1 model and builder | met | S1 |\n| B2 tab | met (PR #32372, not merged) | S6 |\n'
    expect(parsed(promptOf('- [ ] B1: Model.\n- [ ] B2: Tab.'), progress).acceptanceDone).toBe(2)
  })

  test('items added under a later "## Acceptance, rev 2" heading count too', () => {
    const prompt = `${promptOf('- SL1: One.')}\n## Acceptance, rev 2 (L-3)\n\n- SL15: Two.\n`
    const intent = parsed(prompt, progressOf([['SL1', 'Pass'], ['SL15', 'passed']]))
    expect([intent.acceptanceDone, intent.acceptanceTotal]).toEqual([2, 2])
  })

  test('ids with no table and no boxes are all open, not "no checklist"', () => {
    const intent = parsed(NEW_PROMPT, '')
    expect([intent.acceptanceDone, intent.acceptanceTotal]).toEqual([0, 6])
  })
})

// The older intents of this repository write the section as a table: | Id | Item | Proof |.
/** @param {readonly (readonly [string, string])[]} rows */
const tableOf = rows => `| Id | Item | Proof |\n| --- | --- | --- |\n${rows.map(([id, item]) => `| ${id} | ${item} | Unit. |`).join('\n')}`

describe('acceptance written as a table', () => {
  test('ids and texts in order, verdicts from progress.md, and a row progress.md does not list is open', () => {
    const prompt = promptOf(tableOf([['A1', 'Calls recorded per loop.'], ['A12a', 'A `long` call is never idle.'], ['A2', 'Tree: children under their parent.']]))
    expect(model.acceptanceItems(prompt, progressOf([['A1', 'met'], ['A12a', 'open']]))).toEqual([
      { id: 'A1', text: 'Calls recorded per loop.', isDone: true },
      { id: 'A12a', text: 'A `long` call is never idle.', isDone: false },
      { id: 'A2', text: 'Tree: children under their parent.', isDone: false },
    ])
    const intent = parsed(prompt, progressOf([['A1', 'met'], ['A12a', 'met'], ['A2', 'met']]))
    expect([intent.acceptanceDone, intent.acceptanceTotal]).toEqual([3, 3])
    expect(parsed(prompt, '').acceptanceTotal).toBe(3)
  })

  test('a list, and a list with a table beside it, are read as the list', () => {
    const list = '- B1: One. Proof: tests.\n- B2: Two.'
    const progress = progressOf([['B1', 'met'], ['T1', 'met']])
    const alone = model.acceptanceItems(promptOf(list), progress)
    expect(alone).toEqual([{ id: 'B1', text: ': One. Proof: tests.', isDone: true }, { id: 'B2', text: ': Two.', isDone: false }])
    expect(model.acceptanceItems(promptOf(`${list}\n\n${tableOf([['T1', 'From the table.'], ['B2', 'Two, again.']])}`), progress)).toEqual(alone)
    // Legacy boxes are a list too, with or without ids.
    const boxes = '- [x] Snow look.\n- [ ] Sand look.'
    expect(model.acceptanceItems(promptOf(`${boxes}\n\n${tableOf([['T1', 'From the table.']])}`), '')).toEqual(model.acceptanceItems(promptOf(boxes), ''))
  })

  test('the header row, the rule row and a table with no id in its first cell give no items', () => {
    expect(model.acceptanceItems(promptOf(tableOf([])), ALL_MET)).toEqual([])
    expect(model.acceptanceItems(promptOf('| Build | Platform | Result |\n| --- | --- | --- |\n| Editor | Win64 | Pass |\n| second A1 | Linux | Pass |'), ALL_MET)).toEqual([])
    expect(parsed(promptOf(tableOf([])), '').acceptanceTotal).toBe(0)
  })

  test("this repository's four intents written as tables read with the number of rows their tables have", () => {
    for (const slug of ['crew-tree-and-groups', 'decide-in-place', 'team-truth', 'multi-repo']) {
      const read = (/** @type {string} */ name) => fs.readFileSync(new URL(`../../docs/intent/${slug}/${name}`, import.meta.url), 'utf8')
      const prompt = read('prompt.md')
      // The section's table lines, less its header row and its rule row.
      const rows = model.section(prompt, 'Acceptance').split(/\r?\n/).filter(line => line.startsWith('|')).length - 2
      const items = model.acceptanceItems(prompt, read('progress.md'))
      expect(rows > 0).toBe(true)
      expect(items.length).toBe(rows)
      expect(new Set(items.map(item => item.id)).size).toBe(rows)
      expect(items.every(item => item.text !== '')).toBe(true)
    }
  })
})

describe('the PRs an intent names', () => {
  test('from the header "- PR:" line of progress.md, then a legacy one in prompt.md', () => {
    expect(model.intentPrs('# P\n\n- PR: #32372, #32398\n\n## Steps\n\n- PR: #1\n', '')).toEqual([32372, 32398])
    expect(model.intentPrs('# P\n\n- PR: none yet\n', '# X\n\n- PRs: sipherxyz/s2#5 and https://github.com/o/r/pull/6\n  - PR-A: stacked on #7\n')).toEqual([5, 6])
    expect(model.intentPrs('', '')).toEqual([])
  })

  test("gh's answer is read for state only, and anything else is unreadable", () => {
    expect(prs.parsePrState('{"mergedAt":"2026-10-04T01:31:16Z","state":"MERGED"}')).toBe('MERGED')
    expect(prs.parsePrState('{"mergedAt":null,"state":"OPEN"}')).toBe('OPEN')
    expect(prs.parsePrState('[{"number":1}]')).toBe(null)
    expect(prs.parsePrState('gh: not found')).toBe(null)
  })

  test('only the PRs of open intents with every item met are read, a merged one never again', () => {
    const ready = parsed(NEW_PROMPT, progressOf(IDS.map(id => [id, 'met']), '- PR: #1, #2, #3'))
    const building = parsed(NEW_PROMPT, progressOf([['B1', 'met']], '- PR: #4'))
    const closed = parsed(promptOf('- B1: x.', 'completed'), progressOf([['B1', 'met']], '- PR: #5'))
    const now = 10 * prs.PR_EVERY_MS
    const records = { 1: { state: 'MERGED', at: 0 }, 2: { state: 'OPEN', at: now - 1000 }, 3: { state: 'UNREAD', at: now - prs.PR_EVERY_MS } }
    expect(prs.prsToRead([ready, building, closed], records, now)).toEqual([3])
  })
})

describe('ready to close', () => {
  const ready = parsed(NEW_PROMPT, ALL_MET)
  const MERGED = { 32372: 'MERGED' }

  test('every item met, every PR merged and Status active: Ready to close, offered as an action', () => {
    expect(model.currentStage(ready, model.emptyEvidence(), 'engineer', MERGED)).toBe('close')
    const step = model.nextStep('engineer', ready, model.emptyEvidence(), 0, ME, MERGED)
    expect(step?.key).toBe('close')
    expect(step?.prompt).toContain('.agents/skills/intent/SKILL.md')
    expect(step?.prompt).toContain('Status: completed')
    expect(model.intentLabel(ready, ME, MERGED)).toContain('ready to close')
    expect(model.prStatusList(parsed(NEW_PROMPT, progressOf([], '- PR: #1, #2, #3')), { 1: 'MERGED', 2: 'UNREAD' })).toEqual(['#1 MERGED', '#2 could not be read', '#3 not read yet'])
  })

  test('not while a PR is open or unread, nor with no PR named; a Status of completed wins', () => {
    expect(model.currentStage(ready, model.emptyEvidence(), 'engineer', { 32372: 'OPEN' })).toBe('prove')
    expect(model.currentStage(ready, model.emptyEvidence(), 'engineer', {})).toBe('prove')
    expect(model.currentStage(parsed(NEW_PROMPT, progressOf(IDS.map(id => [id, 'met']), '- PR: none yet')), model.emptyEvidence(), 'engineer', MERGED)).toBe('prove')
    expect(model.currentStage(parsed(promptOf(IDS.map(id => `- ${id}: x.`).join('\n'), 'completed'), ALL_MET), model.emptyEvidence(), 'engineer', MERGED)).toBe('ship')
  })

  test("someone else's ready intent is only followed", () => {
    expect(model.nextStep('engineer', ready, model.emptyEvidence(), 0, 'Minh Tran', MERGED)?.key).toBe('follow')
  })
})

describe('what an edit to progress.md recorded', () => {
  test('a row turned met is one "Met" line, titled from prompt.md', () => {
    const before = progressOf([['B1', 'open'], ['B2', 'open']])
    const after = progressOf([['B1', 'met'], ['B2', 'open']])
    expect(changes.intentChanges('progress.md', before, after, { prompt: promptOf('- B1 (slice 1): Model and builder. Proof: tests.\n- B2: Tab.') })).toEqual([{ kind: 'done', id: 'B1', text: 'Met B1 · Model and builder' }])
    expect(changes.intentFileOf('E:/S2_/docs/intent/board/progress.md')).toEqual({ slug: 'board', file: 'progress.md' })
  })

  test('with a table in charge, ticking a box in prompt.md records nothing done', () => {
    const before = promptOf('- [ ] B1: One.')
    expect(changes.intentChanges('prompt.md', before, before.replace('- [ ]', '- [x]'), { progress: progressOf([['B1', 'open']]) })).toEqual([])
  })
})

describe('PR states in the store', () => {
  test('what gh said is kept per PR, and records not read for a month are dropped', async () => {
    const store = new Map()
    const io = /** @type {any} */ ({ get: async (/** @type {string} */ key) => store.get(key), set: async (/** @type {string} */ key, /** @type {unknown} */ value) => void store.set(key, value), redraw: () => undefined })
    const month = 30 * 24 * 60 * 60 * 1000
    await state.setPrStates(io, { 1: 'MERGED' }, 0)
    await state.setPrStates(io, { 2: 'OPEN' }, month - 1)
    expect(await state.readPrStates(io)).toEqual({ 1: 'MERGED', 2: 'OPEN' })
    await state.setPrStates(io, { 3: 'UNREAD' }, month + 1)
    expect(await state.readPrStates(io)).toEqual({ 2: 'OPEN', 3: 'UNREAD' })
  })
})
