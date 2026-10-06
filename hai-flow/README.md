# hai-flow 0.3

Flow riêng của Hai, chạy **cạnh** Ather Automata (không sửa code Ather). Nạp qua `CLAUDE_CODE_PLUGIN_DIRS`, và phải đứng **đầu** danh sách (plugin nạp trước nằm ngoài chuỗi hook, nên mới bọc được pane của Ather).

| Phần | Khi nào | Làm gì |
|---|---|---|
| A5 (`hooks/a5.ts`, `a5/config.json`, `a5/rules-a5.md`) | chỉ khi `/a5 on` | Đứng **sau** flow intent của Ather: chỉ thêm kiểm tra, không thay bước nào. Chặn `--no-verify`, `GIT_LFS_SKIP_SMUDGE=1`, sửa chính mod, `sparse-checkout set` trong checkout chung. Hỏi Hai (Cho chạy lần này / Cho cả session này / Không): git phá dữ liệu hoặc đổi nhánh **trong checkout chung** (worktree riêng của worker thì không hỏi), config repo trong checkout chung, force push, push main, `git add .`, xoá đệ quy ngoài TEMP, settings.json. Worker (subagent) không bao giờ hỏi Hai: bị từ chối ngay, dừng và báo cho session giao việc. Đang away: câu hỏi vào ledger của Ather thành D-<n>. Cuối lượt: báo cáo `Changed / Verified / Risk / Open` cho file do chính session sửa. Có intent đang track: `Verified:` theo **proof của Ather** (chỉ ghi rung Ather đã đọc pass; rung fail → FAILED; chưa đủ proof theo role → `chưa: <còn thiếu>`). Không có intent: build/test/PIE sau lần sửa cuối, hoặc `chưa: <lý do>`. Build chỉ tính theo dòng `Result:`. |
| Editor (`hooks/editor.ts`) | luôn | StartPIE, save, ghi qua Unreal MCP, mở/tắt Editor chỉ khi `EDITOR_OWNER.txt` ghi `session <id8>` của chính session. PIE cần ≥ 5 GB RAM trống. Cấm save-all. |
| 🟥 / ⏯️ (`hooks/decision.ts`) | luôn | Quyết định của intent là finding (worker thêm `F-<n>` vào findings.md, đúng skill intent) → Ather hiện ở **Needs you**; session chính chuyển cho Hai bằng dòng 🟥 có mã `F-<n>`, hook **không** chép sang PENDING.md. Đang away: dùng AskUserQuestion → Ather ghi D-<n>. Còn lại: `🟥 NEEDS DECISION` → 1 dòng `PENDING.md`. Mọi 🟥: tiêu đề `🟥 …`, unread, toast. `⏯️` → tiêu đề `⏯️ …`. Hai gõ prompt → tiêu đề trở lại. |
| Pane Ather (`hooks/watch.ts`, `hooks/icons.ts`, `hooks/theme.ts`) | luôn (session S2) | Ngay dưới hàng thẻ của Ather: 3 thẻ **Editor** (ai giữ, tới mấy giờ, còn bao lâu) · **Memory** (RAM trống, thanh đo theo cổng PIE) · **Branch** (tên nhánh, behind/ahead origin/main, nút *Sync* giao session chạy Phase 0–1 của s2-sync-main, *Refresh*). Mỗi thẻ có icon pixel; màu icon là trạng thái. |
| Chuyển động | tuỳ chọn `motion` (mặc định `on`) | Icon dither hiện lại khi trạng thái thẻ đổi; icon Branch quét dither khi Sync đang chạy; con dấu A5 dập vào khi bật A5. Đứng yên khi không có gì đổi. Desktop: SVG + SMIL; terminal: ký tự `▣ ▥ ⎇`. |
| Theme A5 | khi `/a5 on` | Màu nhấn lime → vàng sơn mài `#E8B84A`; con dấu đỏ `★ A5` cạnh tên Ather; năm điều nằm một dòng ở chân pane (chỉ hiện số với điều đã chạm). Status line có `★ A5`. |

Mọi lần hai-flow từ chối đều cùng một dạng: `hai-flow · <cổng> — <vì sao> → <làm gì tiếp>`.

## Lệnh
- `/a5 on` · `/a5 off`: bật/tắt A5 cho mọi session (mặc định **tắt**).
- `/a5` hoặc `/a5 status`: trạng thái, số lần theo từng điều, vị trí của hai-flow so với Ather.
- Muốn agent sửa mod: `/a5 off` trước (bảo vệ kit là luật D1 của A5).

## Tuỳ chọn (`pluginConfigs."hai-flow"` trong `~/.claude/settings.json`)
- `a5WhenPresent`: `ask` (mặc định) hoặc `deny`.
- `motion`: `on` (mặc định) hoặc `off`.
- `editorLock`: mặc định `E:/Projects/s2/Saved/EDITOR_OWNER.txt` (repo S2 suy ra từ đây cho thẻ Branch).
- `pendingFile`: trống = `%USERPROFILE%/.claude/PENDING.md`.
- File `a5/scope` (mỗi dòng một glob): sửa file ngoài scope sẽ bị hỏi.

## Một bộ luật cho hai engine
`a5/config.json` cùng định dạng với plugin Hermes (`a5-kit-v2`). Sửa xong chạy:
```
python tests/make_fixture.py <thư mục mod>
claude plugin test <thư mục mod>
```

## Giới hạn
- Hook là best-effort: lách được bằng biến hoặc script trung gian; file sửa bằng lệnh shell không vào cổng báo cáo.
- "Checkout chung" = working tree chính (`.git` là thư mục); worktree liên kết (`.git` là file) là của worker. Lệnh `cd <worktree> && git …` vẫn bị coi là checkout chung (dùng `git -C`, đúng AGENTS.md).
- Khoá `where: "shared"` trong `a5/config.json` chỉ bản Claude hiểu; plugin Hermes bỏ qua nó (luật áp dụng mọi nơi, chặt hơn).
- Needs you của Ather chỉ hiện director call của intent Hai làm owner; 🟥 chuyển tiếp F-<n> của intent người khác sẽ không vào PENDING.md.
- Thẻ Branch chỉ đọc (rev-list, log, stat): không fetch, không status; số behind theo lần fetch gần nhất.
- Animation SMIL chạy trong khung SVG cách ly của desktop; terminal chỉ có ký tự tĩnh.
