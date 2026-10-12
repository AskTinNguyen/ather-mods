// @ts-check
// The decision desk (intent decision-desk): what collect lists from real git checkouts' base branches,
// the page it writes, and what plan records of the page's answers.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'claude-code/testing'

import { decidePrompt, ownWords } from '../hooks/decide.mjs'
import * as desk from '../desk/desk.mjs'
import * as model from '../desk/model.mjs'

/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => {
  const ran = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Tin Nguyen', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Tin Nguyen', GIT_COMMITTER_EMAIL: 't@example.com' } })
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`)
  return ran.stdout.trim()
}

/** @param {string} root @param {Record<string, string>} files */
const write = (root, files) => {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), text)
  }
}

/** @param {string} title @param {string} [status] */
const prompt = (title, status = 'active') => `# ${title}\n\n- Rev: 1\n- Status: ${status}\n- Area: Tools\n- Owner: Tin Nguyen\n\n## Goal\n\nIt works.\n\n## Acceptance\n\n- A1: It works. Proof: unit.\n`
const PROGRESS = '# P\n\n- PR: none yet\n\n## Acceptance\n\n| Item | Verdict | Evidence |\n| --- | --- | --- |\n| A1 | open | |\n'
const CALL = (/** @type {string} */ id) =>
  `## ${id} (2026-10-10, rev 1) | blocking: no | status: open (director)\n\nWhich retention rate applies?\n\n**Options:**\n- A (recommended): five per cent, half at handover.\n- B: ten per cent, all after the defects period.\n`
const BLOCKING = '## F-2 (2026-10-11, rev 1) | blocking: yes | status: open\n\nThe build gate cannot be read for the head.\n'
const DECIDED = '## F-3 (2026-10-09, rev 1) | blocking: no | status: open (director)\n\nOld call. Options: (a) keep; (b) drop. Recommendation: (a).\n\n**Resolution:** accepted (a), rev 2.\n'

// A clone of a bare origin whose base branch holds `files`. `base` is the branch the clone's origin/HEAD names.
/** @param {string} name @param {Record<string, string>} files @param {string} [base] */
const checkout = (name, files, base = 'main') => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-'))
  const origin = path.join(top, `${name}.git`)
  const seed = path.join(top, 'seed')
  git(top, 'init', '-q', '--bare', `-b`, base, origin)
  git(top, 'init', '-q', '-b', base, seed)
  write(seed, files)
  git(seed, 'add', '-A')
  git(seed, 'commit', '-q', '-m', 'intents')
  git(seed, 'push', '-q', origin, base)
  const clone = path.join(top, name)
  git(top, 'clone', '-q', origin, clone)
  return clone
}

describe('decision desk: collect (A1)', () => {
  test("lists each base branch's open director calls with options, and nothing completed, decided or only in the working tree", async () => {
    const storey = checkout('storey', {
      'package.json': '{}',
      'docs/intent/retention/prompt.md': prompt('Payment certificate'),
      'docs/intent/retention/progress.md': PROGRESS,
      'docs/intent/retention/findings.md': `# Findings\n\n${CALL('F-1')}\n${BLOCKING}\n${DECIDED}`,
      'docs/intent/done/prompt.md': prompt('Done', 'completed'),
      'docs/intent/done/progress.md': PROGRESS,
      'docs/intent/done/findings.md': CALL('F-1'),
    })
    // A finding written in the working tree only: the team does not see it yet, so neither does the desk.
    fs.appendFileSync(path.join(storey, 'docs/intent/retention/findings.md'), `\n${CALL('F-9')}`)
    const read = await desk.readCheckout(storey)
    expect([read.name, read.base, read.intents.length]).toEqual(['storey', 'main', 2])
    const page = model.deskOf([read], 1000)
    expect(page.items.map(item => item.id)).toEqual(['storey/retention/F-2', 'storey/retention/F-1'])
    const [blocking, call] = page.items
    expect(blocking?.isBlocking).toBe(true)
    expect(call?.options.map(option => [option.letter, option.label, option.text, option.isRecommended])).toEqual([
      ['A', 'Five per cent', 'Five per cent, half at handover.', true],
      ['B', 'Ten per cent', 'Ten per cent, all after the defects period.', false],
    ])
    expect(call?.question).toBe('Which retention rate applies?')
    expect(page.repos).toEqual([{ name: 'storey', url: '', base: 'main', sha: read.sha, intents: 1, waiting: 2 }])
  })

  test("a checkout's base branch is its profile's baseBranch; repositories keep the order they were named in", async () => {
    const web = checkout(
      'web',
      { '.ather/profile.json': '{"version":1,"pack":"web","baseBranch":"develop","gates":[]}', 'docs/intent/login/prompt.md': prompt('Login'), 'docs/intent/login/progress.md': PROGRESS, 'docs/intent/login/findings.md': CALL('F-4') },
      'develop',
    )
    const storey = checkout('storey', { 'docs/intent/a/prompt.md': prompt('A'), 'docs/intent/a/progress.md': PROGRESS, 'docs/intent/a/findings.md': CALL('F-1') })
    const page = model.deskOf([await desk.readCheckout(web), await desk.readCheckout(storey)], 1)
    expect(page.repos.map(repo => [repo.name, repo.base, repo.waiting])).toEqual([
      ['web', 'develop', 1],
      ['storey', 'main', 1],
    ])
    expect(page.items.map(item => item.id)).toEqual(['web/login/F-4', 'storey/a/F-1'])
  })

  test('a folder that is no checkout, or one with no base branch to read, says so', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-none-'))
    const error = await desk.readCheckout(empty).then(() => '', (/** @type {Error} */ caught) => caught.message)
    expect(error).toContain('not a git checkout')
    git(empty, 'init', '-q', '-b', 'main')
    const noBase = await desk.readCheckout(empty).then(() => '', (/** @type {Error} */ caught) => caught.message)
    expect(noBase).toContain('no origin/main to read')
  })

  test("a finding links to its file on the base branch where origin is on GitHub, and nowhere else", async () => {
    const clone = checkout('storey', { 'docs/intent/a/prompt.md': prompt('A'), 'docs/intent/a/progress.md': PROGRESS, 'docs/intent/a/findings.md': CALL('F-1') })
    expect((await desk.readCheckout(clone)).url).toBe('')
    git(clone, 'remote', 'set-url', 'origin', 'git@github.com:AskTinNguyen/Storey.git')
    const read = await desk.readCheckout(clone)
    expect([read.name, read.url]).toEqual(['Storey', 'https://github.com/AskTinNguyen/Storey'])
    git(clone, 'remote', 'set-url', 'origin', 'https://github.com/AskTinNguyen/Ather-Mods.git/')
    expect((await desk.readCheckout(clone)).url).toBe('https://github.com/AskTinNguyen/Ather-Mods')
    const intent = { slug: 'retention', title: 'R', owner: 'Tin', status: 'active', updatedAt: 1, findings: [{ id: 'F-1', title: 'q', full: 'q', isBlocking: true, isDirectorCall: true, options: [], source: '## F-1' }] }
    const page = model.deskOf([{ name: 'storey', url: 'https://github.com/AskTinNguyen/storey', base: 'main', sha: 'abc', intents: [/** @type {any} */ (intent)] }], 1)
    expect(page.items[0]?.link).toBe('https://github.com/AskTinNguyen/storey/blob/main/docs/intent/retention/findings.md')
  })

  test('the page carries the data in its slot, with no way for a finding to close the script', () => {
    const page = desk.pageWith({ version: 1, at: 1, repos: [], items: [/** @type {any} */ ({ id: 'x', question: '</script><script>alert(1)</script> ' })] })
    expect(page).not.toContain('</script><script>alert(1)')
    const json = /<script type="application\/json" id="desk-data">(.*?)<\/script>/s.exec(page)?.[1] ?? ''
    expect(JSON.parse(json).items[0].question).toBe('</script><script>alert(1)</script> ')
  })
})

describe('decision desk: plan (A3)', () => {
  /** @type {import('../desk/model.mjs').Desk} */
  const DESK = {
    version: 1,
    at: 1,
    repos: [
      { name: 'storey', url: 'https://github.com/AskTinNguyen/storey', base: 'main', sha: 'a', intents: 2, waiting: 2 },
      { name: 'web', url: '', base: 'develop', sha: 'b', intents: 1, waiting: 1 },
    ],
    items: [
      { id: 'storey/retention/F-1', repo: 'storey', slug: 'retention', intent: 'R', owner: 'Tin', updatedAt: 1, finding: 'F-1', question: 'Which rate?', isBlocking: false, options: [{ letter: 'A', label: 'Five per cent', text: 'Five per cent, half at handover', isRecommended: true }, { letter: 'B', label: 'Ten', text: 'Ten per cent', isRecommended: false }], source: '', link: '' },
      { id: 'storey/tender/F-2', repo: 'storey', slug: 'tender', intent: 'T', owner: 'Tin', updatedAt: 1, finding: 'F-2', question: 'Late bids?', isBlocking: false, options: [], source: '', link: '' },
      { id: 'web/login/F-4', repo: 'web', slug: 'login', intent: 'L', owner: 'Tin', updatedAt: 1, finding: 'F-4', question: 'SSO?', isBlocking: true, options: [{ letter: 'A', label: 'Yes', text: 'Yes', isRecommended: true }, { letter: 'B', label: 'No', text: 'No', isRecommended: false }], source: '', link: '' },
    ],
  }
  /** @param {Partial<import('../desk/model.mjs').Answer> & { id: string }} answer @returns {import('../desk/model.mjs').Answer} */
  const answer = answer => ({ repo: '', slug: '', finding: '', question: '', choice: '', words: '', state: 'answered', at: 1, ...answer })

  test("an option hands the pane's own prompt; typed words hand the owner's words; repositories in the desk's order", () => {
    const plan = model.planOf(DESK, [answer({ id: 'web/login/F-4', choice: 'B' }), answer({ id: 'storey/tender/F-2', words: '  Replace it,\n keep the record ' }), answer({ id: 'storey/retention/F-1', choice: 'A' })])
    expect(plan.record.map(repo => [repo.repo, repo.base, repo.decisions.map(one => one.id)])).toEqual([
      ['storey', 'main', ['storey/tender/F-2', 'storey/retention/F-1']],
      ['web', 'develop', ['web/login/F-4']],
    ])
    const [tender, retention] = plan.record[0]?.decisions ?? []
    expect(retention?.prompt).toBe(decidePrompt('retention', 'F-1', 'A — Five per cent, half at handover'))
    expect(retention?.answer).toBe('A: Five per cent')
    expect(tender?.prompt).toBe(decidePrompt('tender', 'F-2', ownWords('Replace it, keep the record')))
  })

  test('recorded answers wait for their PR, withdrawn ones are left alone, and a finding the base reads closed is settled', () => {
    const plan = model.planOf(DESK, [answer({ id: 'storey/retention/F-1', choice: 'A', state: 'recorded', pr: 'https://github.com/x/y/pull/9' }), answer({ id: 'web/login/F-4', choice: 'A', state: 'withdrawn' }), answer({ id: 'storey/gone/F-7', choice: 'A' })])
    expect([plan.record, plan.waiting, plan.settled, plan.ask]).toEqual([[], ['storey/retention/F-1'], ['storey/gone/F-7'], []])
    expect(model.planText(plan)).toBe('Nothing to record.\nRecorded, PR not merged yet: storey/retention/F-1\nSettled on the base branch: storey/gone/F-7')
  })

  test('a letter the finding no longer offers, or an answer with nothing in it, is asked again rather than guessed', () => {
    const plan = model.planOf(DESK, [answer({ id: 'storey/retention/F-1', choice: 'C' }), answer({ id: 'storey/tender/F-2', words: '   ' })])
    expect(plan.record).toEqual([])
    expect(plan.ask).toEqual([
      { id: 'storey/retention/F-1', why: "option C is no longer one of F-1's options" },
      { id: 'storey/tender/F-2', why: 'the answer names no option and has no words' },
    ])
  })

  test('the plan as text names each decision and its prompt, under its repository', () => {
    const text = model.planText(model.planOf(DESK, [answer({ id: 'web/login/F-4', choice: 'A' })]))
    expect(text).toBe(`## web (into develop)\n\n- web/login/F-4: A: Yes\n  Prompt: ${decidePrompt('login', 'F-4', 'A — Yes')}`)
  })

  test("answers are read from an ArtifactData list's rows, and anything else is refused", () => {
    const doc = answer({ id: 'web/login/F-4', choice: 'A' })
    expect(desk.answersFrom([{ id: 'web~login~F-4', data: doc }])).toEqual([doc])
    const refused = (/** @type {unknown} */ rows) => {
      try {
        desk.answersFrom(rows)
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : ''
      }
    }
    expect(refused([doc])).toBe('answers: row 1 (web/login/F-4) holds no answer document')
    expect(refused({ docs: [] })).toContain('expected the rows of an ArtifactData list')
  })

  test('an answer for a repository the desk does not list is a broken desk, not a silent default', () => {
    const broken = { ...DESK, repos: DESK.repos.slice(1) }
    const message = (() => {
      try {
        model.planOf(broken, [answer({ id: 'storey/retention/F-1', choice: 'A' })])
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : ''
      }
    })()
    expect(message).toBe('desk: storey/retention/F-1 names a repository the desk does not list')
  })
})
