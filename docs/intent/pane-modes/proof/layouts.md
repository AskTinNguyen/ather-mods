# Layouts before and after

The S2 e2e (`dev/e2e/run.mjs --layouts <dir>`) lays out every pane and band it draws: 89 at 72 columns, 31 at 110. There is no S2 checkout here, so its intents were a stand-in: `stand-in-s2.mjs.txt` (run as `node stand-in-s2.mjs <dir>`, then `S2_ROOT=<dir>`) writes six intents under the names the run tracks. 347 of its 361 checks pass on main and on the branch alike: the 14 others read S2's own intents.

| Run | Hooks | layouts-72.txt (sha256) | layouts-110.txt (sha256) |
| --- | --- | --- | --- |
| before | origin/main 25ccb0c | dbe55497f649cc20… | 124306ed18729e12… |
| before, again | origin/main 25ccb0c | dbe55497f649cc20… | 124306ed18729e12… |
| after | this branch | dbe55497f649cc20… | 124306ed18729e12… |
| after, again | this branch | dbe55497f649cc20… | 124306ed18729e12… |
| after the review's fixes | this branch | dbe55497f649cc20… | 124306ed18729e12… |

Two other runs on the branch (one before the review's fixes, one after) differed in two Home layouts (four at 110): the order of intents changed in the time sort and so the Next. Those intents' files were copied within the same millisecond, so they tie; the runs beside them, and both runs of main, match. The same two Home layouts (#85 and #87 at 72, #86 and #88–#90 at 110: Home with seven workers) differ each time, and no other. No moved mode differs in any run.

`modes-72.png` and `modes-72-b.png` draw the six modes as laid out at 72 columns.
