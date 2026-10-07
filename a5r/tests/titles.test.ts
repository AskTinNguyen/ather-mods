import { expect, test } from 'claude-code/testing'
import { TITLE_PATTERN, titleSearchPs, titleFromRecord } from '../hooks/coord.ts'
import { A5RPANE, NOW, PROJ, find, opts, text, still, world } from './world.ts'

// A44 (rev 13): session names read from Claude Code's records keep their characters. Where the engine finds no `grep`,
// the title search falls back to PowerShell, which writes UTF-8 (`[Console]::OutputEncoding`) and reads the record as
// UTF-8 (`Select-String -Encoding UTF8`), so emoji and dashes survive.
const TITLE = '5️⃣📤+6️⃣🤔📤 S2 sync main — watch the train'
const MIN = 60_000
const LANES = 'E:/s2/Saved/AtherAutomata/lanes'
const RECORDS = 'C:/Users/hai.huynh/.claude/projects/E--s2'
const SID = 'dddddddd-1111-4000-8000-000000000000'

test('A44: unit: the PowerShell fallback writes and reads UTF-8, searches the title pattern, and quotes the path', () => {
  const argv = titleSearchPs("C:/x/it's here/a.jsonl")
  expect(argv.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-Command'])
  const cmd = argv[4] ?? ''
  expect(cmd.startsWith('[Console]::OutputEncoding = [Text.Encoding]::UTF8; ')).toBe(true)
  expect(cmd).toContain('Select-String -LiteralPath \'C:/x/it\'\'s here/a.jsonl\'')
  expect(cmd).toContain(`-Pattern '${TITLE_PATTERN}' -Encoding UTF8 -AllMatches`)
  expect(titleFromRecord(`"customTitle":"${TITLE}"`)).toBe(TITLE)
})

test('A44: with no grep, the session row shows the record title intact (emoji, dash) through the UTF-8 PowerShell call', opts(), async ($, on) => {
  const w = world(on, {
    git: {
      // The world answers process runs by needle: grep cannot start here; the UTF-8 PowerShell search answers the title.
      'grep -oE': { stdout: '', deny: 'grep: not found' },
      'Select-String -LiteralPath': { stdout: `"customTitle":"${TITLE}"\n` },
    },
  })
  w.put(`${LANES}/${SID}.json`, JSON.stringify({ sessionId: SID, intent: 'sync', branch: 'HaiHuynh/x', updatedAt: NOW, lastActiveAt: NOW - 2 * MIN, hasEnded: false }))
  w.put(`${RECORDS}/${SID}.jsonl`, '{}\n')
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  await $.ui.render(A5RPANE as never)
  await w.clock.advance(50) // titles are looked up off the render
  const tree = still(await $.ui.render(A5RPANE as never))
  expect(text(find(tree, 'hai-session-dddddddd-title'))).toBe(TITLE)
  const ps = w.runs.find(r => r.startsWith('powershell') && r.includes('Select-String')) ?? ''
  expect([ps.includes('[Console]::OutputEncoding = [Text.Encoding]::UTF8'), ps.includes('-Encoding UTF8')]).toEqual([true, true])
})
