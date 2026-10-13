# Hermes for Office (`hermes-office`)

Extension / Add-in cho Microsoft Office (**Word**, **Excel**, **PowerPoint**) kết nối trực tiếp với **Hermes Agent** cục bộ để đọc, phân tích và chỉnh sửa nội dung tài liệu trực tiếp theo thời gian thực — tương tự GitHub Copilot / Cursor cho bộ ứng dụng văn phòng.

---

## 🌟 Tính năng nổi bật

1. **Chỉnh sửa trực tiếp (In-document Editing)**:
   - **Word**: Thay thế/chèn văn bản, chèn bảng biểu, định dạng phong cách, đọc đoạn văn bản hiện tại.
   - **Excel**: Đọc/ghi giá trị ô tính, thiết lập công thức toán học (`SUM`, `VLOOKUP`,...), tô màu nền tiêu đề bảng, định dạng cột/hàng.
   - **PowerPoint**: Quét slide hiện tại, thêm slide mới, tạo và định dạng text box/shapes.
2. **Hỗ trợ công thức Toán, Lí, Hóa học chuẩn Word Equation (OMML)**:
   - Tự động phát hiện ký hiệu LaTeX (`$...$`, `$$...$$`, `\[...\]`) và công thức Hóa học (`\ce{...}` như `\ce{CaCO3 -> CaO + CO2 ^}`, `\ce{H2SO4}`).
   - Tự động chuyển đổi sang đối tượng **Equation chuẩn của Microsoft Word** (OMML) thay vì dán text thô.
3. **Chỉnh sửa dòng nhanh (Inline Edit) bằng phím tắt `F6`**:
   - Bấm **`F6`** (trên macOS / Windows) để mở thanh sửa nhanh dòng/đoạn đang chọn.
   - Nhập yêu cầu chỉnh sửa, xem trước (Preview Diff) và thay thế tức thì vào văn bản.
4. **Bảng điều khiển đa năng (Sleek Task Pane UI)**:
   - **Đa ngôn ngữ**: Nút gạt chuyển đổi **Viet / Eng** linh hoạt, mặc định tiếng Việt cho người dùng Việt Nam.
   - **Phân luồng Model thông minh**: Mặc định **Sonnet 3.5 / 5.5** làm lõi suy luận phân tích sâu và **Gemini 3.8 Flash** phản hồi siêu tốc cho thao tác inline.
   - **Bảng Kỹ năng (Skills)**: Quản lý hơn 150+ kỹ năng Hermes, hiển thị chú thích ý nghĩa chữ mờ song ngữ, nhấp vào xem bảng hướng dẫn chi tiết từng bước.
   - **Lưu lịch sử hội thoại**: Tự động lưu và khôi phục toàn bộ tiến trình chat qua các lần đóng/mở Office.
   - **Hiển thị tiến trình trực quan**: Hiệu ứng live shimmer progress (*Hermes đang suy nghĩ…*, *Đang áp dụng thay đổi…*), nút dừng (Stop) tức thì.
5. **Skill tự học thói quen định dạng (`office-user-style`)**:
   - Tự động nhận diện và học phong cách yêu thích của bạn (font chữ, cỡ chữ, căn lề, màu bảng tính) và đề xuất áp dụng đồng bộ.
6. **Dịch vụ chạy ngầm tự động (Auto-start Background Daemon)**:
   - Tự khởi động ngầm (`LaunchAgent` trên macOS / `Scheduled Task` trên Windows) mà không cần mở hay giữ cửa sổ terminal.

---

## 🚀 Cài đặt nhanh (Quick Start)

> 👉 **Người dùng không rành máy tính:** xem [`HDSD_CAI_DAT.md`](HDSD_CAI_DAT.md) — chỉ cần nhấp đúp `install.bat` (Windows) hoặc `install.command` (macOS). Script tự hỏi, tự tải Hermes Agent / Antigravity, rồi bạn **đăng nhập Gmail ngay trong tiện ích**.

### Yêu cầu tiên quyết
- **Hermes CLI** (`hermes`): script cài đặt sẽ hỏi và tự tải nếu chưa có; **Antigravity (`agy`)** là tùy chọn.
- **Node.js** (>= 18) và **Python 3** (>= 3.9).
- Microsoft Office (Word, Excel, PowerPoint) trên macOS hoặc Windows.

### 1. Cài đặt tự động trong 1 bước
Clone repository và chạy script cài đặt:
```bash
git clone https://github.com/phandinhdoc-spec/hermes-office.git
cd hermes-office
./install.sh
```
*Script sẽ tự động:*
- Tạo chứng chỉ SSL dev cục bộ cho `localhost:8765`.
- Cài đặt thư viện Python (`bridge/`) và Node.js (`addin/`).
- Biên dịch giao diện Task Pane sang `addin/dist/`.
- Sideload `manifest.xml` vào thư mục Developer Add-ins của Word, Excel, PowerPoint.
- Đăng ký và kích hoạt dịch vụ chạy ngầm tự động (`com.hermes.office`).

**Windows:** nhấp đúp `install.bat` · **macOS:** nhấp đúp `install.command` · tham số: `--yes` (không hỏi), `--lang vi|en`.

### 2. Đăng nhập Google trong tiện ích
Lần đầu mở Task Pane sẽ hiện hộp thoại **Đăng nhập Google / Gmail** (và nút **Cài Hermes Agent tự động** nếu thiếu). Bridge cung cấp `GET /auth/status`, `POST /auth/google` và các tin nhắn WebSocket `auth_status`, `auth_google`, `auth_cancel`, `auth_logout`, `setup_install` (tiến trình trả về qua `auth_progress`). Email đang đăng nhập hiện ở header. Biến môi trường: `HERMES_AUTH_PROVIDER` (mặc định `antigravity`), `HERMES_INSTALL_URL`, `AGY_INSTALL_URL`.

#### Plugin Antigravity cho Hermes (tự cài và bật)
Plugin `antigravity-subscription-directsdk` cho Hermes dùng Gemini qua tài khoản Antigravity (`agy`) đã đăng nhập. Thứ tự: cài `agy` và đăng nhập trước, sau đó bật plugin bằng `hermes plugins enable antigravity-subscription-directsdk`. Hermes Office làm bước bật này tự động ở hai chỗ:
- **`install.sh`** (cũng chạy qua `install.bat` trên Windows): hỏi rồi bật plugin nếu đã có `hermes` và `agy`. Chạy riêng bằng `./install.sh plugin`.
- **Bridge**: ngay sau khi đăng nhập Google thành công trong tiện ích, nếu có `agy` thì tự bật plugin. Cũng có thể gửi `{"type":"setup_install","target":"plugin"}`; tiến trình trả về qua `plugin_progress`, trạng thái nằm ở `auth_status.plugin`.

Sau khi plugin được bật, các thao tác sửa nhanh (inline, `F6`) chạy với `--provider antigravity-subscription-directsdk` và model `gemini-3.8-flash`. Đặt `HERMES_FAST_PROVIDER` để dùng provider khác, hoặc `HERMES_AGY_PLUGIN=""` để tắt hẳn tính năng này.

### 3. Kích hoạt trong Office
1. Khởi động (hoặc mở lại) **Microsoft Word**, **Excel** hoặc **PowerPoint**.
2. Vào thẻ **Insert (Chèn)** → chọn **Add-ins (Tiện ích bổ sung)** → chọn **My Add-ins (Tiện ích bổ sung của tôi)**.
3. Chọn tab **Developer Add-ins (Nhà phát triển)** → Nhấp vào **`Hermes for Office`**.
4. Biểu tượng **Hermes** sẽ xuất hiện trên thẻ **Home (Trang đầu)**. Bấm vào để mở bảng điều khiển Task Pane.

---

## 🛠️ Quản lý dịch vụ chạy ngầm

- **Kiểm tra trạng thái daemon**:
  ```bash
  ./install.sh service-status
  ```
- **Khởi động lại / Dừng daemon**:
  ```bash
  ./install.sh service-restart
  ./install.sh service-stop
  ./install.sh service-start
  ```
- **Gỡ cài đặt hoàn toàn**:
  ```bash
  ./install.sh uninstall
  ```

---

## 🎮 Hướng dẫn sử dụng chi tiết

### 1. Trò chuyện & Yêu cầu chỉnh sửa (Chat Pane)
- Nhập yêu cầu tự nhiên vào khung chat dưới cùng (ví dụ: *"Viết lại đoạn văn bản đang chọn trang trọng hơn"*, *"Tạo bảng thống kê doanh thu 12 tháng vào Excel"*).
- Sử dụng các nút hành động nhanh (Quick Chips) phía trên ô nhập: **Tóm tắt**, **Sửa chính tả**, **Dịch thuật**, **Định dạng bảng**.
- Di chuột vào tin nhắn trả lời của Hermes để chọn **Chèn vào tài liệu** hoặc **Sao chép**.

### 2. Phím tắt sửa dòng tức thì (`F6`)
- Chọn một đoạn văn bản trong Word hoặc một vùng ô trong Excel.
- Bấm **`F6`** (hoặc bấm nút *Sửa dòng* trên thanh điều khiển).
- Nhập câu lệnh sửa → Bấm **Enter** để xem trước bản sửa, hoặc **Cmd/Ctrl + Enter** để áp dụng thẳng vào tài liệu.

### 3. Công thức Toán, Lí, Hóa học
- Yêu cầu Hermes tạo công thức Toán hoặc phản ứng Hóa học (ví dụ: *"Chèn phương trình định luật II Newton và phương trình nhiệt phân đá vôi"*).
- Hermes sẽ tự động biên dịch sang chuẩn OpenXML Equation và nhúng trực tiếp thành đối tượng Equation trong tài liệu Word.

### 4. Bảng Kỹ năng (Skills)
- Bấm vào nút **Kỹ năng** trên header.
- Tích chọn các kỹ năng muốn Hermes áp dụng trong phiên làm việc.
- Nhấp vào dòng mô tả chữ mờ của bất kỳ kỹ năng nào để mở hộp thoại giải thích chi tiết mục đích và cách sử dụng.

---
### 5. Hộp thoại, dự án, quy tắc và mức độ tư duy
- Thanh công cụ nằm ngay trên ô nhập: **＋** mở hộp thoại mới (ngữ cảnh trống, giúp giảm cache/chi phí khi chat dài), **thư mục** mở danh sách hội thoại & dự án, **tài liệu** mở *Quy tắc* chung.
- **Dự án** gom nhiều hội thoại, có quy tắc riêng và nhớ bộ kỹ năng đang bật; quy tắc được chèn vào mọi yêu cầu gửi cho Hermes.
- Trong bảng Kỹ năng, nút **＋** tạo kỹ năng mới (ghi `~/.hermes/skills/<tên>/SKILL.md`).
- Ô chọn **🧠** cạnh mô hình đặt mức tư duy (`hermes chat --reasoning`): Mặc định, Tắt, Tối thiểu, Thấp, Vừa, Cao, Rất cao, Tối đa.
- Nút tròn **ⓘ** nổi ở góc trên bên phải do chính Office vẽ, add-in không tắt được; giao diện chừa sẵn vùng đó.

### 6. Công cụ nâng cao (thanh công cụ trên ô nhập, menu ⋯ và ô chọn chế độ)
- **Chế độ** (ô ⚡ cạnh 🧠): *Tự động* (áp dụng ngay), *Duyệt trước* (hiện danh sách thay đổi, bấm Áp dụng mới ghi vào tài liệu), *Chỉ hỏi đáp* (Hermes chỉ đọc; bridge từ chối mọi lệnh sửa). Ở chế độ hỏi đáp, Hermes trích dẫn vị trí dạng `[[ref: ...]]` và bạn bấm nút ↗ để nhảy tới đúng chỗ (Word: đoạn văn bản, Excel: ô, PowerPoint: slide).
- **Hoàn tác** (↶): trước lượt đầu tiên Hermes sửa tài liệu, add-in chụp bản sao (Word/PowerPoint: toàn bộ tệp; Excel: nội dung và định dạng số của ô). Giữ 5 bản gần nhất trong bộ nhớ. Excel không hoàn tác phông, màu, biểu đồ; Word có thể không khôi phục đầu/chân trang và chú thích.
- **Hermes nhớ gì**: Hermes đề xuất ghi chú bền vững, bạn bấm *Ghi nhớ* thì mới lưu (theo dự án hoặc chung). Xem, thêm, xóa ở ⋯ → *Hermes nhớ gì*.
- **Mẫu lệnh**: ⋯ → *Mẫu lệnh*. Mẫu hiện thành nút màu tím và trong menu gõ `/`. Biến: `{vùng chọn}` `{ngày}` `{tên file}` `{ứng dụng}`.
- **Đính kèm** (📎): PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, HTML hoặc liên kết http(s), không giới hạn dung lượng (PDF cần `pdftotext` hoặc `pypdf`). File được tải lên bridge qua HTTP, giữ trong RAM và lưu ở `~/.hermes/office_docs/` (tự xóa sau 30 ngày không dùng). Tài liệu đến 60.000 ký tự được gửi nguyên vẹn (📎); lớn hơn thì chuyển sang chế độ 🔎: prompt chỉ có mục lục ngắn, còn Hermes tự gọi `office_doc_search` (BM25 không phân biệt dấu, hoặc regex), `office_doc_read`, `office_doc_outline`, `office_doc_summarize_part` để chỉ đọc phần cần dùng.
- **Thước đo ngữ cảnh**: số token ước tính hiện cạnh tên hộp thoại; vượt ngưỡng (ở ⋯, mặc định 40k) sẽ nhắc *Tóm tắt & hộp mới*.
- **Xuất / tóm tắt**: ⋯ → tải hoặc sao chép hộp thoại dạng Markdown, chèn bản tóm tắt vào tài liệu, hoặc tóm tắt rồi mở hộp thoại mới mang theo bản tóm tắt.

## 📂 Cấu trúc dự án

```
hermes-office/
├── manifest.xml          # Khai báo Office Web Add-in cho Word, Excel, PowerPoint
├── install.sh / install.command / install.bat / install.ps1   # Script tự động cài đặt, sinh SSL, sideload và cấu hình daemon
├── bridge/                # Backend daemon FastAPI + WebSocket bridge
│   └── hermes_office_bridge.py
├── addin/                 # Frontend Task Pane (React + TypeScript + Tailwind CSS)
│   ├── src/components/   # Các component giao diện: App, ModelSelector, SkillsDrawer, InlineEdit...
│   ├── src/office/       # Bộ kết nối Office.js API cho Word, Excel, PowerPoint, Equations
│   └── src/lib/          # WebSocket client, quản lý đa ngôn ngữ (i18n)
└── skills/                # Các skill tự học (office-user-style)
```

---

## 📝 Giấy phép & Đóng góp
Phát triển dành cho hệ sinh thái **Hermes Agent**.
Mọi đóng góp và báo lỗi xin vui lòng tạo Issue hoặc Pull Request trên GitHub.
