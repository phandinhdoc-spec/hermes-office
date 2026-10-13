# Tiến độ (PROGRESS)

Giờ theo Asia/Ho_Chi_Minh. Nhánh: `feature/office-skills` (từ `origin/feature/quick-tools`). Không merge, không PR, không đụng `main`.

## Giai đoạn 1 · Khảo sát (xong)
- Chọn nền, đọc cầu nối/taskpane/trình cài đặt, đối chiếu API Office.js với bản khai báo đã cài. Ghi `SURVEY.md`, `DECISIONS.md`, `BLOCKERS.md`.

## Giai đoạn 2 · Danh mục và cầu nối (xong)
- `SKILL_CATALOG.md`: 29 skill (PowerPoint 9, Word 9, Excel 8, dùng chung 3).
- Cầu nối: `office_web.py` (tìm web/ảnh, ảnh đi bằng `imageId`), `office_calc.py` (chia điểm, chia nhóm), `office_skills.py` (định tuyến skill, cài skill), `office_tools_extra.py` (khai báo công cụ mới). Vòng công cụ tối đa 14.

## Giai đoạn 3 · Công cụ trong taskpane (xong, chưa chạy trong Office thật)
- 32 công cụ mới trong `ppt_extra.ts`, `word_extra.ts`, `excel_extra.ts` + 5 công cụ dự phòng trong `compat_extra.ts`; logic thuần trong `ppt_logic.ts`, `word_logic.ts`, `excel_logic.ts`. `tools.ts` chỉ thêm 2 dòng. Nhãn tiếng Việt/Anh trong `toolLabels.ts`.

## Giai đoạn 4 · Skill (xong)
- 29 file `skills/<slug>/SKILL.md`, đều có `origin: hermes-office`.

## Giai đoạn 5 · Tích hợp (xong, chưa chạy trên máy cài thật)
- `install.sh skills`, đồng bộ khi cầu nối khởi động; menu `/` ưu tiên skill của ứng dụng; 9 prompt mẫu có ô `[ ]` trong thư viện `@`; thông báo khi cầu nối tự thêm skill.

## Giai đoạn 6 · Kiểm thử và tài liệu (xong)
- Đã thật sự chạy và đạt:
  - `cd bridge && python3 -m pytest tests -q`: **219 test đạt** (web an toàn và SSRF, tính điểm/chia nhóm, định tuyến skill, cài skill, định dạng 29 skill, tên công cụ và tên đối số trong skill, đồng bộ 4 nơi đăng ký công cụ, 7 luồng đầu–cuối với hermes giả).
  - `cd addin && npm test`: **32 test đạt** (bố cục slide, kiểm lỗi PowerPoint/Word/Excel, làm sạch số, so sánh bảng, prompt mẫu).
  - `cd addin && npm run build`: đạt ở **từng commit** và ở commit cuối trong `git worktree` sạch (`npm ci` rồi build, rồi pytest).
  - `python3 bridge/hermes_office_bridge.py --sync-skills` với `HOME` tạm: cài 29 skill, chạy lại không đổi gì, không ghi đè skill cùng tên của người dùng.
- **Chưa chạy / không kiểm chứng được** (xem `BLOCKERS.md`): mọi mã Office.js trong Word/Excel/PowerPoint thật; Hermes CLI thật; gọi web thật (proxy trả 403); `install.sh`/`install.ps1` trên macOS/Windows (`install.sh` chỉ kiểm cú pháp).

## Cần thử trong Office thật (bạn làm khi dậy)
Mỗi dòng: việc cần làm, và kết quả đúng là gì. Nên thử trên bản sao tài liệu.

PowerPoint
1. Nói "Tạo file trình chiếu về Coca-Cola": ra khoảng 10 slide, chữ tiêu đề ≥ 36 pt, nội dung ≥ 24 pt, không còn khung "Click to add title". (Kiểm tra `office_ppt_build_slide` với bố cục Blank, `slides.add` với `layoutId`.)
2. Slide có ảnh: ảnh hiện đúng, không méo (`fill.setImage` trên hình chữ nhật); `office_ppt_get_lint` không báo thiếu alt text.
3. Lời thuyết trình: có khung "Hermes-GhiChu" dưới slide, không hiện khi chiếu. (PowerPoint chưa cho ghi vào ngăn Ghi chú.)
4. `office_ppt_set_background` (nền màu và nền ảnh), `office_ppt_reorder_slide`, `office_ppt_delete_slide`, `office_ppt_set_shape_text` giữ nguyên phông.
5. Bản PowerPoint cũ hoặc Online có thể không có `slide.background`, `pageSetup` hay `moveTo`: xem thông báo lỗi có dễ hiểu không.

Word
6. `office_word_get_outline` / `office_word_apply_style_by_index` trên tài liệu có tiêu đề tiếng Việt ("Tiêu đề 1"): kiểu được nhận ra đúng cấp.
7. `office_word_insert_toc` (chèn trường mục lục), `office_word_set_header_footer` với số trang giữa đầu trang và trang đầu khác biệt, `office_word_set_numbering` (danh sách số/gạch đầu dòng), `office_word_add_comment`, `office_word_insert_image` kèm chú thích.
8. `office_word_set_page_setup` đặt A4 và lề 20/20/30/15 mm (cần Word desktop, WordApiDesktop 1.3).
9. Với "Soát lỗi chính tả": chữ trong đoạn được thay mà kiểu và định dạng đoạn giữ nguyên; Hoàn tác đưa văn bản về như cũ.

Excel
10. `office_excel_clean_range` trên ô có "1.234,5", " 12 ", "1.234": đổi đúng, "1.234" được để nguyên và báo; ô công thức không bị đụng.
11. `office_excel_remove_duplicates`, `office_excel_set_validation` (danh sách, số thập phân), `office_excel_freeze_panes`, `office_excel_get_diff` (theo cột khóa), `office_excel_highlight_cells`, `office_excel_find_replace`.
12. Công thức tiếng Anh (dấu phẩy) trong `office_excel_set_formula` chạy được trên Excel cài tiếng Việt.

Chung
13. Cài thật trên macOS và Windows: `./install.sh` (hoặc `install.bat`) rồi kiểm `~/.hermes/skills` có 29 thư mục `ppt-*`, `word-*`, `excel-*`, `office-*`.
14. Với mô hình đang dùng: Hermes có thật sự nạp skill (thanh thông báo "Đang dùng kỹ năng …") và làm theo bước không? Thử 3 câu: "Tạo file trình chiếu Coca-Cola", "Soát lỗi chính tả", "Làm sạch bảng này".
15. `office_web_search` thật (Wikipedia, Commons, Openverse): có kết quả; nếu trả rỗng thì cho mình biết nguồn nào đổi định dạng.
16. Đối chiếu con số thể thức hành chính trong `word-format-vn-admin` với Nghị định 30/2020/NĐ-CP (D-017).
17. Gộp tay `addin/src/office/tools.ts` nếu bản trên máy bạn khác: chỉ có dòng `import { extraTools } from "./extra";` và dòng `...extraTools,` ở đầu bảng `tools`.
