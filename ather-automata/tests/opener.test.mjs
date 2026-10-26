// @ts-check
// Opening a file or a link with the system's own handler (hooks/opener.mjs), shared with Ather Board.
import { describe, expect, test } from 'claude-code/testing'

import { openWith, openerTries } from '../hooks/opener.mjs'

describe("the system's opener", () => {
  const LINK = 'claude://claude.ai/epitaxy/local_a'

  test('start through cmd on Windows; open, then xdg-open elsewhere; a target cmd would read as more than one is not handed to it', () => {
    expect(openerTries(LINK, true)).toEqual([['cmd', '/c', 'start', '', LINK]])
    expect(openerTries(LINK, false)).toEqual([['open', LINK], ['xdg-open', LINK]])
    expect(openerTries(`${LINK} & calc`, true)).toEqual([])
    expect(openerTries('C:\\Users\\me\\100%.html', true)).toEqual([])
  })

  test('the first command that exits 0 opened it; one that cannot start is the next one\'s turn; none: not opened, never a rejection', async () => {
    /** @type {string[]} */
    const ran = []
    const opened = await openWith(async argv => (ran.push(argv[0] ?? ''), argv[0] === 'open' ? Promise.reject(new Error('ENOENT')) : { exitCode: 0 }), LINK, false)
    expect([opened, ran]).toEqual([true, ['open', 'xdg-open']])
    expect(await openWith(async () => ({ exitCode: 1 }), LINK, true)).toBe(false)
    expect(await openWith(async () => ({ exitCode: 0 }), `${LINK}"`, true)).toBe(false)
    expect(await openWith(() => {
      throw new Error('no process here')
    }, LINK, true)).toBe(false)
  })
})
