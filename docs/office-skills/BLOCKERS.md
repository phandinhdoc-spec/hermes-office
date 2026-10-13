# Việc không làm được hoặc chưa kiểm chứng (BLOCKERS)

| Mã | Việc | Tình trạng | Hướng xử lý đã chọn |
|---|---|---|---|
| B-001 | Ghi chú thuyết trình (speaker notes) trong PowerPoint | Bản API Office.js phát hành **không có** thao tác ghi chú | `office_ppt_set_notes` ghi vào khung chữ `Hermes-GhiChu` đặt dưới slide (ngoài vùng trình chiếu, không hiện khi chiếu). Người dùng copy vào ô Ghi chú. Khi Office có API chính thức chỉ cần đổi một hàm. |
| B-002 | `hermes tools list`, `hermes skills list` | Môi trường khảo sát không có Hermes | Chỉ dựa vào cách cầu nối gọi Hermes. Việc Hermes tự chọn skill theo `description` chưa kiểm chứng, nên có bộ định tuyến (D-007). |
| B-003 | Mã Office.js mới (chèn ảnh, nền slide, ghi chú, lint, tiêu đề/chân trang, mục lục, bình luận, kiểm tra dữ liệu, cố định hàng…) | Chỉ biên dịch bằng `tsc`, **chưa chạy trong Word/Excel/PowerPoint thật** | Có kiểm thử logic thuần (lint, bố cục) bằng `node --test`. Cần bạn thử trong Office thật, danh sách việc cần thử nằm ở cuối `PROGRESS.md`. |
| B-004 | Tìm web/ảnh thật | **Đã thử, bị chặn** (proxy trả 403 cho Wikipedia, Commons, Openverse) | Kiểm thử bằng máy chủ HTTP cục bộ và dữ liệu mẫu. Phần đọc kết quả API của Wikipedia/Commons/Openverse/DuckDuckGo được viết theo định dạng đã biết, **chưa đối chiếu với phản hồi thật**: nếu một nguồn đổi định dạng, nguồn đó trả rỗng và cầu nối thử nguồn kế tiếp. Cần bạn thử `office_web_search` một lần. |
| B-005 | Sửa đổi dở dang trên máy bạn | Không truy cập được | Xem D-001, D-002. Có thể phải gộp tay một hunk 2 dòng trong `tools.ts`. |
| B-006 | `fix/windows-installer-openssl` chưa nằm trong `quick-tools` | Không phải việc của nhiệm vụ này | Không đụng tới. Cần bạn quyết định gộp. |
| B-007 | Hoạt ảnh, hiệu ứng chuyển slide | Office.js không hỗ trợ | Skill nói rõ giới hạn, không hứa làm. |
| B-008 | Chạy `install.sh` / `install.ps1` thật trên macOS và Windows | Môi trường là Linux; `install.sh` từ chối chạy trên Linux | Phần cài skill nằm trong Python (`--sync-skills`), đã chạy thật ở đây (cài mới, chạy lại không đổi, không ghi đè skill của người dùng). `install.sh` chỉ thêm hàm `do_skills` và lệnh `skills`, mới kiểm cú pháp `bash -n`, **chưa chạy**. `install.ps1` không đổi (nó gọi `install.sh`). |
| B-009 | Năm công cụ có trong cầu nối nhưng thiếu trong `tools.ts` của nhánh | Xem D-012 | Đã có bản dự phòng `compat_extra.ts` (chưa chạy trong Office thật). `office_word_get_page_setup`/`set_page_setup` cần Word desktop (WordApiDesktop 1.3). |
| B-010 | Số trang, mục lục trong Word Online / Word cũ | `insertField` (WordApi 1.5) và `pageSetup` có thể không có | Tool trả thông báo rõ và skill hướng dẫn làm tay. |
| B-011 | Căn cứ thể thức hành chính và ngưỡng xếp loại | Không tra được văn bản gốc (không ra mạng) | Xem D-017. |
| B-012 | Hermes có thật sự làm theo từng bước skill hay không | Không có Hermes thật | Bộ định tuyến (D-007) chỉ đảm bảo skill được nạp. Chất lượng làm theo phụ thuộc mô hình; skill viết ví dụ lệnh cụ thể để mô hình yếu vẫn theo được. Cần bạn thử với mô hình đang dùng. |
