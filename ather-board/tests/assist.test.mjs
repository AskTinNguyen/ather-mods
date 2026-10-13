// @ts-check
// Ather Board's help (rev 2): For you and the board's own suggestions (A10), each intent's next action and
// the prompt every action hands the session (A11), and the brief and the ask box's requests and the
// checking of their replies (A12, A13). The intents are made up here; none is S2's.
import { describe, expect, test } from 'claude-code/testing'

import { unreal } from '../hooks/ather/packs/unreal.mjs'
import { ACTION_KINDS, actionPrompt, actionsFor, batchPrompt, decisionPrompt, nextAction } from '../hooks/act.mjs'
import { MODEL, answerLook, askRequest, briefRequest, digest, parseAnswer, parseBrief } from '../hooks/brief.mjs'
import { isMine } from '../hooks/ather/model.mjs'
import { forYou, mergeSuggestions, plainSuggestions } from '../hooks/focus.mjs'
import { toRecord } from '../hooks/records.mjs'
import { DAY_MS } from '../hooks/views.mjs'

const NOW = Date.UTC(2026, 9, 13, 12)
const ME = 'TinNguyen'

/** @param {{ title: string, status: string, owner: string, items?: string[] }} head */
const prompt = ({ title, status, owner, items = [] }) =>
  [`# ${title}`, '', `- Status: ${status}`, '- Area: Combat', `- Owner: ${owner}`, '', '## Goal', '', `${title} for the team.`, '', ...(items.length ? ['## Acceptance', '', ...items.map((text, index) => `- A${index + 1}: ${text}`), ''] : [])].join('\n')
/** @param {string[]} verdicts */
const progress = verdicts => ['# Progress', '', '## Acceptance', '', '| Item | Verdict |', '| --- | --- |', ...verdicts.map((verdict, index) => `| A${index + 1} | ${verdict} |`), ''].join('\n')
const CALL = '## F-2 (2026-10-10, rev 1) | blocking: yes | status: open (director)\n\nWhich hit stop? Options: (a) short; (b) long. Recommendation: (b).\n'

/** @param {string} slug @param {{ prompt: string, progress?: string, findings?: string, age: number }} files */
const record = (slug, files) => toRecord({ slug, prompt: files.prompt, progress: files.progress ?? '', findings: files.findings ?? '', files: [], hasDebrief: false, updatedAt: NOW - files.age * DAY_MS, source: 'main', firstAuthor: '' }, { pack: unreal, createdAt: 0, now: NOW })

const RECORDS = [
  record('hit-stop', { prompt: prompt({ title: 'Hit stop', status: 'active', owner: 'Tin Nguyen', items: ['Stop.', 'Proof.'] }), progress: progress(['met', 'open']), findings: CALL, age: 3 }),
  record('dodge-roll', { prompt: prompt({ title: 'Dodge roll', status: 'active', owner: 'Tin Nguyen', items: ['Roll.'] }), progress: progress(['met']), age: 1 }),
  record('old-camera', { prompt: prompt({ title: 'Old camera', status: 'active', owner: 'Tin Nguyen', items: ['Cam.'] }), progress: progress(['open']), age: 9 }),
  record('parry', { prompt: prompt({ title: 'Parry', status: 'active', owner: 'Tin Nguyen', items: ['Parry.'] }), progress: progress(['open']), age: 1 }),
  record('boss-ai', { prompt: prompt({ title: 'Boss AI', status: 'active', owner: 'Hao Than', items: ['Think.'] }), progress: progress(['open']), findings: CALL, age: 6 }),
]
/** @param {string} slug */
const one = slug => RECORDS.find(r => r.slug === slug) ?? RECORDS[0]

describe('next action and actions in place (A11)', () => {
  test('the owner’s next action follows the worst flag: decide, close, unstick; nothing needed is Where it stands', () => {
    expect(['hit-stop', 'dodge-roll', 'old-camera', 'parry'].map(slug => nextAction(one(slug), true))).toEqual(['decide', 'close', 'unstick', 'about'])
  })
  test('a teammate’s intent that needs someone offers asking its owner, never their decisions', () => {
    expect(actionsFor(one('boss-ai'), false)).toEqual(['ping', 'about'])
    expect(actionsFor(one('boss-ai'), true)).toEqual(['decide', 'unstick', 'about'])
  })
  test('every action’s prompt names the intent; the writing ones work in the checkout and ask first', () => {
    for (const kind of ACTION_KINDS) expect(actionPrompt(kind, one('hit-stop'), 'main')).toContain('hit-stop')
    expect(actionPrompt('close', one('dodge-roll'), 'main')).toContain('add the changelog line, and show me the diff before committing as the skill says.')
    expect(actionPrompt('close', one('dodge-roll'), 'main')).toContain('if it is missing or behind origin/main, say so and stop')
    expect(actionPrompt('ping', one('boss-ai'), 'main')).toContain('do not send it')
  })
  test('a decision answered in place uses Ather’s own wording; Explain decides nothing', () => {
    const call = one('hit-stop').calls[0]
    expect(call?.options.map(option => `${option.letter}${option.isRecommended ? '*' : ''}`)).toEqual(['A', 'B*'])
    if (!call) return
    expect(decisionPrompt(one('hit-stop'), call, 'B')).toMatch(/^Decide F-2 on hit-stop: B — Long\. Record it as the intent skill's decision step says/)
    expect(decisionPrompt(one('hit-stop'), call, '')).toMatch(/^Explain decision F-2 on hit-stop: .*do not decide or change anything\.$/)
  })
  test('one action over several intents: each one’s own prompt, numbered, in turn', () => {
    const text = batchPrompt('close', [one('dodge-roll'), one('hit-stop')], 'main')
    expect(text).toMatch(/^Take these 2 intents one at a time/)
    expect(text).toContain('1. Close intent dodge-roll')
    expect(text).toContain('2. Close intent hit-stop')
  })
})

describe('For you (A10)', () => {
  test('the person’s open intents, grouped by what each needs from them, worst first, then the rest', () => {
    const [needs, rest] = forYou(RECORDS, ME)
    expect(needs?.kind === 'label' && needs.groups.map(group => `${group.title}: ${group.rows.map(row => row.record.slug).join(',')}`)).toEqual(['Waiting on your decision: hit-stop', 'Ready for you to close: dodge-roll', 'Stuck: old-camera'])
    expect(rest?.kind === 'label' && [rest.title, rest.groups[0]?.rows.map(row => row.record.slug)]).toEqual(['Your other open work', ['parry']])
  })
  test('a teammate’s intents are not the person’s: names match as Ather matches them (model.mjs isMine)', () => {
    expect([isMine(one('hit-stop'), ME), isMine(one('boss-ai'), ME), isMine(one('hit-stop'), '')]).toEqual([true, false, false])
  })
  test('without a name, For you says how to give one', () => {
    const [only] = forYou(RECORDS, '')
    expect(only?.kind === 'label' && only.groups[0]?.empty).toMatch(/^Set git user\.name/)
  })
  test('the board’s own suggestions: close the ready ones, answer the oldest decision, see the teammates’ waiting', () => {
    expect(plainSuggestions(RECORDS, ME, NOW).map(s => `${s.action}: ${s.keys.join(',')} | ${s.title}`)).toEqual(['close: dodge-roll | Close dodge-roll', 'decide: hit-stop | Answer the decision on hit-stop', 'show: boss-ai | 1 teammates’ intents wait on a decision'])
  })
  test('the brief’s suggestions come first; the board’s own that say the same are left out', () => {
    const plain = plainSuggestions(RECORDS, ME, NOW)
    const fromBrief = [{ key: 'brief-0', title: 'Close dodge-roll now', why: '', action: /** @type {const} */ ('close'), keys: ['dodge-roll'] }]
    expect(mergeSuggestions(fromBrief, plain).map(s => s.key)).toEqual(['brief-0', 'decide-oldest', 'show-waiting'])
  })
})

describe('the brief and the ask box (A12, A13)', () => {
  test('the request: Sonnet, the person named, one line per open intent with its flags and decisions', () => {
    const request = briefRequest(RECORDS, ME, NOW)
    expect([request.model, MODEL]).toEqual(['sonnet', 'sonnet'])
    expect(request.prompt).toContain('The person at the keyboard is TinNguyen.')
    const line = digest(RECORDS, ME, NOW).split('\n').find(text => text.startsWith('hit-stop'))
    expect(line ?? '').toBe('hit-stop | Building | Combat | Tin Nguyen (me) | 1/2 met | changed 3d ago | flags: 1 decision waiting | decisions: F-2 Which hit stop? | Hit stop for the team')
  })
  test('a good reply: its headline and suggestions, unknown intents dropped, a suggestion with none left dropped', () => {
    const reply = '```json\n' + JSON.stringify({ headline: 'Two things.', suggestions: [{ title: 'Close it', why: 'All met.', action: 'close', intents: ['dodge-roll', 'ghost'] }, { title: 'Ghost', why: '', action: 'close', intents: ['ghost'] }, { title: 'Bad', why: '', action: 'delete', intents: ['parry'] }] }) + '\n```'
    const brief = parseBrief(reply, RECORDS, ME)
    expect(brief?.headline).toBe('Two things.')
    expect(brief?.suggestions.map(s => `${s.action}:${s.keys.join(',')}`)).toEqual(['close:dodge-roll'])
  })
  test('an owner’s action suggested on a teammate’s intent becomes a cut of the board', () => {
    const brief = parseBrief(JSON.stringify({ headline: '', suggestions: [{ title: 'Decide for Hao', why: '', action: 'decide', intents: ['boss-ai'] }] }), RECORDS, ME)
    expect(brief?.suggestions.map(s => s.action)).toEqual(['show'])
  })
  test('a broken or empty reply is no brief, and no answer', () => {
    expect([parseBrief('I could not do that.', RECORDS, ME), parseBrief('{"headline": ', RECORDS, ME), parseAnswer('[1, 2]', RECORDS)]).toEqual([null, null, null])
  })
  test('an answer: its words and a cut of the board, anything the board does not have left as it is', () => {
    const answer = parseAnswer(JSON.stringify({ answer: 'Combat waits on you.', view: 'kanban', area: 'Combat', owner: 'Nobody', stage: 'build', intents: ['hit-stop', 'ghost'] }), RECORDS)
    expect(answer).toEqual({ answer: 'Combat waits on you.', view: '', area: 'Combat', owner: '', stage: 'build', keys: ['hit-stop'] })
    if (answer) expect(answerLook(answer, 'foryou').view).toBe('table')
    expect(askRequest('what waits on me?', RECORDS, ME, NOW).prompt).toContain('Their question: what waits on me?')
  })
})
