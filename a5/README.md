# A5 0.5

Flow riêng của Hai, chạy **cạnh** Ather Automata và không sửa code của Ather.

- **A5 tắt** (mặc định): Ather y như bản Ather phát hành. Pane, status line và toast là của Ather; a5 không chặn gì. Chỉ còn dấu 🟥/⏯️ trên tiêu đề session.
- **A5 bật** (`/a5 on`): năm điều và cổng báo cáo, cộng ba công cụ điều phối cho các session dùng chung một checkout S2 trên một máy: **Editor holder**, **RAM** và **Sync main holder** (0.5: sync worker chạy merge, freeze là lease có hard end, chốt chặn `MERGE_HEAD`, tổng quan session). Ba công cụ này dùng chung một đồng hồ và một kênh tin nhắn: các notice `A5 ·`.

## Cài đặt

Từ 0.5 mod tên là **a5** (trước đây hai-flow): thư mục `a5/`, tool `mcp__a5__editor` / `mcp__a5__sync`, file điều phối `Saved/A5/`, mọi notice và lời từ chối bắt đầu bằng `A5 ·`. Store của plugin đổi theo tên, nên sau khi đổi A5 về **tắt** và cổng launch về mặc định: gõ `/a5 on` lại.

Mod nằm ở `D:/Projects/ather-mods/a5` (repo `ather-mods`, cạnh `ather-automata/`). Nạp bằng `CLAUDE_CODE_PLUGIN_DIRS` trong khối `env` của `~/.claude/settings.json`, và **a5 phải đứng đầu danh sách** (plugin nạp trước nằm ngoài chuỗi hook, nên mới bọc được pane của Ather):

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "D:/Projects/ather-mods/a5;D:/Projects/ather-mods/ather-automata" }
```

Trên Windows các thư mục cách nhau bằng `;`. Đổi đường dẫn cũ (thư mục scratch của session S2) sang đường dẫn này rồi mở session mới. `/a5 status` cho biết a5 có đứng trên Ather không.

## Những gì A5 thêm

| Phần | Làm gì |
|---|---|
| Năm điều (`hooks/a5.ts`, `rules/config.json`, `rules/rules-a5.md`) | Như 0.3: đứng **sau** flow intent của Ather, chỉ thêm kiểm tra. Chặn `--no-verify`, `GIT_LFS_SKIP_SMUDGE=1`, sửa chính mod, `sparse-checkout set` trong checkout chung. Hỏi Hai trước git phá dữ liệu hoặc đổi nhánh trong checkout chung, config repo, force push, push main, `git add .`, xoá đệ quy ngoài TEMP, settings.json. Worker (subagent) không bao giờ hỏi Hai: bị từ chối, dừng và báo. Cuối lượt: báo cáo `Changed / Verified / Risk / Open`; có intent đang track thì `Verified:` theo proof của Ather. |
| **Editor holder** (`hooks/coord.ts`, tool `mcp__a5__editor`) | Một Editor mỗi máy. Session xin slot bằng tool (`request`: số phút, có PIE không, có build không, làm gì). Hàng đợi tính giống hệt nhau ở mọi session từ các file `Saved/A5/editor/<id8>.json` (mỗi session chỉ ghi file của mình): ai xin trước được trước; trong cutoff và freeze thì người giữ sync đứng đầu. Chỉ session đầu hàng lấy lock khi lock rảnh, slot phải kết thúc trước cutoff của sync kế tiếp, và RAM phải qua cổng launch. Lock ghi đúng dòng chuẩn S2 (`HELD … · held by <lane>, session <id8>, until HH:MM`; `FREE … background=none · free since HH:MM`), Ather vẫn đọc được. Không ai được Edit/Write/redirect vào `Saved/EDITOR_OWNER.txt` khi A5 bật: dùng tool. Xin ≤ 20 phút, không build: holder được nhờ nhường ở điểm an toàn kế tiếp, tối đa một lần mỗi giờ (holder không có a5 thì nhận dòng chuẩn `UE request:`). Holder được báo 5 phút trước khi hết lease, lúc hết lease, và khi giữ mà 15 phút không dùng. Lease cũ chỉ được giải phóng khi lane của holder đã mất **và** không còn UnrealEditor; Editor còn chạy mà holder mất thì chỉ báo, không bao giờ kill. `release` (dừng PIE và mọi tiến trình nền gọi MCP trước; `dont_save` cho package bỏ), `extend` (trước khi hết lease, nếu còn vừa), `status`. |
| **RAM** | Trước khi cấp slot, session đầu hàng chạy dọn dẹp an toàn: reaper của S2 (`.agents/skills/git-poller-storm/scripts/reap-orphan-git.ps1`) khi RAM trống < 14 GB; tắt LiveCodingConsole chỉ khi không có UnrealEditor nào chạy; các tiến trình nặng khác chỉ được nêu tên, không kill. Cổng launch (mặc định ≥ 31 GB khi slot có PIE, ≥ 28 GB khi không) chỉnh được trên panel và trong tuỳ chọn; Editor đang mở thì dùng lại, không cần cổng launch. Cổng PIE cố định: bắt đầu ≥ 5 GB, dừng khi < 3 GB (notice khi PIE của session đang chạy). Ổ chứa checkout < 20 GB thì báo. Cả máy chỉ đo một lần mỗi chu kỳ: lần đo dùng chung trong `Saved/A5/probe.json`; một session chỉ đo khi file cũ hơn 50 s (giành lượt bằng đọc-so-ghi), các session khác đọc file; cấp slot, dọn dẹp và release luôn đo mới. |
| **Sync main holder** (tool `mcp__a5__sync`, `/a5 sync`) | Lên lịch merge `origin/main` trên panel (giờ đặt sẵn, nút *Build: yes/no*) hoặc `/a5 sync HH:MM [build] [for <session>]`. Session lên lịch giữ sync, trừ khi chỉ định session khác; chỉ holder đổi, dời, huỷ hay kết thúc (`Saved/A5/sync.json`, một người ghi). Cutoff = sync − 30 phút: mọi session A5 nhận notice commit đường dẫn của mình, viết resume note, dừng PIE và trả Editor trước sync − 10. Lúc cutoff, a5 của holder chạy `git merge-tree --write-tree --name-only HEAD origin/main` (60 s, theo origin/main đã fetch lần cuối) và xếp từng xung đột theo rule 11 (self: main chỉ giữ bản cũ của nhánh mình, resolve về ours; foreign: chủ sở hữu quyết, xung đột logic hoặc `.uasset/.umap` thì abort). Mỗi xung đột tới đúng session đã sửa đường dẫn đó (mỗi a5 ghi các đường dẫn session và worker của nó sửa trong checkout chung vào `Saved/A5/touch/<id8>.json`). Cũng lúc cutoff, holder liệt kê các file `origin/main` thêm mới (`git diff --name-only --diff-filter=A HEAD origin/main`) mà đã có sẵn trên đĩa trong checkout chung ("untracked would be overwritten", merge-tree không thấy), kiểm tra từng đường dẫn một, không bao giờ quét cả cây; mỗi file tới session đã viết nó, không rõ chủ thì nằm trong notice của holder (🟥 cho Hai). Từ giờ sync tới khi `done`/`abort`: các session không giữ sync bị từ chối git ghi (commit, add, rm, mv, checkout, switch, restore, reset, stash, merge, rebase, pull, push, cherry-pick, revert, clean, am) và mọi lệnh dùng Editor trong checkout chung. Done/abort mở lại và báo mọi session đã được báo về sync đó. Trước giờ sync, holder mất thì người khác bấm *Take over*. |
| **Sync worker** (0.5) | Đúng giờ sync, a5 của holder tự khởi động một agent nền `a5:sync` (một lần mỗi sync, model không gọi được) để chạy merge, nên không cần thêm session và cuộc trò chuyện của holder không bị nhiễu. Quy trình: git không bao giờ hỏi (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, có timeout); lấy lock Editor trước khi merge (`launch: false`, không cần cổng RAM); không bao giờ đóng, kill hay điều khiển Editor của lane khác (chờ, rồi abort 10 phút trước hard end); Editor để mở thì chỉ đóng khi lock rảnh/của mình và sau khi kiểm dirty (có dirty thì abort); merge (không rebase), self-conflict về ours (rule 11), xung đột logic hoặc `.uasset/.umap` thì `git merge --abort` và abort; build hỏng thì `git revert -m 1`; kết thúc bằng tool sync `done`/`abort`. Worker kết thúc mà không gọi done/abort thì sync bị abort giùm và holder được báo. Trong freeze, holder và worker được chạy đúng các lệnh `git merge origin/main`, `git merge --abort`, `git checkout --ours\|--theirs -- <paths>`, `git revert -m 1 <sha>`, `git add -- <paths>`, `git commit` mà A5 không hỏi; `reset --hard`, `stash`, `clean` và mọi thứ khác giữ luật cũ. |
| **Freeze là lease** (0.5) | Freeze có hard end: sync + 45 phút (merge), + 90 phút (có build), chỉnh trong tuỳ chọn. Hết hard end, hoặc holder mất trong lúc freeze, sync thành *expired* ngay với mọi session (ai thấy trước thì ghi), git và Editor mở lại, mọi session được báo, và đúng **một** 🟥 cho Hai (tiêu đề, unread, `PENDING.md`) qua file `Saved/A5/alerts/`. Holder được báo 10 phút trước hard end. Thứ duy nhất vẫn chặn là nguy hiểm git thật: còn `.git/MERGE_HEAD` trong checkout chung thì mọi session (trừ holder của sync gần nhất) bị từ chối git ghi ở đó, bất kể `sync.json`; merge bị bỏ dở mà không có sync nào mở thì một 🟥 cho Hai. `/a5 off` vẫn là nút dừng khẩn cấp. |
| **Tổng quan session** (0.5) | Một dòng dưới ba thẻ: bao nhiêu session đang chạy (danh sách session của app), bao nhiêu trong S2 (lane của Ather và file của a5) và ở chỗ khác, theo intent, ai giữ/đang chờ Editor, ai giữ sync, và các session S2 còn sống chạy **không có** a5 0.4 trở lên (có lane Ather nhưng không có file session tươi). Không có tool danh sách session thì dòng này chỉ dựa vào lane và file. Lúc cutoff, holder gửi cho mỗi session đó đúng một tin chuẩn qua `$.session.send` (chúng không bị freeze được) và notice của holder nêu tên chúng. |
| **Notice** | Mọi notice bắt đầu `A5 · <cổng> — <chuyện gì> → <làm gì>`, do a5 của chính session nhận đưa vào: giữa lượt thì kèm vào kết quả tool kế tiếp của vòng chính (không bao giờ vào kết quả của worker); session rảnh mà notice cần làm gì đó (cấp slot, nhờ nhường, hết lease, cutoff, xung đột, mở freeze) thì đúng **một** prompt; còn lại đi kèm prompt kế tiếp của Hai. Mỗi notice chỉ giao một lần (id lưu trong file session, sống qua reload). Không gửi tin chéo giữa các session a5; file là sự thật, notice chỉ là chuông cửa. Ghi một dòng `A5 ·` vào `docs/intent/**` (Edit, Write, MultiEdit hay lệnh shell) bị từ chối, nên log và findings của intent không bị nhiễu. |
| Pane Ather | Ngay dưới hàng thẻ của Ather, ba thẻ: **Editor holder** (ai giữ, tới mấy giờ, còn bao lâu, vị trí của session này trong hàng), **Memory** (RAM trống so với cổng launch và cổng PIE, lần dọn gần nhất, nút −1 GB / +1 GB / Reset cho cổng launch, áp dụng cho mọi session), **Sync main** (behind/ahead, sync kế tiếp và pha của nó, xung đột; nút đặt giờ, −30/+30 phút, Cancel, Done/Abort, Take over, Refresh). Desktop: thẻ có icon pixel; terminal: mỗi thẻ một dòng. Màu nhấn vàng sơn mài, con dấu `★ A5`, năm điều ở chân pane. Status line: `★ A5`, lease quá hạn, RAM dưới cổng PIE, `Sync HH:MM cutoff/frozen`. |
| 🟥 / ⏯️ (`hooks/decision.ts`) | Luôn bật: tiêu đề `🟥 …` / `⏯️ …`, unread; 🟥 ngoài intent vào `PENDING.md` một lần. Toast 🟥 chỉ khi A5 bật. |

Mọi lần a5 từ chối đều cùng một dạng: `A5 · <cổng> — <vì sao> → <làm gì tiếp>`.

## Lệnh
- `/a5 on` · `/a5 off`: bật/tắt A5 cho mọi session (mặc định **tắt**).
- `/a5` hoặc `/a5 status`: trạng thái, số lần theo từng điều, vị trí của a5 so với Ather, và Editor/RAM/Sync khi A5 bật.
- `/a5 sync HH:MM [build] [for <id8|lane>]` · `/a5 sync move HH:MM` · `/a5 sync build on|off` · `/a5 sync cancel` · `/a5 sync done [ghi chú]` · `/a5 sync abort <lý do>` · `/a5 sync takeover` · `/a5 sync` (trạng thái, có khung freeze).
- Muốn agent sửa mod: `/a5 off` trước (bảo vệ kit là luật D1 của A5).

## Tool cho model (chỉ đăng ký khi A5 bật)
- `mcp__a5__editor`: `request` (thêm `launch: false` cho slot không mở Editor) · `release` · `extend` · `status`.
- `mcp__a5__sync`: `plan` (`build`) · `move` · `build` · `cancel` · `conflicts` (khi dry-run không chạy được) · `done` · `abort` · `status`.
- Agent type `a5:sync` (sync worker): chỉ a5 khởi động, không hiện cho model.

## Tuỳ chọn (`pluginConfigs."a5"` trong `~/.claude/settings.json`)
- `a5WhenPresent`: `ask` (mặc định) hoặc `deny`.
- `motion`: `on` (mặc định) hoặc `off`.
- `editorLock`: mặc định `E:/Projects/s2/Saved/EDITOR_OWNER.txt`; repo S2 và thư mục `Saved/A5/` suy ra từ đây.
- `launchGatePieGb` (31) và `launchGateGb` (28): cổng launch mặc định; panel ghi đè chung cho mọi session, *Reset* trả về giá trị này.
- `syncMergeMinutes` (45) và `syncBuildMinutes` (90): độ dài tối đa của freeze sau giờ sync (hard end), không build / có build.
- `pendingFile`: trống = `%USERPROFILE%/.claude/PENDING.md`.
- File `rules/scope` (mỗi dòng một glob): sửa file ngoài scope sẽ bị hỏi.

## File điều phối (trong `Saved/` của checkout S2, git-ignore, không bao giờ vào git hay `docs/intent/`)
- `Saved/A5/editor/<id8>.json`: mỗi session A5 một file, chỉ session đó ghi (heartbeat mỗi phút, yêu cầu, lease, lời nhờ nhường, id notice đã giao).
- `Saved/A5/sync.json`: kế hoạch sync (giờ, build, hard end, xung đột, file untracked, worker, các session đã nhắn), chỉ holder ghi; riêng trạng thái *expired* thì session nào thấy trước ghi.
- `Saved/A5/alerts/<key>.json`: mỗi 🟥 của tầng điều phối (sync expired, merge bỏ dở) chỉ một session nêu, ai tạo file trước.
- `Saved/A5/touch/<id8>.json`: đường dẫn session đã sửa trong checkout chung.
- `Saved/A5/probe.json`: lần đo máy gần nhất (RAM, ổ đĩa, tiến trình nặng), ai đo thì người đó ghi.
- Đọc thêm: `Saved/EDITOR_OWNER.txt` (lock), `Saved/AtherAutomata/lanes/*.json` (heartbeat của Ather: session còn sống không).

Session được coi là đã mất khi heartbeat của nó cũ hơn 3 phút (và không có lane Ather tươi nào bảo lãnh), hoặc lane Ather của nó báo `hasEnded` / cũ hơn 10 phút. Không có file nào thì là *chưa rõ*, không bao giờ là *mất*.

## Một bộ luật cho hai engine
`rules/config.json` cùng định dạng với plugin Hermes (`a5-kit-v2`). Sửa xong chạy:
```
python tests/make_fixture.py <thư mục mod>
claude plugin test <thư mục mod>
```

## Kiểm tra
```
claude plugin validate D:/Projects/ather-mods/a5
npx -y -p typescript@5.6 tsc -p D:/Projects/ather-mods/a5
claude plugin test D:/Projects/ather-mods/a5
```

## Giới hạn
- Hook là best-effort: lách được bằng biến hoặc script trung gian; file sửa bằng lệnh shell không vào cổng báo cáo và không vào file touch.
- Không có compare-and-set: lock ghi theo kiểu đọc-so-ghi rồi đọc lại; hai người ghi chen giữa hai lần đọc thì một người thua và tick sau quyết lại.
- "Checkout chung" = working tree chính (`.git` là thư mục); worktree liên kết (`.git` là file) là của worker. `cd <worktree> && git …` vẫn bị coi là checkout chung (dùng `git -C`).
- Dry-run lúc cutoff dùng `origin/main` đã fetch lần cuối (a5 không fetch); chỉ 40 đường dẫn đầu được xếp theo rule 11, phần còn lại tính là foreign; tối đa 5.000 file main thêm mới được kiểm tra trên đĩa.
- `/clear` đổi id session: a5 chuyển file session, dòng lock (`session <id8 mới>`), yêu cầu đang chờ và sync đang giữ sang id mới trong vòng vài giây (như Ather chuyển lane). Trong mấy giây đó lane cũ của Ather đã báo kết thúc; nếu đúng lúc ấy Editor không chạy và một session khác đang đầu hàng tick trúng, lease có thể bị giải phóng trước khi kịp chuyển.
- Hard end tính cả khi worker đang merge dở: freeze hết thì các session khác vẫn bị `MERGE_HEAD` chặn git ghi cho tới khi merge xong hoặc bị abort; Hai nhận 🟥.
- Tổng quan đếm session theo danh sách của app (id của app khác id CLI), còn tên và việc nhắn tin dựa vào lane của Ather; một session S2 không có cả Ather lẫn a5 chỉ được đếm, không được nêu tên hay nhắn.
- Needs you của Ather chỉ hiện director call của intent Hai làm owner; 🟥 chuyển tiếp F-<n> của intent người khác sẽ không vào PENDING.md.
- Animation SMIL chạy trong khung SVG cách ly của desktop; terminal chỉ có ký tự tĩnh.
