# Hướng dẫn cài đặt Hermes cho Office (dành cho người không rành máy tính)

Bạn **không cần biết lập trình**. Chỉ cần làm theo từng bước dưới đây. Máy tính cần có mạng Internet và đã cài Microsoft Word / Excel / PowerPoint.

Trong quá trình cài, chương trình sẽ **hỏi bạn** những câu đơn giản dạng `[Y/n]`:
- Gõ **Y** (hoặc chỉ bấm **Enter**) = Đồng ý.
- Gõ **n** rồi Enter = Không.

Đầu tiên chương trình hỏi chọn ngôn ngữ: gõ **1** cho Tiếng Việt, **2** cho English.

---

## Windows

1. Tải toàn bộ thư mục dự án về máy (nút **Code → Download ZIP** trên GitHub), rồi **giải nén**.
2. Mở thư mục vừa giải nén, **nhấp đúp (double-click)** vào file **`install.bat`**.
3. Nếu Windows hiện cảnh báo xanh "Windows protected your PC": bấm **More info → Run anyway**.
4. Trả lời các câu hỏi trong cửa sổ đen:
   - *Bạn có muốn tự động cài Git / Python / Node.js không?* → **Y** (nếu máy chưa có).
   - *Bạn có muốn tự động tải & cài Hermes Agent không?* → **Y**.
   - *Bạn có muốn cài Antigravity (agy) không? (tùy chọn)* → **Y** sẽ mở trang tải Antigravity.
   - *Bạn có muốn bật plugin Antigravity trong Hermes không?* → **Y** nếu đã cài `agy` **và đã đăng nhập vào agy**. Nếu chưa, bỏ qua; sau khi đăng nhập Google trong tiện ích, plugin sẽ được bật tự động (hoặc chạy `./install.sh plugin` trong Git Bash).
5. Khi thấy dòng **"Xong!"**, đóng cửa sổ. Nếu Windows hỏi "Có tin cậy chứng chỉ localhost?" → bấm **Yes**.

> Nếu Office không tự hiện tiện ích: **Insert → Add-ins → Shared Folder → Hermes for Office**. Nếu mục này trống, xem phần *Thêm thủ công* ở cuối.

## macOS

**Cách 1 (dễ nhất):** nhấp đúp vào file **`install.command`**. Nếu macOS chặn, nhấp chuột phải → **Open → Open**.

**Cách 2 (1 dòng lệnh):** mở **Terminal** (nhấn `Cmd + Space`, gõ *Terminal*), kéo thư mục dự án vào cửa sổ Terminal sau chữ `cd `, rồi chạy:

```bash
./install.sh
```

Khi macOS hỏi mật khẩu để tin cậy chứng chỉ → nhập mật khẩu máy của bạn. Sau đó **tắt hẳn và mở lại** Word/Excel/PowerPoint.

---

## Đăng nhập Google ngay trong Word / Excel / PowerPoint

1. Mở tài liệu → **Insert (Chèn) → Add-ins → Hermes for Office** (trên Windows: *Shared Folder*; trên macOS: *Developer Add-ins*).
2. Bảng **Hermes** hiện ra bên phải. Lần đầu sẽ có cửa sổ **"Đăng nhập Google / Gmail"**.
3. Bấm nút **"Đăng nhập bằng tài khoản Google"**.
4. Trình duyệt tự mở trang Google. Nếu không tự mở, bấm dòng chữ **"Trình duyệt không tự mở? Bấm vào đây để đăng nhập"** trong bảng Hermes.
5. Chọn tài khoản Gmail → bấm **Cho phép (Allow)**.
6. Quay lại Office: cửa sổ tự đóng, **email của bạn hiện ở góc trên** của bảng Hermes. Bấm vào email 2 lần để đăng xuất.

Nếu máy chưa có Hermes Agent, cửa sổ sẽ hiện nút **"Cài Hermes Agent tự động"** — bấm và chờ 1–2 phút, sau đó đăng nhập như trên.

Mô hình AI: **Gemini 3.8 Flash** trả lời nhanh khi bạn sửa nhanh (phím **F6**); **Claude Sonnet** suy luận ở phía sau cho các yêu cầu phức tạp. Bạn không cần chọn gì thêm.

---

## Bộ kỹ năng Office (tự cài cùng Hermes)

Khi cài đặt xong, 29 kỹ năng Office (làm slide, soạn báo cáo, soát lỗi, bảng điểm, làm sạch bảng…) đã nằm sẵn trong thư mục `.hermes/skills` của bạn. Bạn không cần làm gì thêm: cứ nói việc cần làm, ví dụ "Tạo file trình chiếu về Coca-Cola" hoặc "Làm sạch bảng này".

- Cập nhật hoặc cài lại riêng các kỹ năng: macOS chạy `./install.sh skills`; Windows chạy lại `install.bat` (hoặc mở Git Bash trong thư mục cài và chạy `./install.sh skills`). Việc này an toàn, chạy bao nhiêu lần cũng được.
- Kỹ năng bạn tự viết có cùng tên sẽ **không bị ghi đè**.
- Muốn tắt việc Hermes tự chọn kỹ năng theo câu lệnh: đặt biến môi trường `HERMES_OFFICE_AUTOSKILL=0` rồi khởi động lại dịch vụ.
- Hermes chỉ gửi **từ khóa chủ đề** khi tìm trên mạng, không gửi nội dung tài liệu của bạn.

---

## Gặp sự cố?

| Hiện tượng | Cách xử lý |
|---|---|
| Bảng Hermes báo "Không kết nối được cầu nối" | Chạy lại `install.bat` / `./install.sh` (hoặc `./install.sh service-restart`). |
| Không thấy tiện ích trong Office | Tắt hẳn Office rồi mở lại; kiểm tra bằng `./install.sh status`. |
| Đăng nhập báo thất bại | Bấm lại nút đăng nhập; kiểm tra mạng; thử trình duyệt khác làm mặc định. |
| Xem nhật ký lỗi | File `~/.hermes-office/bridge.log` (Windows: `C:\Users\<tên bạn>\.hermes-office\bridge.log`). |

### Sự cố riêng trên Windows

| Hiện tượng | Nguyên nhân thường gặp và cách xử lý |
|---|---|
| `bash\r: No such file`, `$'\r': command not found` | File `.sh` bị đổi thành xuống dòng kiểu Windows (CRLF) khi `git clone`. Dự án đã có `.gitattributes` ép LF; nếu bạn đã clone trước đó, chạy `git rm --cached -r . && git reset --hard` hoặc tải lại ZIP. |
| "Thieu python" dù đã cài | Windows có "python giả" mở Microsoft Store. Trình cài giờ tự bỏ qua bản giả và tìm bản thật (hoặc dùng `py -3`). Nếu vẫn lỗi: cài Python từ python.org, tick *Add python.exe to PATH*, mở cửa sổ mới. |
| "schtasks /Create failed" hoặc dịch vụ không tự chạy khi đăng nhập | Tạo tác vụ định kỳ cần quyền quản trị. Không có quyền thì trình cài tự chuyển sang mục khởi động của riêng bạn (`HKCU\...\Run`) và vẫn chạy cầu nối ngay. |
| Cầu nối chạy rồi tự tắt, không có log | Bản chạy ngầm (`pythonw.exe`) không có cửa sổ console nên trước đây bị sập âm thầm. Giờ log luôn được ghi vào `C:\Users\<tên bạn>\.hermes-office\bridge.log`. |
| "Hermes CLI not found" dù đã cài Hermes | Hermes cài qua Git Bash là một script không có đuôi `.exe`; cầu nối giờ tự chạy nó qua Git Bash. Có thể đặt biến `HERMES_BIN` trỏ tới file `hermes` để chỉ rõ. |
| Đọc PDF báo thiếu công cụ | Windows không có `pdftotext`; `pypdf` (đã có trong `requirements.txt`) sẽ được dùng. Chạy lại `install.bat` để cài. |
| Chạy tay để xem lỗi | Mở Git Bash trong thư mục dự án: `bridge/.venv/Scripts/python.exe bridge/hermes_office_bridge.py --port 8765` rồi mở https://localhost:8765/health |

### Thêm thủ công (Windows, khi không tự đăng ký được)
1. Tạo thư mục, ví dụ `C:\HermesCatalog`, chép `manifest.xml` vào đó, rồi **chia sẻ (Share)** thư mục này.
2. Trong Word: **File → Options → Trust Center → Trust Center Settings → Trusted Add-in Catalogs**, dán đường dẫn chia sẻ dạng `\\TÊN-MÁY\HermesCatalog`, tích **Show in Menu**, bấm OK, khởi động lại Word.

### Gỡ cài đặt
`./install.sh uninstall` (macOS/Git Bash).
