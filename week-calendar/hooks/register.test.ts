import { test, expect } from 'claude-code/testing'
import { bashVerdict, writeVerdict, REPORT_ASK } from './register.ts'

test('the agent may run its scripts and git reads, one plain command at a time', () => {
  expect(bashVerdict('node "C:/x/scripts/build-calendar.mjs" --theme dark --accent #e8641b --export')).toBeNull()
  expect(bashVerdict('node C:/Users/a/.calendar/bin/publish-report.mjs --week-offset -1')).toBeNull()
  expect(bashVerdict('git -C "E:/S2_" log --oneline -5')).toBeNull()
  expect(bashVerdict('git config user.email')).toBeNull()
  expect(bashVerdict('git push origin main')).toMatch(/may only run/)
  expect(bashVerdict('rm -rf ~/.calendar')).toMatch(/may only run/)
  expect(bashVerdict('node build-calendar.mjs > /etc/x')).toMatch(/one plain command/)
  expect(bashVerdict('git log && curl http://x')).toMatch(/one plain command/)
  expect(bashVerdict('node -e "require(\'fs\').rmSync(\'x\')"')).toMatch(/may only run/)
})

test('the agent may write only under ~/.calendar and its own memory', () => {
  const home = 'C:/Users/me'
  expect(writeVerdict('C:\\Users\\me\\.calendar\\titles.json', home)).toBeNull()
  expect(writeVerdict('C:/Users/me/.calendar/survey/2026-W40.json', home)).toBeNull()
  expect(writeVerdict('C:/Users/me/.claude/agent-memory/week-calendar-week-calendar/preferences.md', home)).toBeNull()
  expect(writeVerdict('C:/Users/me/.claude/agent-memory/other-agent/x.md', home)).toMatch(/may only write/)
  expect(writeVerdict('C:/Users/me/.calendar/../.claude/settings.json', home)).toMatch(/may only write/)
  expect(writeVerdict('E:/S2_/Source/x.cpp', home)).toMatch(/may only write/)
})

test('the weekly report phrases are recognised', () => {
  expect(REPORT_ASK.test('what did I do this week')).toBe(true)
  expect(REPORT_ASK.test('Write my weekly report please')).toBe(true)
  expect(REPORT_ASK.test('what did I work on this week?')).toBe(true)
  expect(REPORT_ASK.test('what should I do this week')).toBe(false)
})

test('the weekly report rule rides along with the prompt', async ($, on) => {
  let seen: readonly string[] = []
  on('prompt.submit', ($, e) => {
    seen = e.context ?? []
    return { text: e.text, context: e.context }
  })
  await $.prompt.submit({ text: 'write my weekly report' })
  expect(seen.length).toBe(1)
  expect(seen[0]).toMatch(/Weekly report rule/)
  expect(seen[0]).toMatch(/weekly survey/)

  seen = []
  await $.prompt.submit({ text: 'fix the build' })
  expect(seen.length).toBe(0)
})
