# Quyết định tự chọn (DECISIONS)

Mỗi mục: tình huống, lựa chọn an toàn nhất, lý do. Phiên chạy không được hỏi lại người dùng.

## D-001. Dùng `feature/quick-tools` làm nền, không dùng `main`
- Tình huống: brief nói "tạo nhánh từ nhánh hiện tại", nhưng từ GitHub không biết nhánh hiện tại trên máy bạn là gì. `main` thiếu chế độ Duyệt trước, Hoàn tác, `office_doc_*`, `toolLabels.ts`, menu `/` `@`, trong khi brief coi chúng là đã có.
- Chọn: `origin/feature/quick-tools` (push lúc 01:38, mới nhất, chứa toàn bộ các nhánh còn lại ngoại trừ `fix/windows-installer-openssl`).
- Lý do: là nhánh duy nhất khớp mô tả trong brief. Nếu máy bạn đang ở nhánh khác, chỉ cần `git rebase`/`cherry-pick` các commit của nhánh này.
- Việc cần bạn kiểm tra: `fix/windows-installer-openssl` (`11a1648`) **chưa** nằm trong `quick-tools`. Mình không đụng tới.

## D-002. Không sửa các file dở dang của bạn khi chưa chắc
- Các file trong danh sách của bạn (`SPEC.md`, `ToolsPanel.tsx`, `excel.ts`, `powerpoint.ts`, `tools.ts`, `word.ts`, `skills/office-user-style/SKILL.md`) có thể đang khác bản trên GitHub. Mình không thấy phần chưa commit đó.
- Chọn: **toàn bộ mã Office.js mới nằm trong file mới** `addin/src/office/{ppt,word,excel}_extra.ts` và `addin/src/office/extra.ts`.
- Với `tools.ts` chỉ thêm **một dòng import và một dòng trải bảng** (`...extraTools`), hunk nhỏ nên dễ gộp tay nếu bản của bạn khác.
- Không đụng `ToolsPanel.tsx`, `SPEC.md`, `office-user-style/SKILL.md`, `excel.ts`, `powerpoint.ts`, `word.ts`. Hệ quả: `office_ppt_generate_slide` cũ vẫn dùng cỡ chữ 32/18 pt; skill dùng công cụ mới `office_ppt_build_slide` (chữ ≥ 36/24 pt).
- `addin/src/lib/toolLabels.ts` không nằm trong danh sách dở dang nên được sửa trực tiếp (chỉ thêm dòng ở cuối bảng `ROWS`, để dễ gộp).

## D-003. `.gitignore` đang có dấu xung đột
- Đúng như bạn dặn: không sửa. Thư mục `addin/src/lib/` bị luật `lib/` chặn, nên mọi file mới ở đó phải `git add -f`.

## D-004. Đổi tên công cụ chỉ đọc cho đúng quy tắc `_get_` / `_list_`
- Brief ghi `office_ppt_lint`, `office_excel_lint`: thiếu `_get_` nên sẽ bị chặn ở Duyệt trước và Chỉ hỏi đáp.
- Chọn: `office_ppt_get_lint`, `office_word_get_lint`, `office_excel_get_lint`, `office_ppt_list_shapes` (đúng như brief).
- Không sửa biểu thức `MUTATING` trong cầu nối (tránh đổi hành vi đã có).

## D-005. Khả thi Office.js và phương án thay thế
- Ghi chú thuyết trình, nền slide trên bản Office cũ, hoạt ảnh: xem `SURVEY.md` mục 4 và `BLOCKERS.md`. Mọi phương án thay thế đều được nêu rõ trong skill tương ứng.

## D-006. Công cụ web nằm trong cầu nối, tối thiểu rủi ro
- `office_web_search` và `office_web_fetch_image` là công cụ `bridge` (chạy trong cầu nối), nên không tạo bản Hoàn tác và không bị chặn bởi chế độ Duyệt trước. Vì chúng chỉ **đọc** và chỉ gửi **từ khóa chủ đề**, mình coi đó là chấp nhận được. Cầu nối còn:
  - từ chối truy vấn quá dài (> 120 ký tự) hoặc có dạng gửi nội dung tài liệu (nhiều dòng);
  - chặn scheme lạ (chỉ http/https), chặn địa chỉ loopback/riêng tư/liên kết nội bộ/metadata đám mây sau khi phân giải DNS, kiểm tra lại ở mỗi lần chuyển hướng (tối đa 3);
  - ảnh: chỉ nhận `image/jpeg|png|gif|webp`, tối đa 6 MB, có thời hạn chờ; trả base64 kèm nguồn và giấy phép nếu biết;
  - nguồn tìm kiếm: Wikipedia (vi/en) và Wikimedia Commons / Openverse (ảnh, có giấy phép), DuckDuckGo HTML (tìm chung, không cần khóa), tùy chọn Pexels/Unsplash nếu có biến môi trường `PEXELS_API_KEY` / `UNSPLASH_ACCESS_KEY`.
- Lý do chọn: không cần khóa API, ảnh đi kèm thông tin giấy phép, không phụ thuộc bộ công cụ web của Hermes (chưa kiểm chứng được).

## D-007. Bộ định tuyến skill trong cầu nối
- Skill chỉ có tác dụng nếu Hermes nạp đúng skill. Với mô hình yếu, tự chọn theo `description` không chắc chắn.
- Chọn: cầu nối so khớp từ khóa trong câu lệnh người dùng (ví dụ "trình chiếu", "slide", "báo cáo", "bảng điểm") và thêm tên skill tương ứng vào tham số `-s` **cho lượt đó** (không ghi đè lựa chọn của người dùng, giới hạn 2 skill, chỉ khi skill đã được cài). Tắt bằng `HERMES_OFFICE_AUTOSKILL=0`.

## D-008. Cài skill vào `~/.hermes/skills/`
- Chọn một nơi duy nhất làm việc này: hàm `sync_bundled_skills()` trong cầu nối (chạy mỗi lần khởi động và qua `--sync-skills`), để macOS và Windows dùng cùng một mã. `install.sh` / `install.ps1` chỉ gọi lệnh đó.
- Quy tắc an toàn: chỉ ghi skill có dòng `x-hermes-office: bundled` trong frontmatter; không ghi đè bản bạn đã sửa tay (không có dấu hiệu này) và có sao lưu `SKILL.md.bak` khi nâng cấp.

## D-009. Giới hạn số vòng công cụ
- `MAX_TOOL_ROUNDS = 6` quá chặt cho "dựng deck": tìm, tải ảnh, dựng, kiểm tra, sửa. Tăng lên 14, cho phép đặt bằng `HERMES_OFFICE_MAX_ROUNDS`.

## D-010. Chạy kiểm thử không có Office và không có Hermes thật
- Dùng `HERMES_BIN` giả (kịch bản có sẵn câu trả lời chứa khối `office-tool`) và một khách WebSocket giả đóng vai taskpane. Cách này kiểm chứng đường đi của cầu nối, định tuyến skill, chế độ Duyệt trước, công cụ web (máy chủ HTTP cục bộ giả). **Không** kiểm chứng mã Office.js.

## D-011. Đẩy nhánh sớm theo mốc
- Brief nói đẩy khi mọi bài kiểm thử đạt. Mình đẩy nhánh `feature/office-skills` sau mỗi mốc lớn đã build đạt để không mất việc nếu phiên dừng giữa chừng. Vẫn không merge, không mở PR, không đụng `main`.
