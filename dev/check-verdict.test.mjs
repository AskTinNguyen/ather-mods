// node --test dev/check-verdict.test.mjs (dev/test-all.mjs runs it in its unit stage)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verdictOf } from './check-verdict.mjs'

const body = section => `## Summary\n\nWhat changed.\n\n## Thermo-nuclear review\n\n${section}\n\n## Release\n\nVerdict: block\n`

test('one Verdict line in the section is the verdict, in any case, bold or not', () => {
  assert.deepEqual(verdictOf(body('Verdict: pass\n\n| Round | Finding |')), { verdict: 'pass' })
  assert.deepEqual(verdictOf(body('**Verdict:** Approve.')), { verdict: 'approve' })
  assert.deepEqual(verdictOf(body('Verdict: block\n\nC1 is open.')), { verdict: 'block' })
})

test('a Verdict line outside the section, or inside a comment, does not count', () => {
  assert.ok('problem' in verdictOf(body('Round 1: approve')))
  assert.ok('problem' in verdictOf(body('<!-- Verdict: pass -->')))
  assert.ok('problem' in verdictOf('## Summary\n\nVerdict: pass\n'))
})

test('a mixed or second verdict is not read as a pass', () => {
  assert.ok('problem' in verdictOf(body('Verdict: approve, but C3 still open: block')))
  assert.ok('problem' in verdictOf(body('Verdict: block\nVerdict: approve')))
  assert.ok('problem' in verdictOf(body('Verdict:')))
  assert.ok('problem' in verdictOf(body('Verdict: no critical findings')))
})

test('the section ends at the next heading of its level or above, not at a deeper one', () => {
  assert.deepEqual(verdictOf('## Thermo-nuclear review\n\n### Round 1\n\nVerdict: pass\n\n## Go\n'), { verdict: 'pass' })
})
