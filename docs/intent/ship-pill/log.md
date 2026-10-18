# ship-pill: Log

## 2026-10-18

- Created after board-counts. The Ship card was mapped state by state against what the pane now shows (prompt.md, Non-Goals); only the merge-clean state and the pill had no place, so those are what was built.
- "Merges cleanly" needed a fact the check did not give: with no origin/main fetched it returned no overlaps, which would have read as clean. `compared` says which sides were merged with the base.
