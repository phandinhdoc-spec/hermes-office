# Danh mục skill Office (bản chốt)

29 skill: **PowerPoint 9, Word 9, Excel 8, dùng chung 3** (brief yêu cầu tối thiểu 24 skill, mỗi ứng dụng ≥ 8).
Mỗi skill nằm ở `skills/<slug>/SKILL.md`, mô tả (`description`) tiếng Việt, dạng "Dùng khi …".
Ưu tiên: **P0** làm trước, **P1** sau, **P2** nếu còn thời gian. Cả ba mức đều đã được viết.

Công cụ ghi **MỚI** là công cụ thêm trong đợt này. Công cụ đọc luôn có `_get_` hoặc `_list_` trong tên để không bị chặn ở chế độ Duyệt trước / Chỉ hỏi đáp.

| # | App | Slug | Ví dụ ra lệnh | Hermes tự làm | Công cụ chính | Ưu tiên |
|---|---|---|---|---|---|---|
| 1 | PPT | `ppt-deck-from-brief` | "Tạo file trình chiếu Coca-Cola" | Dàn ý 8–12 slide → tìm tư liệu và ảnh → chọn bảng màu, phông, nền → dựng từng slide → ghi chú → tự kiểm tra và sửa | `office_web_search`, `office_web_fetch_image`, `office_design_palette`, `office_design_font_pair`, `office_ppt_build_slide` MỚI, `office_ppt_set_background` MỚI, `office_ppt_set_notes` MỚI, `office_ppt_get_lint` MỚI | P0 |
| 2 | PPT | `ppt-ad-deck` | "Làm bài quảng cáo sản phẩm [X]" | Slogan, điểm bán hàng (USP), đối tượng, 3 ý tưởng, chọn 1, bố cục ảnh lớn, chữ to | như #1 | P0 |
| 3 | PPT | `ppt-doc-to-slides` | "Biến file Word/PDF đính kèm thành slide" | Đọc mục lục, chia ý, mỗi slide 1 ý, chọn bảng/ảnh, ghi chú | `office_doc_list/outline/search/read/summarize_part`, `office_ppt_build_slide` | P0 |
| 4 | PPT | `ppt-lesson-deck` | "Soạn slide bài [tên bài] lớp [x]" | Khởi động → hình thành kiến thức → luyện tập → vận dụng; câu hỏi và đáp án ở slide sau; ảnh minh họa | `office_ppt_build_slide`, `office_web_search` | P1 |
| 5 | PPT | `ppt-restyle` | "Làm đẹp bộ slide này" | Giữ nội dung, đổi bảng màu, phông, cỡ chữ ≥ 24 pt, căn lề, kiểm tương phản | `office_ppt_list_shapes` MỚI, `office_ppt_apply_palette`, `office_ppt_apply_format`, `office_ppt_get_lint` | P0 |
| 6 | PPT | `ppt-lint-fix` | "Kiểm tra và sửa lỗi bộ slide" | Phát hiện chữ nhỏ, tràn khung, quá nhiều chữ, lẫn phông, thiếu alt text, tương phản; tự sửa | `office_ppt_get_lint`, `office_ppt_move_shape`, `office_ppt_resize_shape`, `office_ppt_set_alt_text` MỚI | P0 |
| 7 | PPT | `ppt-speaker-notes` | "Viết lời thuyết trình 10 phút" | Chia thời lượng theo slide, viết lời nói, gợi ý chuyển slide | `office_ppt_get_slides`, `office_ppt_set_notes` | P1 |
| 8 | PPT | `ppt-image-sourcing` | "Thêm ảnh phù hợp cho các slide" | Từ khóa ảnh theo nội dung, tìm, tải, chèn, ghi nguồn, thay khi không hợp | `office_web_search`, `office_web_fetch_image`, `office_ppt_insert_image` MỚI | P1 |
| 9 | PPT | `ppt-quiz-game` | "Tạo trò chơi ôn tập chủ đề [x]" | Bộ câu hỏi trắc nghiệm / ô chữ dạng slide, đáp án ở slide sau | `office_ppt_build_slide` | P2 |
| 10 | Word | `word-report-from-brief` | "Viết báo cáo về [chủ đề] 5 trang" | Dàn ý → tư liệu → soạn → tiêu đề, mục lục, bảng, hình → định dạng | `office_web_search`, `office_word_set_range`, `office_word_apply_style_by_index` MỚI, `office_word_insert_toc` MỚI, `office_word_insert_image` MỚI | P0 |
| 11 | Word | `word-format-vn-admin` | "Chuẩn hóa văn bản này theo thể thức hành chính" | Lề, Times New Roman 13–14 pt, giãn dòng, số trang, tiêu ngữ, căn lề theo Nghị định 30/2020/NĐ-CP | `office_word_set_page_setup`, `office_word_apply_format`, `office_word_set_header_footer` MỚI, `office_word_get_outline` MỚI | P0 |
| 12 | Word | `word-proofread-vn` | "Soát lỗi chính tả, dấu, văn phong" | Sửa lỗi chắc chắn, thống nhất thuật ngữ, đánh dấu chỗ nghi ngờ bằng bình luận | `office_word_get_outline`, `office_word_find_replace` MỚI, `office_word_set_paragraph_text` MỚI, `office_word_add_comment` MỚI | P0 |
| 13 | Word | `word-summarize-doc` | "Tóm tắt tài liệu này 1 trang" | Tóm tắt có đề mục, gạch đầu dòng, số liệu then chốt, chèn đầu tài liệu | `office_word_get_full_text`, `office_doc_*`, `office_word_insert_text` | P0 |
| 14 | Word | `word-exam-builder` | "Soạn đề kiểm tra [môn] [lớp] 45 phút" | Ma trận, đề, đáp án, thang điểm (bội của 0,25), công thức LaTeX → OMML | `office_calc_split_points` MỚI, `office_word_insert_equation`, `office_word_insert_table`, `office_word_set_numbering` MỚI | P1 |
| 15 | Word | `word-letter-forms` | "Soạn đơn xin [x] / biên bản họp / quyết định" | Điền khuyết `[…]`, đúng thể thức, ngày tháng, chữ ký | `office_word_set_range`, `office_word_insert_table`, `office_word_apply_format` | P1 |
| 16 | Word | `word-translate-keep-format` | "Dịch sang tiếng Anh giữ nguyên định dạng" | Dịch từng đoạn theo chỉ số, giữ kiểu, bảng, công thức | `office_word_get_outline`, `office_word_set_paragraph_text` | P1 |
| 17 | Word | `word-structure-fix` | "Chuẩn hóa tiêu đề và mục lục" | Gán Heading 1/2/3, đánh số, tạo mục lục | `office_word_get_outline`, `office_word_apply_style_by_index`, `office_word_insert_toc`, `office_word_set_numbering` | P1 |
| 18 | Word | `word-table-from-text` | "Biến đoạn này thành bảng" | Nhận diện cột/hàng, dựng bảng, tô tiêu đề, căn | `office_word_insert_table`, `office_word_format_table` MỚI | P2 |
| 19 | Excel | `excel-clean-data` | "Làm sạch bảng này" | Cắt khoảng trắng, bỏ trùng, chuẩn số và ngày, báo cáo thay đổi | `office_excel_get_lint` MỚI, `office_excel_clean_range` MỚI, `office_excel_remove_duplicates` MỚI | P0 |
| 20 | Excel | `excel-grade-sheet` | "Lập bảng điểm và chia nhóm" | Tính điểm, xếp loại, chia nhóm cân bằng, điểm là bội của 0,25 hoặc 0,125 theo thang | `office_excel_set_formula`, `office_calc_balanced_groups` MỚI, `office_excel_sort_filter`, `office_excel_freeze_panes` MỚI | P0 |
| 21 | Excel | `excel-dashboard` | "Làm trang tổng quan từ dữ liệu này" | Chọn biểu đồ phù hợp, tổng hợp, tô điều kiện, bố cục 1 trang | `office_excel_insert_chart`, `office_excel_conditional_format`, `office_excel_design_table` | P0 |
| 22 | Excel | `excel-formula-doctor` | "Sửa lỗi công thức / giải thích công thức" | Tìm `#REF!`/`#DIV/0!`/`#N/A`, giải thích từng bước, đề xuất công thức gọn hơn | `office_excel_get_range`, `office_excel_get_lint`, `office_excel_set_formula` | P0 |
| 23 | Excel | `excel-budget-planner` | "Lập bảng chi tiêu tháng" | Khung thu/chi, công thức tổng, biểu đồ, cảnh báo vượt ngân sách | `office_excel_create_table`, `office_excel_conditional_format`, `office_excel_set_validation` MỚI | P1 |
| 24 | Excel | `excel-schedule-builder` | "Lập thời khóa biểu / lịch trực" | Bảng lịch, kiểm tra trùng, tô màu theo người/môn | `office_excel_set_range_values`, `office_excel_set_validation`, `office_excel_conditional_format` | P1 |
| 25 | Excel | `excel-data-from-doc` | "Lấy bảng trong PDF/Word này vào Excel" | Trích bảng, chuẩn hóa cột, kiểu dữ liệu | `office_doc_*`, `office_excel_set_range_values`, `office_excel_clean_range` | P1 |
| 26 | Excel | `excel-compare-sheets` | "So sánh hai bảng này" | Tìm dòng khác, thêm, thiếu; tô màu và lập báo cáo | `office_excel_get_diff` MỚI, `office_excel_highlight_cells` MỚI | P2 |
| 27 | Chung | `office-plan-first` | (tự kích hoạt khi việc lớn) | Hiện kế hoạch 5–8 bước trước khi sửa; gợi ý bật "Duyệt trước" khi thao tác hàng loạt | các công cụ hiện có | P0 |
| 28 | Chung | `office-qa-checklist` | "Kiểm tra chất lượng tài liệu" | Tương phản, cỡ chữ, alt text, thứ tự đọc, phông thống nhất, lỗi chính tả | `office_ppt_get_lint`, `office_word_get_lint` MỚI, `office_excel_get_lint` | P1 |
| 29 | Chung | `office-quick-actions` | (menu `/`) | Tóm tắt vùng chọn, viết lại ngắn hơn, đổi giọng văn, dịch, giải thích | `office_word_get_selection`, `office_excel_get_range`, `office_word_replace_selection` | P0 |

## Thay đổi so với bảng khởi điểm

- Tên công cụ đọc đổi cho đúng quy tắc: `office_ppt_lint` → `office_ppt_get_lint` (tương tự Word, Excel).
- Công cụ **bổ sung** ngoài mục 4 của brief, vì skill không làm được nếu thiếu: `office_ppt_build_slide`, `office_ppt_set_alt_text`, `office_ppt_set_shape_text`, `office_ppt_delete_slide`, `office_word_get_outline`, `office_word_apply_style_by_index`, `office_word_set_paragraph_text`, `office_word_format_table`, `office_word_get_lint`, `office_excel_clean_range`, `office_excel_get_diff`, `office_excel_highlight_cells`, `office_calc_split_points`, `office_calc_balanced_groups`.
- Không thêm skill ngoài 29 skill này. Không bỏ skill nào.

## Công cụ mới theo nơi chạy

| Nơi chạy | Công cụ |
|---|---|
| Cầu nối (Python) | `office_web_search`, `office_web_fetch_image`, `office_web_fetch_text`, `office_calc_split_points`, `office_calc_balanced_groups` |
| PowerPoint (taskpane) | `office_ppt_build_slide`, `office_ppt_insert_image`, `office_ppt_set_background`, `office_ppt_set_notes`, `office_ppt_list_shapes`, `office_ppt_move_shape`, `office_ppt_resize_shape`, `office_ppt_delete_shape`, `office_ppt_reorder_slide`, `office_ppt_set_alt_text`, `office_ppt_set_shape_text`, `office_ppt_delete_slide`, `office_ppt_get_lint` |
| Word (taskpane) | `office_word_insert_image`, `office_word_set_header_footer`, `office_word_insert_toc`, `office_word_add_comment`, `office_word_find_replace`, `office_word_set_numbering`, `office_word_get_outline`, `office_word_apply_style_by_index`, `office_word_set_paragraph_text`, `office_word_format_table`, `office_word_get_lint` |
| Excel (taskpane) | `office_excel_set_validation`, `office_excel_freeze_panes`, `office_excel_remove_duplicates`, `office_excel_find_replace`, `office_excel_clean_range`, `office_excel_get_lint`, `office_excel_get_diff`, `office_excel_highlight_cells` |

## Công cụ dự phòng (D-012)
Cầu nối khai báo nhưng `tools.ts` của nhánh không có; `compat_extra.ts` bổ sung: `office_word_get_page_setup`, `office_word_set_page_setup`, `office_word_apply_style`, `office_excel_design_table`, `office_ppt_apply_palette`.
