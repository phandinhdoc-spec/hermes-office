# Khảo sát hiện trạng (SURVEY)

Ngày khảo sát: 2026-10-14. Người khảo sát: Claude (phiên chạy tự động, không có người trực).

## 1. Nền code đã dùng

| Mục | Kết quả |
|---|---|
| Nhánh xuất phát | `origin/feature/quick-tools` (commit `7a66983`, đẩy lúc 01:38 ngày 2026-10-14). Đây là nhánh mới nhất có đủ chế độ Duyệt trước, Hoàn tác, `office_doc_*`, menu `/` và `@`. |
| Nhánh làm việc | `feature/office-skills` (tạo từ nhánh trên). `main` (`9e2f074`) cũ hơn nhiều và thiếu các tính năng này. |
| Sửa đổi dở dang trên máy bạn | **Không nhìn thấy được** từ môi trường này (chỉ có bản đã push lên GitHub). Xem `DECISIONS.md` D-001, D-002 về cách tránh va chạm. |
| Hermes CLI | **Không có** trong môi trường khảo sát (`which hermes` rỗng, không có `~/.hermes`). Vì vậy `hermes tools list` và `hermes skills list` **chưa chạy được**. Toàn bộ mô tả bên dưới về Hermes lấy từ cách cầu nối gọi nó, không phải từ chạy thật. |

## 2. Cầu nối (`bridge/hermes_office_bridge.py`, ~2090 dòng)

- FastAPI + WebSocket `/ws`. Mỗi lượt chat chạy `hermes chat --query-file <tệp> -Q --oneshot [-m model] [--provider p] [-s skill1,skill2] [-t toolset] [--reasoning mức]`.
- Hermes ra lệnh sửa Office bằng khối ` ```office-tool {"tool","args"} ``` `. Cầu nối thực thi qua `Session.rpc`, trả kết quả vào lịch sử, lặp tối đa `MAX_TOOL_ROUNDS = 6` vòng.
- Bảng `TOOLS` (host `word|excel|powerpoint|bridge`). Công cụ `bridge` chạy ngay trong cầu nối (`office_style_*`, `office_design_*`, `office_doc_*`).
- `MUTATING` = công cụ khác `bridge` mà tên **không** chứa `_get_` hoặc `_list_`. Ở chế độ `approve` chúng chờ bấm Áp dụng, ở `readonly` bị từ chối. Mỗi lượt có công cụ ghi đầu tiên sẽ kích hoạt chụp bản sao (Hoàn tác) ở phía taskpane.
- Tên `office_ppt_lint` theo brief sẽ bị coi là công cụ **ghi** (thiếu `_get_`), nên đổi thành `office_ppt_get_lint` (xem D-004).
- Công cụ `bridge` **không** đi qua chốt Duyệt trước/Chỉ hỏi đáp. Với công cụ web (gửi từ khóa ra Internet) mình giữ ở dạng `bridge` nhưng chỉ nhận từ khóa ngắn, xem D-006.
- `RPC_TIMEOUT = 60 s` cho mỗi lệnh gửi sang taskpane.
- Kỹ năng: `skill_dirs()` = `~/.hermes/skills` + `HERMES_SKILLS_DIRS`. Danh sách lấy từ bảng của `hermes skills list` (ký tự `│`). Mô tả tiếng Việt lấy từ `SKILL_VI`, nếu không có thì dùng `description` trong frontmatter.
- Có sẵn: `office_design_palette` (kèm tính tương phản), `office_design_font_pair`, tài liệu đính kèm lớn (BM25 trong RAM), bộ nhớ dự án, mẫu lệnh.
- `fetch_url_text` có sẵn **không** chặn địa chỉ nội bộ (dùng cho nút đính kèm liên kết do người dùng bấm). Công cụ web mới của skill dùng bộ chặn riêng, chặt hơn (D-006).

## 3. Taskpane (`addin/`)

- React 18 + Fluent UI + Tailwind, build bằng `cd addin && npm run build` (= `tsc --noEmit && vite build`).
- `src/office/tools.ts`: bảng `tools` tên → hàm; `src/office/{word,excel,powerpoint}.ts`: lệnh Office.js; `src/office/snapshot.ts`: bản sao để Hoàn tác (Word: tệp base64; PowerPoint: tệp base64; Excel: ô và định dạng số).
- `src/lib/toolLabels.ts`: nhãn tiếng Việt/Anh cho từng công cụ (bước thao tác hiển thị dạng câu).
- Menu `/` (kỹ năng) sắp theo `skillUse` rồi kỹ năng do người dùng tạo; menu `@` (thư viện prompt) gồm mẫu của người dùng rồi `CHIPS` dựng sẵn; ô điền khuyết `[ ]` đi bằng Tab/Shift+Tab.
- Trình cài đặt `install.sh` / `install.ps1` **chưa** cài thư mục `skills/` vào `~/.hermes/skills/` (kể cả `office-user-style`). Việc này được bổ sung (D-008).

## 4. Phiên bản API Office.js (đối chiếu `@types/office-js` đã cài, bản phát hành, không phải preview)

| Việc cần làm | API có sẵn | Ghi chú |
|---|---|---|
| Nền slide | `slide.background.fill.setSolidFill / setPictureOrTextureFill` | PowerPointApi **1.10** (chỉ bản Office mới). Cần dò `isSetSupported`; nếu thiếu dùng hình chữ nhật phủ kín đưa ra sau cùng. |
| Chèn ảnh vào slide | `shape.fill.setImage(base64)` trên hình chữ nhật, hoặc `Office.context.document.setSelectedDataAsync(base64, {coercionType: Image, imageLeft, imageTop, imageWidth, imageHeight})` | Không có `shapes.addPicture`. Dùng cách thứ nhất khi có PowerPointApi 1.10 (đặt vị trí chính xác, có alt text), cách thứ hai làm phương án dự phòng. |
| Ghi chú thuyết trình | **Không có** trong bản API phát hành | `office_ppt_set_notes` dùng phương án thay thế: khung chữ `Hermes-GhiChu` đặt ngoài vùng slide, và ghi rõ giới hạn (BLOCKERS B-001). |
| Di chuyển / đổi cỡ / xóa hình | `shape.left/top/width/height`, `shape.delete()` | Có. |
| Sắp lại slide | `slide.moveTo(index)` | Có. |
| Kích thước slide | `presentation.pageSetup.slideWidth/slideHeight` | Có. |
| Alt text | `shape.altTextDescription` | Có. |
| Word: chèn ảnh | `range.insertInlinePictureFromBase64` | WordApi 1.1. |
| Word: đầu/cuối trang | `section.getHeader/getFooter("Primary")` | WordApi 1.1. Số trang: `range.insertField(..., Word.FieldType.page)` (WordApi 1.5, thường chỉ có trên Word desktop). |
| Word: mục lục | `range.insertField(..., Word.FieldType.toc, ...)` | WordApi 1.5 (desktop). Nếu thiếu: dựng mục lục bằng văn bản từ các Heading (ghi rõ không tự cập nhật). |
| Word: bình luận | `range.insertComment` | WordApi 1.4. |
| Word: tìm và thay | `body.search` + `insertText` | WordApi 1.1. |
| Word: đánh số / gạch đầu dòng | `paragraph.startNewList()` + `list.setLevelNumbering/Bullet` | WordApi 1.3. |
| Excel: kiểm tra dữ liệu | `range.dataValidation.rule` | ExcelApi 1.8. |
| Excel: cố định hàng/cột | `worksheet.freezePanes.freezeRows/freezeColumns/freezeAt` | ExcelApi 1.7. |
| Excel: bỏ trùng | `range.removeDuplicates(columns, includesHeader)` | ExcelApi 1.9. |
| Excel: tìm và thay | `worksheet.findAll` / `range.replaceAll` | ExcelApi 1.9. |
| Hoạt ảnh, hiệu ứng chuyển slide | **Không có** | Giữ nguyên lời dặn trong `SYSTEM_PREAMBLE`. |

Mọi hàm mới đều được biên dịch bằng `tsc` với bộ khai báo trên, nhưng **chưa chạy trong Office thật** (xem `BLOCKERS.md`).

## 5. Khả năng Hermes mà skill được phép dựa vào

Chỉ dựa vào những thứ có bằng chứng trong code:

- Hermes đọc được `SKILL.md` qua cơ chế kỹ năng của nó (`-s tên`, hoặc tự chọn theo `description`). **Chưa kiểm chứng** việc tự chọn với mô hình thật, nên cầu nối bổ sung bộ định tuyến từ khóa (D-007) để nạp đúng skill cho mô hình yếu.
- Tìm web và tải ảnh: cầu nối tự cung cấp `office_web_search` và `office_web_fetch_image` (không phụ thuộc bộ công cụ web của Hermes, vốn chưa kiểm chứng được ở đây).
- Chạy mã: skill **không** yêu cầu Hermes chạy mã. Mọi thao tác đi qua `office-tool`.
