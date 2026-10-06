// 'claude-code/testing' for `node --test ather-automata/tests/*.test.mjs`: describe and test
// from node:test, expect from the shim. dev/test-all.mjs links it as node_modules/claude-code
// (gitignored) at the repository root, so the plain Node runner resolves the tests' import.
export { describe, test } from 'node:test'
export { expect } from './testing.mjs'
