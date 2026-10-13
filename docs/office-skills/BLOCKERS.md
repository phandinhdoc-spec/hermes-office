# Việc không làm được hoặc chưa kiểm chứng (BLOCKERS)

| Mã | Việc | Tình trạng | Hướng xử lý đã chọn |
|---|---|---|---|
| B-001 | Ghi chú thuyết trình (speaker notes) trong PowerPoint | Bản API Office.js phát hành **không có** thao tác ghi chú | `office_ppt_set_notes` ghi vào khung chữ `Hermes-GhiChu` đặt dưới slide (ngoài vùng trình chiếu, không hiện khi chiếu). Người dùng copy vào ô Ghi chú. Khi Office có API chính thức chỉ cần đổi một hàm. |
| B-002 | `hermes tools list`, `hermes skills list` | Môi trường khảo sát không có Hermes | Chỉ dựa vào cách cầu nối gọi Hermes. Việc Hermes tự chọn skill theo `description` chưa kiểm chứng, nên có bộ định tuyến (D-007). |
| B-003 | Mã Office.js mới (chèn ảnh, nền slide, ghi chú, lint, tiêu đề/chân trang, mục lục, bình luận, kiểm tra dữ liệu, cố định hàng…) | Chỉ biên dịch bằng `tsc`, **chưa chạy trong Word/Excel/PowerPoint thật** | Có kiểm thử logic thuần (lint, bố cục) bằng `node --test`. Cần bạn thử trong Office thật, danh sách việc cần thử nằm ở cuối `PROGRESS.md`. |
| B-004 | Tìm web/ảnh thật từ môi trường này | Môi trường có thể chặn ra ngoài | Kiểm thử bằng máy chủ HTTP giả cục bộ. Kết quả gọi mạng thật (nếu có) được ghi riêng trong báo cáo cuối. |
| B-005 | Sửa đổi dở dang trên máy bạn | Không truy cập được | Xem D-001, D-002. Có thể phải gộp tay một hunk 2 dòng trong `tools.ts`. |
| B-006 | `fix/windows-installer-openssl` chưa nằm trong `quick-tools` | Không phải việc của nhiệm vụ này | Không đụng tới. Cần bạn quyết định gộp. |
| B-007 | Hoạt ảnh, hiệu ứng chuyển slide | Office.js không hỗ trợ | Skill nói rõ giới hạn, không hứa làm. |
| B-008 | Chạy `install.sh` / `install.ps1` thật trên macOS và Windows | Môi trường là Linux | Phần cài skill nằm trong Python (`--sync-skills`), đã kiểm thử ở đây. Hai script chỉ gọi lệnh đó và chưa chạy thật. |
