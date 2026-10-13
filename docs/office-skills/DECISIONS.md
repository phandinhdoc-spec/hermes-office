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
- Với `tools.ts` chỉ thêm **một dòng import và một dòng trải bảng** (`...extraTools`, đặt ở **đầu** bảng để mọi mục tự viết trong `tools.ts` luôn thắng khi trùng tên). Hai hunk nhỏ, dễ gộp tay nếu bản của bạn khác.
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
- `office_web_search`, `office_web_fetch_image`, `office_web_fetch_text` là công cụ `bridge` (chạy trong cầu nối), nên không tạo bản Hoàn tác và không bị chặn bởi chế độ Duyệt trước. Chúng chỉ **đọc**, và chỉ gửi **từ khóa chủ đề**. Cầu nối còn:
  - từ chối truy vấn quá dài (> 120 ký tự) hoặc nhiều dòng (dạng dán nội dung tài liệu);
  - chặn scheme lạ (chỉ http/https), cổng khác 80/443, tên máy nội bộ, địa chỉ IP viết tắt (`127.1`, `0x7f.1`), loopback/riêng tư/liên kết nội bộ/metadata đám mây sau khi phân giải DNS; kiểm lại ở mỗi lần chuyển hướng (tối đa 3);
  - ảnh: chỉ nhận JPEG/PNG/GIF/WebP (nhận dạng theo nội dung, không tin `Content-Type`; SVG bị từ chối), tối đa 6 MB, dừng đọc khi vượt;
  - **ảnh đi bằng `imageId`**: base64 nằm trong bộ nhớ cầu nối và chỉ được chèn vào lệnh gửi cho add-in; không bao giờ đi qua mô hình;
  - kết quả tìm kiếm và nội dung trang web gắn nhãn `untrusted` (dữ liệu, không phải mệnh lệnh).
- Nguồn: Wikipedia (vi/en), Wikimedia Commons và Openverse (ảnh có giấy phép), DuckDuckGo HTML (tìm chung, không cần khóa), tùy chọn Pexels/Unsplash nếu có `PEXELS_API_KEY` / `UNSPLASH_ACCESS_KEY`.
- Rủi ro còn lại: kiểm tra DNS rồi kết nối lại có thể bị đánh lừa bằng DNS-rebinding; chấp nhận được vì cầu nối chỉ nghe `127.0.0.1` và công cụ chỉ đọc. Nếu đi qua proxy hệ thống, phân giải do proxy làm.
- Biến `HERMES_OFFICE_WEB_ALLOW_PRIVATE=1` chỉ dùng cho kiểm thử (máy chủ giả cục bộ); không bật trong sử dụng thật.

## D-007. Bộ định tuyến skill trong cầu nối
- Skill chỉ có tác dụng nếu Hermes nạp đúng skill. Với mô hình yếu, tự chọn theo `description` không chắc chắn.
- Chọn: cầu nối so khớp từ khóa trong câu lệnh người dùng (ví dụ "trình chiếu", "slide", "báo cáo", "bảng điểm") và thêm tên skill tương ứng vào tham số `-s` **cho lượt đó** (không ghi đè lựa chọn của người dùng, giới hạn 2 skill, chỉ khi skill đã được cài). Tắt bằng `HERMES_OFFICE_AUTOSKILL=0`.

## D-008. Cài skill vào `~/.hermes/skills/`
- Chọn một nơi duy nhất làm việc này: hàm `sync_bundled_skills()` trong cầu nối (chạy mỗi lần khởi động và qua `--sync-skills`), để macOS và Windows dùng cùng một mã. `install.sh` có bước `skills` (`./install.sh skills`) gọi lệnh đó; `install.ps1` gọi `install.sh` nên Windows cũng qua bước này.
- Quy tắc an toàn: chỉ ghi skill có `metadata.hermes.origin: hermes-office` trong frontmatter (`skills/office-user-style` không có dấu này nên không bị lệnh này đụng tới); không ghi đè bản bạn đã sửa tay (không có dấu hiệu này) và có sao lưu `SKILL.md.bak` khi nâng cấp.

## D-009. Giới hạn số vòng công cụ
- `MAX_TOOL_ROUNDS = 6` quá chặt cho "dựng deck": tìm, tải ảnh, dựng, kiểm tra, sửa. Tăng lên 14, cho phép đặt bằng `HERMES_OFFICE_MAX_ROUNDS`.

## D-010. Kiểm thử không có Office và không có Hermes thật
- `bridge/tests/fakes.py`: `FakeHermes` (một chương trình giả đặt qua `HERMES_BIN`, in câu trả lời có sẵn chứa khối `office-tool`, ghi lại tham số `-s` và prompt từng lần gọi) và `FakeTaskpane` (khách WebSocket đóng vai add-in, trả kết quả giả cho `rpc_request`). `test_e2e_flows.py` chạy 3 luồng chính (PowerPoint, Word, Excel) và cả chế độ Tự động/Duyệt trước/Chỉ hỏi đáp qua cầu nối thật.
- **Không** kiểm chứng: Hermes thật, mã Office.js trong Office thật, mạng thật (môi trường chặn ra ngoài, xem BLOCKERS B-004).

## D-011. Đẩy nhánh sớm theo mốc
- Brief nói đẩy khi mọi bài kiểm thử đạt. Mình đẩy nhánh `feature/office-skills` sau mỗi mốc lớn đã build đạt để không mất việc nếu phiên dừng giữa chừng. Vẫn không merge, không mở PR, không đụng `main`.

## D-012. Năm công cụ cầu nối khai báo nhưng `tools.ts` của nhánh này không có
- `office_word_get_page_setup`, `office_word_set_page_setup`, `office_word_apply_style`, `office_excel_design_table`, `office_ppt_apply_palette` có trong bảng `TOOLS` của cầu nối nhưng không có trong `addin/src/office/tools.ts` ở bất kỳ nhánh nào trên GitHub (có thể bản dở dang trên máy bạn đã có). Nhiều skill dùng chúng.
- Chọn: viết bản dự phòng trong file mới `compat_extra.ts`, đặt **trước** trong bảng, nên nếu `tools.ts` của bạn có cùng tên thì bản của bạn thắng. Có test (`test_registry.py`) giữ cho cả bốn nơi đăng ký khớp nhau.

## D-013. Thêm hai công cụ ngoài mục 4 của brief
- `office_ppt_set_shape_text` (sửa chữ một khối, giữ phông) và `office_ppt_delete_slide`: không có chúng thì skill `ppt-lint-fix` không tách được slide quá nhiều chữ và không thu gọn được khối chữ. `office_ppt_delete_slide` bắt buộc có `slideIndex` rõ ràng (không xóa "slide đang chọn" mặc định).

## D-014. Ảnh trong PowerPoint
- Office.js chưa có `shapes.addPicture` ở bản phát hành. Chọn: tạo hình chữ nhật rồi `fill.setImage(base64)`. Hình chữ nhật có đúng tỉ lệ ảnh (`fitRect`) để ảnh không méo; không cắt xén được, nên "cover" chỉ kéo giãn khi lệch tỉ lệ ≤ 12%, còn lại là "contain".

## D-015. Tiêu đề slide là khung chữ, không phải placeholder
- `office_ppt_build_slide` dùng bố cục trống (Blank) rồi thêm khung chữ tên `Hermes-TieuDe` / `Hermes-NoiDung`. Ưu: kiểm soát cỡ chữ (≥ 36/24 pt) và vị trí. Nhược: không hiện trong chế độ Outline của PowerPoint. Chấp nhận để skill đảm bảo được chất lượng trình bày; nếu cần outline, dùng `office_ppt_add_slide` với layout có sẵn.

## D-016. Không ghi đè cả tài liệu Word
- `office_word_set_range` với `which: "whole"` ghi đè tất cả; skill cấm dùng khi tài liệu đã có chữ (có test `test_no_dangerous_whole_replace`). Skill sửa theo đoạn (`office_word_set_paragraph_text`, `office_word_apply_style_by_index`, `office_word_find_replace`).

## D-017. Con số thể thức hành chính phải do bạn xác nhận
- `word-format-vn-admin` dùng thông số của Nghị định 30/2020/NĐ-CP (A4; lề trên/dưới 20–25 mm, trái 30–35 mm, phải 15–20 mm; Times New Roman 13–14; số trang giữa đầu trang, bỏ trang đầu; giãn đoạn ≥ 6 pt) theo hiểu biết của mình, **chưa đối chiếu lại văn bản gốc** vì môi trường không ra mạng. Skill luôn dặn người dùng kiểm lại và nói rõ nếu cơ quan có mẫu riêng. Cần bạn đối chiếu một lần.
- Tương tự, ngưỡng xếp loại trong `excel-grade-sheet` chỉ là mặc định có thể đổi; skill luôn nêu ngưỡng đã dùng.
