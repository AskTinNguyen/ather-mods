// Tests for the calendar page's colours and daily figures. Run: node --test scripts/test
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIME, buildColors, dailySeries, paletteOf, renderHtml } from '../lib/render.mjs'
import { loadConfig } from '../lib/config.mjs'

const HOUR = 36e5
const monday = new Date(2026, 9, 5).getTime()
const at = (day, h) => monday + day * 24 * HOUR + h * HOUR
const block = (o) => ({ id: `${o.sessionId}:${o.start}`, project: 'p', taskType: 'Feature', excluded: false, automated: false, productive: false, noCommit: false, ...o })

test('the top group takes the lime; the others take palette colours, never red', () => {
  for (const theme of ['dark', 'light']) {
    const colors = buildColors({ theme, colorBy: 'project' }, [{ project: 'a' }, { project: 'b' }, { project: 'c' }], [])
    assert.equal(colors.a.chip, theme === 'dark' ? LIME : '#a3bf00')
    assert.equal(colors.b.chip, paletteOf(theme)[0])
    assert.equal(colors.c.chip, paletteOf(theme)[1])
    assert.ok(!Object.values(colors).some(c => /e2401c/i.test(c.chip)))
  }
})

test('by task type, the lime goes to the type with the most hours, not the first by name', () => {
  const blocks = [
    block({ sessionId: 's1', taskType: 'Bug fix', start: at(0, 9), end: at(0, 10) }),
    block({ sessionId: 's2', taskType: 'Feature', start: at(0, 10), end: at(0, 14) }),
  ]
  const colors = buildColors({ theme: 'dark', colorBy: 'task' }, [], blocks)
  assert.equal(colors.Feature.chip, LIME)
  assert.notEqual(colors['Bug fix'].chip, LIME)
})

test('daily figures: parallel sessions once, excluded left out, PRs by merge day', () => {
  const d = {
    week: { startMs: monday },
    githubLogin: 'me',
    blocks: [
      block({ sessionId: 'a', start: at(0, 9), end: at(0, 11), productive: true }),
      block({ sessionId: 'b', start: at(0, 10), end: at(0, 12), noCommit: true }),
      block({ sessionId: 'c', start: at(1, 9), end: at(1, 13), excluded: true }),
      block({ sessionId: 'd', start: at(2, 23), end: at(3, 1) }),
    ],
    prsMerged: [
      { yours: true, mergedAt: new Date(at(1, 15)).toISOString() },
      { yours: false, mergedAt: new Date(at(1, 16)).toISOString() },
      { author: 'ME', mergedAt: new Date(at(4, 9)).toISOString() },
    ],
  }
  const s = dailySeries(d)
  assert.deepEqual(s.session, [3, 0, 1, 1, 0, 0, 0])
  assert.deepEqual(s.productive, [2, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(s.noCommit, [2, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(s.prs, [0, 1, 0, 0, 1, 0, 0])
})

test('every calendar is lime, whatever accent was asked for', () => {
  const cfg = loadConfig(['--accent', '#e8641b', '--home', '/nonexistent-wc-home'])
  assert.equal(cfg.prefs.accent, LIME)
})

test('the page carries the chart, the day cards, the ring and the no-commit tray', () => {
  const d = {
    generatedAt: new Date(at(4, 12)).toISOString(), timeZone: 'UTC', machine: 'pc', githubLogin: 'me',
    week: { start: '2026-10-05', end: '2026-10-11', startMs: monday, endMs: at(7, 0), isoWeek: '2026-W41' },
    prefs: { theme: 'light', accent: LIME, colorBy: 'project', weekStart: 'monday' },
    colorOf: {}, blocks: [], sessions: [], prsMerged: [], survey: { isoWeek: '2026-W41' },
    daily: { session: [0, 0, 0, 0, 0, 0, 0], productive: [0, 0, 0, 0, 0, 0, 0], noCommit: [0, 0, 0, 0, 0, 0, 0], prs: [0, 0, 0, 0, 0, 0, 0] },
  }
  const html = renderHtml(d)
  for (const id of ['ktabs', 'chart', 'cmp', 'days', 'dlist', 'ring', 'tray']) assert.ok(html.includes(`id="${id}"`), id)
  assert.ok(html.includes(`--accent:${LIME}`))
  assert.ok(html.includes('prefers-reduced-motion'))
})
