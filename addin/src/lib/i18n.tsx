import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Lang = "vi" | "en";

const en = {
  "lang.label": "Language",
  "auth.title": "Sign in with Google",
  "auth.subtitle": "Sign in once with your Gmail account to use the AI in Word, Excel and PowerPoint.",
  "auth.button": "Sign in with Google account",
  "auth.waiting": "Waiting for you to finish signing in in the browser…",
  "auth.openLink": "Browser did not open? Click here to sign in",
  "auth.cancel": "Cancel",
  "auth.failed": "Sign-in failed or timed out. Please try again.",
  "auth.ok": "Signed in",
  "auth.signedInAs": "Signed in: {email}",
  "auth.logout": "Sign out",
  "auth.later": "Later",
  "auth.models": "Gemini 3.8 Flash answers fast · Claude Sonnet reasons in the background",
  "auth.noHermes.title": "Hermes Agent is not installed",
  "auth.noHermes.body": "Hermes Agent is the engine behind this add-in. Install it with one click (about 1–2 minutes).",
  "auth.install": "Install Hermes Agent automatically",
  "auth.installing": "Installing… please do not close this window",
  "auth.manual": "Automatic install is not available on this system. Run install.bat (Windows) or ./install.sh (macOS/Linux) once; see HDSD_CAI_DAT.md.",
  "banner.signIn": "Not signed in to Google — click to sign in",
  "lang.switch": "Switch language (Vietnamese / English)",

  "header.bridge": "Bridge: {state}",
  "header.hermesOk": " · hermes ok",
  "header.hermesMissing": " · hermes missing",
  "conn.open": "connected",
  "conn.connecting": "connecting",
  "conn.closed": "disconnected",
  "header.inline": "Inline edit ({key})",
  "header.skills": "Skills",
  "header.skillsActive": "Skills ({n} active)",
  "header.tools": "Tools",
  "header.clear": "Clear chat",

  "banner.bridgeDown": "Bridge not reachable — run bridge/run.sh",
  "banner.noHermes": "Hermes CLI not found — set HERMES_BIN",
  "common.dismiss": "Dismiss",
  "common.close": "Close",
  "common.closeEsc": "Close (Esc)",
  "common.refresh": "Refresh",
  "common.stop": "Stop",
  "common.send": "Send (↵)",
  "common.sendLabel": "Send",
  "common.remove": "Remove",
  "common.run": "Run",

  "chip.summarize": "Summarize",
  "chip.proofread": "Proofread",
  "chip.translate": "Translate",
  "chip.table": "Format Table",
  "chip.summarize.prompt": "Summarize the selected content concisely.",
  "chip.proofread.prompt": "Proofread the selected content: fix spelling, grammar and punctuation, keeping the meaning and tone.",
  "chip.translate.prompt": "Translate the selected content into English (or into Vietnamese if it is already English).",
  "chip.table.prompt": "Reformat the selected content as a clean, well-structured table.",

  "tool.running": "running",
  "tool.done": "done",
  "tool.failed": "failed",

  "empty.title": "Ask Hermes about this {host} file",
  "empty.hint": "Select content, then pick a quick action — or press {key} to edit inline.",
  "msg.insert": "Insert into document",
  "msg.copy": "Copy",
  "status.applying": "Applying changes…",
  "status.generating": "Hermes is generating…",
  "status.thinking": "Hermes is thinking…",
  "status.thinkingShort": "Thinking…",
  "composer.placeholder": "Ask Hermes to read or edit this file…",
  "composer.selOn": "Selection is included as context",
  "composer.selOff": "Selection not included",
  "skills.manage": "Manage skills",

  "err.readSelection": "Could not read selection: {msg}",
  "err.readSelection2": "Could not read the selection: {msg}",
  "err.hermes_not_found": "Hermes CLI not found. Install it or set HERMES_BIN.",
  "err.invalid_model": "Invalid model or provider",
  "err.invalid_skill": "Invalid skill name",
  "err.invalid_json": "Args must be valid JSON",

  "model.label": "Model",
  "model.default": "Default (auto)",
  "model.coreShort": "Sonnet",
  "model.fastShort": "Gemini Flash",
  "model.core": "Sonnet · Core reasoning",
  "model.coreDesc": "Best for editing, analysis and multi-step tasks",
  "model.fast": "Gemini 3.8 Flash · Fast",
  "model.fastDesc": "Quick interactive replies and inline edits",
  "model.section.recommended": "Recommended",
  "model.section.other": "Other models",
  "model.autoNote": "Auto: Sonnet for chat, Gemini Flash for inline edits",

  "skillsDrawer.title": "Skills",
  "skillsDrawer.active": "{n} active",
  "skillsDrawer.filter": "Filter skills…",
  "skillsDrawer.all": "All",
  "skillsDrawer.none": "None",
  "skillsDrawer.noMatch": "No match.",
  "skillsDrawer.empty": "No skills loaded.",
  "skillsDrawer.noDesc": "No description — click for details",
  "skillsDrawer.details": "Click for details and how to use",

  "history.clear": "Clear chat history",
  "history.confirm": "Delete the whole saved conversation? This cannot be undone.",
  "history.confirmYes": "Delete",
  "history.cancel": "Cancel",
  "history.restored": "Conversation restored",
  "history.deleteSingle": "Delete this message",
  "history.selectMode": "Select to delete",
  "history.exitSelectMode": "Cancel selection",
  "history.selectedCount": "{n} selected",
  "history.selectAll": "Select all",
  "history.deselectAll": "Deselect all",
  "history.deleteSelected": "Delete selected ({n})",
  "history.clearAll": "Clear all",
  "history.selectMsg": "Select message",

  "skillDetail.purpose": "Purpose",
  "skillDetail.explanation": "Detailed explanation",
  "skillDetail.usage": "How to use",
  "skillDetail.source": "SKILL.md",
  "skillDetail.activate": "Activate",
  "skillDetail.deactivate": "Deactivate",
  "skillDetail.active": "Active",
  "skillDetail.loading": "Loading skill…",
  "skillDetail.notFound": "SKILL.md not found for this skill.",
  "skillDetail.noExplanation": "No further explanation in SKILL.md.",
  "skillDetail.notTranslated": "No Vietnamese translation available; showing the original text.",
  "skillDetail.usageGeneric": "1. Tick this skill (or press “Activate”) — it is preloaded for every request.\n2. Ask Hermes in the chat as usual, e.g. “Use the {name} skill to …”.\n3. Untick it when you no longer need it.",
  "skillDetail.usageHeading": "Skill instructions",
  "skillDetail.copy": "Copy SKILL.md",

  "tools.office": "Office tools · {host}",
  "tools.hermes": "Hermes toolsets",
  "tools.args": "{name} args",
  "tools.noOffice": "No tools for this host.",
  "tools.noHermes": "No Hermes toolsets found.",
  "tools.on": "on",
  "tools.off": "off",
  "tools.ask": "Ask Hermes using {name}…",

  "inline.dialog": "Inline edit",
  "inline.editLine": "Edit current line",
  "inline.editSel": "Edit selection",
  "inline.empty": "(empty — new text will be inserted at the cursor)",
  "inline.placeholder": "Instruction, e.g. “make it shorter”  ·  ↵ preview  ·  ⌘/Ctrl+↵ apply",
  "inline.generate": "Generate",
  "inline.accept": "Accept",
  "inline.retry": "Retry",
  "inline.discard": "Discard",
} as const;

export type Key = keyof typeof en;

const vi: Record<Key, string> = {
  "auth.title": "Đăng nhập Google / Gmail",
  "auth.subtitle": "Đăng nhập một lần bằng tài khoản Gmail để dùng trợ lý AI ngay trong Word, Excel, PowerPoint.",
  "auth.button": "Đăng nhập bằng tài khoản Google",
  "auth.waiting": "Đang chờ bạn đăng nhập xong trên trình duyệt…",
  "auth.openLink": "Trình duyệt không tự mở? Bấm vào đây để đăng nhập",
  "auth.cancel": "Hủy",
  "auth.failed": "Đăng nhập thất bại hoặc quá thời gian. Vui lòng thử lại.",
  "auth.ok": "Đã đăng nhập",
  "auth.signedInAs": "Đã đăng nhập: {email}",
  "auth.logout": "Đăng xuất",
  "auth.later": "Để sau",
  "auth.models": "Gemini 3.8 Flash trả lời nhanh · Claude Sonnet suy luận ở phía sau",
  "auth.noHermes.title": "Chưa cài Hermes Agent",
  "auth.noHermes.body": "Hermes Agent là bộ máy chạy phía sau tiện ích này. Bấm nút bên dưới để cài tự động (khoảng 1–2 phút).",
  "auth.install": "Cài Hermes Agent tự động",
  "auth.installing": "Đang cài đặt… vui lòng không đóng cửa sổ này",
  "auth.manual": "Hệ thống này chưa hỗ trợ cài tự động. Hãy chạy install.bat (Windows) hoặc ./install.sh (macOS/Linux) một lần; xem HDSD_CAI_DAT.md.",
  "banner.signIn": "Chưa đăng nhập Google — bấm để đăng nhập",
  "lang.label": "Ngôn ngữ",
  "lang.switch": "Đổi ngôn ngữ (Tiếng Việt / English)",

  "header.bridge": "Cầu nối: {state}",
  "header.hermesOk": " · hermes sẵn sàng",
  "header.hermesMissing": " · thiếu hermes",
  "conn.open": "đã kết nối",
  "conn.connecting": "đang kết nối",
  "conn.closed": "mất kết nối",
  "header.inline": "Sửa nhanh tại chỗ ({key})",
  "header.skills": "Kỹ năng",
  "header.skillsActive": "Kỹ năng (đang bật {n})",
  "header.tools": "Công cụ",
  "header.clear": "Xóa cuộc trò chuyện",

  "banner.bridgeDown": "Không kết nối được cầu nối — hãy chạy bridge/run.sh",
  "banner.noHermes": "Không tìm thấy Hermes CLI — hãy đặt biến HERMES_BIN",
  "common.dismiss": "Đóng thông báo",
  "common.close": "Đóng",
  "common.closeEsc": "Đóng (Esc)",
  "common.refresh": "Làm mới",
  "common.stop": "Dừng",
  "common.send": "Gửi (↵)",
  "common.sendLabel": "Gửi",
  "common.remove": "Gỡ bỏ",
  "common.run": "Chạy",

  "chip.summarize": "Tóm tắt",
  "chip.proofread": "Soát lỗi",
  "chip.translate": "Dịch",
  "chip.table": "Tạo bảng",
  "chip.summarize.prompt": "Tóm tắt ngắn gọn nội dung đã chọn.",
  "chip.proofread.prompt": "Soát lỗi nội dung đã chọn: sửa chính tả, ngữ pháp và dấu câu, giữ nguyên ý nghĩa và giọng văn.",
  "chip.translate.prompt": "Dịch nội dung đã chọn sang tiếng Anh (hoặc sang tiếng Việt nếu nội dung đã là tiếng Anh).",
  "chip.table.prompt": "Định dạng lại nội dung đã chọn thành một bảng gọn gàng, rõ ràng.",

  "tool.running": "đang chạy",
  "tool.done": "xong",
  "tool.failed": "lỗi",

  "empty.title": "Hỏi Hermes về tệp {host} này",
  "empty.hint": "Chọn nội dung rồi bấm một thao tác nhanh — hoặc nhấn {key} để sửa tại chỗ.",
  "msg.insert": "Chèn vào tài liệu",
  "msg.copy": "Sao chép",
  "status.applying": "Đang áp dụng thay đổi…",
  "status.generating": "Hermes đang viết…",
  "status.thinking": "Hermes đang suy nghĩ…",
  "status.thinkingShort": "Đang suy nghĩ…",
  "composer.placeholder": "Nhờ Hermes đọc hoặc chỉnh sửa tệp này…",
  "composer.selOn": "Phần đang chọn được gửi kèm làm ngữ cảnh",
  "composer.selOff": "Không gửi kèm phần đang chọn",
  "skills.manage": "Quản lý kỹ năng",

  "err.readSelection": "Không đọc được phần đang chọn: {msg}",
  "err.readSelection2": "Không đọc được phần đang chọn: {msg}",
  "err.hermes_not_found": "Không tìm thấy Hermes CLI. Hãy cài đặt hoặc đặt biến HERMES_BIN.",
  "err.invalid_model": "Mô hình hoặc nhà cung cấp không hợp lệ",
  "err.invalid_skill": "Tên kỹ năng không hợp lệ",
  "err.invalid_json": "Tham số phải là JSON hợp lệ",

  "model.label": "Mô hình",
  "model.default": "Mặc định (tự động)",
  "model.coreShort": "Sonnet",
  "model.fastShort": "Gemini Flash",
  "model.core": "Sonnet · Suy luận chính",
  "model.coreDesc": "Phù hợp để chỉnh sửa, phân tích và tác vụ nhiều bước",
  "model.fast": "Gemini 3.8 Flash · Nhanh",
  "model.fastDesc": "Phản hồi tương tác nhanh và sửa nhanh tại chỗ",
  "model.section.recommended": "Đề xuất",
  "model.section.other": "Mô hình khác",
  "model.autoNote": "Tự động: Sonnet cho trò chuyện, Gemini Flash cho sửa nhanh",

  "skillsDrawer.title": "Kỹ năng",
  "skillsDrawer.active": "đang bật {n}",
  "skillsDrawer.filter": "Lọc kỹ năng…",
  "skillsDrawer.all": "Tất cả",
  "skillsDrawer.none": "Bỏ chọn",
  "skillsDrawer.noMatch": "Không có kết quả.",
  "skillsDrawer.empty": "Chưa tải được kỹ năng nào.",
  "skillsDrawer.noDesc": "Chưa có mô tả — bấm để xem chi tiết",
  "skillsDrawer.details": "Bấm để xem chi tiết và cách sử dụng",

  "history.clear": "Xóa lịch sử trò chuyện",
  "history.confirm": "Xóa toàn bộ cuộc trò chuyện đã lưu? Thao tác này không thể hoàn tác.",
  "history.confirmYes": "Xóa",
  "history.cancel": "Hủy",
  "history.restored": "Đã khôi phục cuộc trò chuyện",
  "history.deleteSingle": "Xóa tin nhắn này",
  "history.selectMode": "Chọn để xóa",
  "history.exitSelectMode": "Hủy chế độ chọn",
  "history.selectedCount": "Đã chọn {n}",
  "history.selectAll": "Chọn tất cả",
  "history.deselectAll": "Bỏ chọn",
  "history.deleteSelected": "Xóa đã chọn ({n})",
  "history.clearAll": "Xóa toàn bộ",
  "history.selectMsg": "Chọn tin nhắn",

  "skillDetail.purpose": "Mục đích",
  "skillDetail.explanation": "Giải thích chi tiết",
  "skillDetail.usage": "Cách sử dụng",
  "skillDetail.source": "SKILL.md",
  "skillDetail.activate": "Bật kỹ năng",
  "skillDetail.deactivate": "Tắt kỹ năng",
  "skillDetail.active": "Đang bật",
  "skillDetail.loading": "Đang tải kỹ năng…",
  "skillDetail.notFound": "Không tìm thấy SKILL.md của kỹ năng này.",
  "skillDetail.noExplanation": "SKILL.md không có thêm phần giải thích.",
  "skillDetail.notTranslated": "Chưa có bản dịch tiếng Việt; đang hiển thị nội dung gốc.",
  "skillDetail.usageGeneric": "1. Tích chọn kỹ năng này (hoặc bấm “Bật kỹ năng”) — kỹ năng được nạp sẵn cho mọi yêu cầu.\n2. Nhờ Hermes trong khung trò chuyện như bình thường, ví dụ “Dùng kỹ năng {name} để …”.\n3. Bỏ chọn khi không cần nữa.",
  "skillDetail.usageHeading": "Hướng dẫn của kỹ năng",
  "skillDetail.copy": "Sao chép SKILL.md",

  "tools.office": "Công cụ Office · {host}",
  "tools.hermes": "Bộ công cụ Hermes",
  "tools.args": "tham số {name}",
  "tools.noOffice": "Không có công cụ cho ứng dụng này.",
  "tools.noHermes": "Không tìm thấy bộ công cụ Hermes nào.",
  "tools.on": "bật",
  "tools.off": "tắt",
  "tools.ask": "Nhờ Hermes dùng {name}…",

  "inline.dialog": "Sửa nhanh tại chỗ",
  "inline.editLine": "Sửa dòng hiện tại",
  "inline.editSel": "Sửa phần đang chọn",
  "inline.empty": "(trống — nội dung mới sẽ được chèn tại vị trí con trỏ)",
  "inline.placeholder": "Yêu cầu, ví dụ “viết ngắn hơn”  ·  ↵ xem trước  ·  ⌘/Ctrl+↵ áp dụng",
  "inline.generate": "Tạo",
  "inline.accept": "Chấp nhận",
  "inline.retry": "Thử lại",
  "inline.discard": "Bỏ qua",
};

const DICTS: Record<Lang, Record<Key, string>> = { en, vi };
const STORE = "hermes-office-lang";

export type TFn = (key: Key, vars?: Record<string, string | number>) => string;

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const I18nCtx = createContext<Ctx | null>(null);

const initialLang = (): Lang => {
  try {
    const v = localStorage.getItem(STORE);
    if (v === "en" || v === "vi") return v;
  } catch {
    /* storage unavailable in some Office webviews */
  }
  return "vi";
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORE, l);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo<Ctx>(() => {
    const t: TFn = (key, vars) =>
      DICTS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));
    return { lang, setLang, t };
  }, [lang, setLang]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nCtx);
  if (!c) throw new Error("useI18n must be used inside <I18nProvider>");
  return c;
}
