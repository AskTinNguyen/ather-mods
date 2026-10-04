const tests = []; const stack = []
export const describe = (name, body) => { stack.push(name); body(); stack.pop() }
export const test = (name, fn) => tests.push([[...stack, name].join(' > '), fn])
const fail = m => { throw new Error(m) }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const matchers = v => ({
  toContain: x => v.includes(x) || fail(`expected ${JSON.stringify(v)} to contain ${JSON.stringify(x)}`),
  toBe: x => Object.is(v, x) || fail(`expected ${JSON.stringify(v)} to be ${JSON.stringify(x)}`),
  toEqual: x => eq(v, x) || fail(`expected ${JSON.stringify(v)} to equal ${JSON.stringify(x)}`),
  toMatch: r => r.test(v) || fail(`expected ${JSON.stringify(v)} to match ${r}`),
  toHaveLength: n => v.length === n || fail(`expected length ${n}, got ${v.length}`),
})
export const expect = v => { const m = matchers(v); m.not = Object.fromEntries(Object.entries(m).map(([k, f]) => [k, (...a) => { let ok = true; try { f(...a) } catch { ok = false } if (ok) fail(`expected not ${k} ${JSON.stringify(a)}`) }])); return m }
export const run = async () => { let bad = 0; for (const [n, f] of tests) { try { await f(); console.log('ok  ', n) } catch (e) { bad++; console.log('FAIL', n, '\n     ', e.message) } } console.log(`${tests.length - bad}/${tests.length} passed`); process.exitCode = bad ? 1 : 0 }
