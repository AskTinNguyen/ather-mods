# paseo-parity: Log

## 2026-10-18

- Created last of the proposal's intents. The Paseo server runs under node with `--experimental-strip-types` and `server/test-resolve.mjs` (the README's quick checks), so its side is proven on real git by a new e2e, `dev/e2e/paseo.mts`, now part of `dev/test-all.mjs`. Recorded as a tool added for the work.
- The panel itself (React Native) was not drawn here: there is no Paseo app and no react-native-web in this environment.
- The e2e's first expectation named the item by the intent; the item's title names the branch (the prompt names the intent), as in the mod. The expectation was wrong, not the code.
