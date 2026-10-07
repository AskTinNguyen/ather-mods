# track-guard: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

<!--
## F-<n> (<YYYY-MM-DD>, rev <r>) | blocking: yes | no | status: open | accepted | rejected

**Found:** <what, with evidence>
**Proposed amendment:** <the change to prompt.md>
**Resolution:** <decision and resulting rev, filled by the orchestrator>
-->

## F-1 (2026-10-06, rev 1) | blocking: no | status: accepted (director)

**Found:** Without a pane (the phone path), "Pick something to work on" asks one question: "What should this session work on? Your intents and your GitHub issues come first. Or type a name, or an issue #number." (`console.mjs`, `workQuestion`). Its four choices still track (A2: the phone path is unchanged), but under A2 a name typed in that same dialog only says where the intent stands and the command that tracks it ("… To work on it in this session: /ather intent <slug>"). So a choice and a typed name now behave differently in one dialog, and "Or type a name" reads as if typing picks. Built as the prompt says (S3); the e2e check "without a pane, part of an intent name typed in the dialog says where it stands …" covers it.

**Options:**
- (a) As built: no typed words ever track; the reply names `/ather intent <slug>`.
- (b) A name typed in the Work question, and only there, tracks when it matches exactly one intent, as its choices do: that dialog itself asks what to work on (its question is the verb, as the Next card's label is in D1). Every other dialog keeps (a).
- (c) As built, and the question drops "Or type a name" (keeps "or an issue #number").

**Recommendation:** (b).

**Proposed amendment:** A2, "words typed in an Ather dialog or after `/ather` that match one intent open the Intent view" → "words typed in an Ather dialog (other than the Work question, 'What should this session work on?', whose typed name tracks as its choices do) or after `/ather` …".

**Resolution:** (b), decided under Hai's away window (ledger D-2; L-3), then replaced at Hai's review (L-4, rev 3): the typed name opens a follow-up question that shows where the intent stands and what working on it here means, with Work on it here / Just look / Pick something else (D5).
