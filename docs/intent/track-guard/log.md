# Ather Automata track guard: Prompt Log

Append-only. Each user prompt verbatim, with credentials and machine paths redacted.

## L-1 (2026-10-06 17:40) | class: intent | -> rev 1

> Anh báo một bug UX nữa khiến user bị deadend.
> Khi lỡ ấm vào một intent trong khi mở session không liên quan, session đó sẽ bị nhiễu.
> Và what if có nhiều session cùng được gán một intent thì workflow và UX của atherAutomata đang handle thế nào?

With a screenshot: a session that was not working on `filler-enemies-tech-support` shows it tracked in the Ather pane (Build · 0 of 9 done), with no way to stop tracking it.

## L-2 (2026-10-06 17:55) | class: intent | -> rev 1

> Đề xuất của em có vẻ đúng, nhưng cần Adversary Review cho chắc chắn.
> Và đây là lỗi trong core của AtherAutomata nên sẽ cần PR vào repo cho anh Tín review nữa.

The proposal (untrack, confirm before tracking, view without tracking, auto-track only for orchestrator writes, a warning when another session tracks the intent) goes through two independent adversarial reviews before rev 1; the fix ships as a PR to `main` for Tin's review.

## L-3 (2026-10-06 19:05) | class: decision | -> rev 2

Asked while Hai was away (Ather autonomy window from 18:52, ledger `.ather/local/away/2026-10-06-18-52.md`, entries D-1 and D-2), taken as the recommended options the window allows:
> D-2 · F-1 … Xử lý thế nào? → (b) Gõ tên trong câu này cũng track (Recommended)
> D-1 · Push nhánh intent/track-guard lên AskTinNguyen/ather-mods và mở PR vào main cho anh Tín review? → Push và mở PR ngay (Recommended)

The window allows pushing branches and opening PRs to main (merges and pushes to main stay held); L-2 already asked for this PR. F-1 (b) lands first, then the push and the PR.
