// @ts-check
// Ather Automata: one hooks module per plugin, made of two halves. watch.mjs
// protects work silently; console.mjs shows what needs you. Each catches its own
// failures, so one half failing never stops the other. They share state only
// through state.mjs, its owner, which serializes every change.

import { register as registerWatch } from './watch.mjs'
import { register as registerConsole } from './console.mjs'

/** @param {import('claude-code').On} on @param {import('claude-code').PluginOptions} options */
export function register(on, options) {
  registerWatch(on, options)
  registerConsole(on, options)
}
