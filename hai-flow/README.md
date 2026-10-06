# hai-flow 0.4

Flow riêng của Hai, chạy **cạnh** Ather Automata và không sửa code của Ather.

- **A5 tắt** (mặc định): Ather y như bản Ather phát hành. Pane, status line và toast là của Ather; hai-flow không chặn gì. Chỉ còn dấu 🟥/⏯️ trên tiêu đề session.
- **A5 bật** (`/a5 on`): năm điều và cổng báo cáo, cộng ba công cụ điều phối cho các session dùng chung một checkout S2 trên một máy: **Editor holder**, **RAM** và **Sync main holder**. Ba công cụ này dùng chung một đồng hồ và một kênh tin nhắn: các notice `hai-flow ·`.

## Cài đặt

Mod nằm ở `D:/Projects/ather-mods/hai-flow` (repo `ather-mods`, cạnh `ather-automata/`). Nạp bằng `CLAUDE_CODE_PLUGIN_DIRS` trong khối `env` của `~/.claude/settings.json`, và **hai-flow phải đứng đầu danh sách** (plugin nạp trước nằm ngoài chuỗi hook, nên mới bọc được pane của Ather):

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "D:/Projects/ather-mods/hai-flow;D:/Projects/ather-mods/ather-automata" }
```

Trên Windows các thư mục cách nhau bằng `;`. Đổi đường dẫn cũ (thư mục scratch của session S2) sang đường dẫn này rồi mở session mới. `/a5 status` cho biết hai-flow có đứng trên Ather không.

## Những gì A5 thêm

| Phần | Làm gì |
|---|---|
| Năm điều (`hooks/a5.ts`, `a5/config.json`, `a5/rules-a5.md`) | Như 0.3: đứng **sau** flow intent của Ather, chỉ thêm kiểm tra. Chặn `--no-verify`, `GIT_LFS_SKIP_SMUDGE=1`, sửa chính mod, `sparse-checkout set` trong checkout chung. Hỏi Hai trước git phá dữ liệu hoặc đổi nhánh trong checkout chung, config repo, force push, push main, `git add .`, xoá đệ quy ngoài TEMP, settings.json. Worker (subagent) không bao giờ hỏi Hai: bị từ chối, dừng và báo. Cuối lượt: báo cáo `Changed / Verified / Risk / Open`; có intent đang track thì `Verified:` theo proof của Ather. |
| **Editor holder** (`hooks/coord.ts`, tool `mcp__hai-flow__editor`) | Một Editor mỗi máy. Session xin slot bằng tool (`request`: số phút, có PIE không, có build không, làm gì). Hàng đợi tính giống hệt nhau ở mọi session từ các file `Saved/HaiFlow/editor/<id8>.json` (mỗi session chỉ ghi file của mình): ai xin trước được trước; trong cutoff và freeze thì người giữ sync đứng đầu. Chỉ session đầu hàng lấy lock khi lock rảnh, slot phải kết thúc trước cutoff của sync kế tiếp, và RAM phải qua cổng launch. Lock ghi đúng dòng chuẩn S2 (`HELD … · held by <lane>, session <id8>, until HH:MM`; `FREE … background=none · free since HH:MM`), Ather vẫn đọc được. Không ai được Edit/Write/redirect vào `Saved/EDITOR_OWNER.txt` khi A5 bật: dùng tool. Xin ≤ 20 phút, không build: holder được nhờ nhường ở điểm an toàn kế tiếp, tối đa một lần mỗi giờ (holder không có hai-flow thì nhận dòng chuẩn `UE request:`). Holder được báo 5 phút trước khi hết lease, lúc hết lease, và khi giữ mà 15 phút không dùng. Lease cũ chỉ được giải phóng khi lane của holder đã mất **và** không còn UnrealEditor; Editor còn chạy mà holder mất thì chỉ báo, không bao giờ kill. `release` (dừng PIE và mọi tiến trình nền gọi MCP trước; `dont_save` cho package bỏ), `extend` (trước khi hết lease, nếu còn vừa), `status`. |
| **RAM** | Trước khi cấp slot, session đầu hàng chạy dọn dẹp an toàn: reaper của S2 (`.agents/skills/git-poller-storm/scripts/reap-orphan-git.ps1`) khi RAM trống < 14 GB; tắt LiveCodingConsole chỉ khi không có UnrealEditor nào chạy; các tiến trình nặng khác chỉ được nêu tên, không kill. Cổng launch (mặc định ≥ 31 GB khi slot có PIE, ≥ 28 GB khi không) chỉnh được trên panel và trong tuỳ chọn; Editor đang mở thì dùng lại, không cần cổng launch. Cổng PIE cố định: bắt đầu ≥ 5 GB, dừng khi < 3 GB (notice khi PIE của session đang chạy). Ổ chứa checkout < 20 GB thì báo. |
| **Sync main holder** (tool `mcp__hai-flow__sync`, `/a5 sync`) | Lên lịch merge `origin/main` trên panel (giờ đặt sẵn) hoặc `/a5 sync HH:MM [for <session>]`. Session lên lịch giữ sync, trừ khi chỉ định session khác; chỉ holder đổi, dời, huỷ hay kết thúc (`Saved/HaiFlow/sync.json`, một người ghi). Cutoff = sync − 30 phút: mọi session A5 nhận notice commit đường dẫn của mình, viết resume note, dừng PIE và trả Editor trước sync − 10. Lúc cutoff, hai-flow của holder chạy `git merge-tree --write-tree --name-only HEAD origin/main` (60 s, theo origin/main đã fetch lần cuối) và xếp từng xung đột theo rule 11 (self: main chỉ giữ bản cũ của nhánh mình, resolve về ours; foreign: chủ sở hữu quyết, xung đột logic hoặc `.uasset/.umap` thì abort). Mỗi xung đột tới đúng session đã sửa đường dẫn đó (mỗi hai-flow ghi các đường dẫn session và worker của nó sửa trong checkout chung vào `Saved/HaiFlow/touch/<id8>.json`). Từ giờ sync tới khi `done`/`abort`: các session không giữ sync bị từ chối git ghi (commit, add, rm, mv, checkout, switch, restore, reset, stash, merge, rebase, pull, push, cherry-pick, revert, clean, am) và mọi lệnh dùng Editor trong checkout chung. Done/abort mở lại và báo mọi session đã được báo về sync đó. Holder mất thì người khác bấm *Take over*. |
| **Notice** | Mọi notice bắt đầu `hai-flow · <cổng> — <chuyện gì> → <làm gì>`, do hai-flow của chính session nhận đưa vào: giữa lượt thì kèm vào kết quả tool kế tiếp của vòng chính (không bao giờ vào kết quả của worker); session rảnh mà notice cần làm gì đó (cấp slot, nhờ nhường, hết lease, cutoff, xung đột, mở freeze) thì đúng **một** prompt; còn lại đi kèm prompt kế tiếp của Hai. Mỗi notice chỉ giao một lần (id lưu trong file session, sống qua reload). Không gửi tin chéo giữa các session hai-flow; file là sự thật, notice chỉ là chuông cửa. Ghi một dòng `hai-flow ·` vào `docs/intent/**` (Edit, Write, MultiEdit hay lệnh shell) bị từ chối, nên log và findings của intent không bị nhiễu. |
| Pane Ather | Ngay dưới hàng thẻ của Ather, ba thẻ: **Editor holder** (ai giữ, tới mấy giờ, còn bao lâu, vị trí của session này trong hàng), **Memory** (RAM trống so với cổng launch và cổng PIE, lần dọn gần nhất, nút −1 GB / +1 GB / Reset cho cổng launch, áp dụng cho mọi session), **Sync main** (behind/ahead, sync kế tiếp và pha của nó, xung đột; nút đặt giờ, −30/+30 phút, Cancel, Done/Abort, Take over, Refresh). Desktop: thẻ có icon pixel; terminal: mỗi thẻ một dòng. Màu nhấn vàng sơn mài, con dấu `★ A5`, năm điều ở chân pane. Status line: `★ A5`, lease quá hạn, RAM dưới cổng PIE, `Sync HH:MM cutoff/frozen`. |
| 🟥 / ⏯️ (`hooks/decision.ts`) | Luôn bật: tiêu đề `🟥 …` / `⏯️ …`, unread; 🟥 ngoài intent vào `PENDING.md` một lần. Toast 🟥 chỉ khi A5 bật. |

Mọi lần hai-flow từ chối đều cùng một dạng: `hai-flow · <cổng> — <vì sao> → <làm gì tiếp>`.

## Lệnh
- `/a5 on` · `/a5 off`: bật/tắt A5 cho mọi session (mặc định **tắt**).
- `/a5` hoặc `/a5 status`: trạng thái, số lần theo từng điều, vị trí của hai-flow so với Ather, và Editor/RAM/Sync khi A5 bật.
- `/a5 sync HH:MM [for <id8|lane>]` · `/a5 sync move HH:MM` · `/a5 sync cancel` · `/a5 sync done [ghi chú]` · `/a5 sync abort <lý do>` · `/a5 sync takeover` · `/a5 sync` (trạng thái).
- Muốn agent sửa mod: `/a5 off` trước (bảo vệ kit là luật D1 của A5).

## Tool cho model (chỉ đăng ký khi A5 bật)
- `mcp__hai-flow__editor`: `request` · `release` · `extend` · `status`.
- `mcp__hai-flow__sync`: `plan` · `move` · `cancel` · `conflicts` (khi dry-run không chạy được) · `done` · `abort` · `status`.

## Tuỳ chọn (`pluginConfigs."hai-flow"` trong `~/.claude/settings.json`)
- `a5WhenPresent`: `ask` (mặc định) hoặc `deny`.
- `motion`: `on` (mặc định) hoặc `off`.
- `editorLock`: mặc định `E:/Projects/s2/Saved/EDITOR_OWNER.txt`; repo S2 và thư mục `Saved/HaiFlow/` suy ra từ đây.
- `launchGatePieGb` (31) và `launchGateGb` (28): cổng launch mặc định; panel ghi đè chung cho mọi session, *Reset* trả về giá trị này.
- `pendingFile`: trống = `%USERPROFILE%/.claude/PENDING.md`.
- File `a5/scope` (mỗi dòng một glob): sửa file ngoài scope sẽ bị hỏi.

## File điều phối (trong `Saved/` của checkout S2, git-ignore, không bao giờ vào git hay `docs/intent/`)
- `Saved/HaiFlow/editor/<id8>.json`: mỗi session A5 một file, chỉ session đó ghi (heartbeat mỗi phút, yêu cầu, lease, lời nhờ nhường, id notice đã giao).
- `Saved/HaiFlow/sync.json`: kế hoạch sync, chỉ holder ghi.
- `Saved/HaiFlow/touch/<id8>.json`: đường dẫn session đã sửa trong checkout chung.
- Đọc thêm: `Saved/EDITOR_OWNER.txt` (lock), `Saved/AtherAutomata/lanes/*.json` (heartbeat của Ather: session còn sống không).

Session được coi là đã mất khi heartbeat của nó cũ hơn 3 phút (và không có lane Ather tươi nào bảo lãnh), hoặc lane Ather của nó báo `hasEnded` / cũ hơn 10 phút. Không có file nào thì là *chưa rõ*, không bao giờ là *mất*.

## Một bộ luật cho hai engine
`a5/config.json` cùng định dạng với plugin Hermes (`a5-kit-v2`). Sửa xong chạy:
```
python tests/make_fixture.py <thư mục mod>
claude plugin test <thư mục mod>
```

## Kiểm tra
```
claude plugin validate D:/Projects/ather-mods/hai-flow
npx -y -p typescript@5.6 tsc -p D:/Projects/ather-mods/hai-flow
claude plugin test D:/Projects/ather-mods/hai-flow
```

## Giới hạn
- Hook là best-effort: lách được bằng biến hoặc script trung gian; file sửa bằng lệnh shell không vào cổng báo cáo và không vào file touch.
- Không có compare-and-set: lock ghi theo kiểu đọc-so-ghi rồi đọc lại; hai người ghi chen giữa hai lần đọc thì một người thua và tick sau quyết lại.
- "Checkout chung" = working tree chính (`.git` là thư mục); worktree liên kết (`.git` là file) là của worker. `cd <worktree> && git …` vẫn bị coi là checkout chung (dùng `git -C`).
- Dry-run lúc cutoff dùng `origin/main` đã fetch lần cuối (hai-flow không fetch); chỉ 40 đường dẫn đầu được xếp theo rule 11, phần còn lại tính là foreign.
- `/clear` đổi id session: lease đang giữ vẫn mang id cũ, sẽ hiện như holder đã mất (Editor còn chạy thì chỉ báo).
- Needs you của Ather chỉ hiện director call của intent Hai làm owner; 🟥 chuyển tiếp F-<n> của intent người khác sẽ không vào PENDING.md.
- Animation SMIL chạy trong khung SVG cách ly của desktop; terminal chỉ có ký tự tĩnh.
