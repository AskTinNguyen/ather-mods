# overlap-check: visual proofs

Made 2026-10-18 by `node dev/e2e/board.mjs --out <dir>` (the board's real module in the stand-in engine, on real git: main moved under `intent/dodge-cancel`, and `intent/nine-tail-dash` and `intent/mc-vault` change the same line), then screenshotted with Chromium.

| File | What it shows |
| --- | --- |
| `pane-triage-110.png` / `.txt` | The pane's Triage at 110 columns: Colliding second-level group, the dodge-cancel pair opened in place (fact, each place with both sides, the binary map), its two actions. |
| `pane-triage-72.png` / `.txt` | The same at 72 columns: the pair rows keep their names; the file column is left out. |
| `pane-foryou-110.png` / `.txt` | For you: Tin's own collision, placed once. |
| `page-triage.png`, `page-triage-opened.png` | The page (`/board open`): Colliding in Triage, a pair opened. |
| `page-triage-opened-dark.png` | The same in dark mode. |
| `page-triage-phone.png` | The same at 390 px. |
| `page-table.png` | Table: each intent in a collision warns "overlaps …" on its own row. |
