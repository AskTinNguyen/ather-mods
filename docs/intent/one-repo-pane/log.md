# Ather Automata: the pane shows the repository it is in: Prompt Log

Append-only. Each user prompt verbatim, with credentials and machine paths redacted.

## L-1 (2026-10-11) | class: intent | -> rev 1

> pull latest, dùng /coordinate-build  xem repo náo thì thỉ thấy những intent , issue , worktree v.v... của repo đó thôi . ko cần setup repos add delete v.v... nữa

The pane shows one repository; the setup of repositories is removed (D1, D3).

## Q-1 (2026-10-11) | class: decision | -> rev 1

Asked: how is "the repository being viewed" decided? Answer: "Checkout của session" (the session's checkout; a parent folder has no pane) (D1, D2).

## Q-2 (2026-10-11) | class: decision | -> rev 1

Asked: do commands and tracking in another checkout stay? Answer: "Giữ" (keep) (D4).
