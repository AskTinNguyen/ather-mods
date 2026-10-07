# avatar-frame: Progress

- Working under rev: 1
- Worker: avatar-frame worker (Claude Opus subagent, worktree `D:/Projects/ather-mods-wt/avatar-frame`)
- Current step: none (stopped for review)
- Next step: Hai looks at a running worker's avatar on the real desktop pane in the light and the dark theme (A1's review half); then merge (A4)
- PR: (set when opened)

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | open | Gate half done (S1): cause found in the desktop renderer and the fix proved on a reproduction of it in Chromium (before: white square in the dark parent; after: transparent in both); unit "avatar frame (0.1.3)": every avatar, every state and prop, opens with the one root rule; e2e: the running avatar's source carries it, finished ones too, and `isInteractive` is still true only while running (the bob stays). Open: Hai's look on the real pane in light and dark. |
| A2 | met | S1: unit "every Svg Ather draws, with whether it is framed (isInteractive) and why" reads every `Svg({` call in the hooks: the Ather mark (image), a finished worker's trail `propSvg` (image: no frame, so no page behind it) and the avatar (framed only while running, covered by FRAME_SCHEME). Only the avatar is ever framed, so it is the only one that needed the rule. `# pass 120 # fail 0`. |
| A3 | met | S1: `node --test ather-automata/tests/*.test.mjs` → `# pass 120 # fail 0`; back to back on the live checkout: `origin/main` 3f4772f (throwaway worktree, removed) → `118/118 passed`, `230/230 passed`; this branch `S2_ROOT=E:/Projects/s2 node dev/test-all.mjs --layouts <scratch>/AF-new` → `120/120 passed`, `231/231 passed`; layouts-72 and layouts-110 identical (the terminal layouts draw no Svg, so the avatar's markup is the only difference); Paseo shared modules in step after `npm run sync`; `claude plugin test ather-automata` → `2 pass 0 fail`; `claude plugin validate ather-automata` → `✔ Validation passed`; type-check → no errors; version 0.1.3 in both manifests and a 0.1.3 Changes line. |
| A4 | open | |

## Steps

- S1 (rev 1, 2026-10-07): the cause, from the installed desktop app's renderer (read only: `Claude_2.19675.1.0`, `resources/ion-dist/assets/v1/c95e4d2cf-UH-ZYE4g.js`): an `isInteractive` Svg becomes `<iframe sandbox srcdoc>` whose page is `<!doctype html><meta CSP><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}…</style>` followed by our svg (scrubbed by DOMPurify 3.1.7, svg profile; `<style>` is kept, CSP allows inline style). Chromium paints a frame's page opaque when that page's colour scheme differs from the iframe element's (the app's): the page root has none (normal = light), so in the dark theme the page is white. The svg's own `style="color-scheme: light dark"` names the svg element, not the page root, so it never helped. Fix: `avatarSvg` starts with `FRAME_SCHEME` = `<style>:root{color-scheme:light dark;background:transparent}</style>`, which in the frame page sets the html root to `light dark` (it then takes the app's scheme), and in a still image names the svg root and changes nothing. Proof on a reproduction (scratchpad `frame-repro/`): the same DOMPurify version and config, CSP, wrapper style and iframe attributes, in a dark (`color-scheme: dark`) and a light parent, in the Browser pane's Chromium 152: the origin/main avatar shows a white square in the dark parent, the fixed one is round on transparent in both; the style survives the scrub (`kept: { before: false, after: true }`). The running avatar keeps `isInteractive` (its bob), so no fallback to a still image was needed. Paseo: `npm run sync` copied squad.mjs (its PNG art is unchanged by a style rule resvg does not draw; `npm run art` needs `npm install` and was not run). Version 0.1.3, Changes line. Evidence: this commit and the A1 to A3 rows. Acceptance: A1 (gate half), A2, A3.
