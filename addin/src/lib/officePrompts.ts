import type { OfficeHost } from "../office/host";

/**
 * Built-in prompt templates for the Office skill set. Parts to fill in are written between [ ]
 * (Tab / Shift+Tab jump between them, see prompts.ts). Shown in the `@` prompt library of the matching app.
 */
interface OfficePrompt {
  id: string;
  host: OfficeHost;
  vi: { name: string; prompt: string };
  en: { name: string; prompt: string };
}

export const OFFICE_PROMPTS: OfficePrompt[] = [
  { id: "ppt-deck", host: "powerpoint",
    vi: { name: "Slide: bộ trình chiếu mới", prompt: "Tạo bộ slide về [chủ đề] cho [đối tượng người nghe], khoảng [10] slide, có hình minh họa và ghi chú thuyết trình." },
    en: { name: "Slides: new deck", prompt: "Create a slide deck about [topic] for [audience], about [10] slides, with pictures and speaker notes." } },
  { id: "ppt-lesson", host: "powerpoint",
    vi: { name: "Slide: bài giảng", prompt: "Soạn slide bài [tên bài] môn [môn học] lớp [lớp], có phần khởi động, kiến thức, luyện tập (đáp án ở slide sau) và vận dụng." },
    en: { name: "Slides: lesson", prompt: "Make slides for the lesson [lesson title], subject [subject], grade [grade], with a warm-up, new knowledge, practice (answers on the next slide) and application." } },
  { id: "ppt-notes", host: "powerpoint",
    vi: { name: "Slide: lời thuyết trình", prompt: "Viết lời thuyết trình [10] phút cho bộ slide này, mỗi slide ghi thời gian nói." },
    en: { name: "Slides: speaker notes", prompt: "Write [10]-minute speaker notes for this deck, with the speaking time for each slide." } },
  { id: "word-report", host: "word",
    vi: { name: "Word: viết báo cáo", prompt: "Viết báo cáo về [chủ đề] dài khoảng [3] trang cho [người đọc], có mục lục và nguồn tham khảo." },
    en: { name: "Word: write a report", prompt: "Write a report about [topic], about [3] pages, for [readers], with a table of contents and sources." } },
  { id: "word-exam", host: "word",
    vi: { name: "Word: soạn đề kiểm tra", prompt: "Soạn đề kiểm tra môn [môn học] lớp [lớp], thời gian [45] phút, phạm vi [tên bài/chương], kèm ma trận, đáp án và thang điểm." },
    en: { name: "Word: build an exam", prompt: "Build a test for [subject], grade [grade], [45] minutes, covering [lessons], with a matrix, answer key and marking scheme." } },
  { id: "word-proofread", host: "word",
    vi: { name: "Word: soát lỗi tiếng Việt", prompt: "Soát lỗi chính tả, dấu câu và văn phong của [toàn bộ văn bản / phần đang chọn]; chỗ nghi ngờ thì ghi bình luận, không tự sửa." },
    en: { name: "Word: proofread", prompt: "Proofread [the whole document / the selection] for spelling, punctuation and style; add a comment where unsure instead of changing it." } },
  { id: "excel-clean", host: "excel",
    vi: { name: "Excel: làm sạch dữ liệu", prompt: "Làm sạch bảng [vùng, ví dụ A1:F200]: bỏ dấu cách thừa, đổi chữ thành số, bỏ dòng trùng theo cột [Mã số]." },
    en: { name: "Excel: clean data", prompt: "Clean the table [range, e.g. A1:F200]: trim extra spaces, turn text into numbers, remove duplicate rows by column [ID]." } },
  { id: "excel-grade", host: "excel",
    vi: { name: "Excel: bảng điểm và chia nhóm", prompt: "Lập bảng điểm lớp [lớp] với hệ số [1-1-2-3], xếp loại và chia thành [6] nhóm đều điểm." },
    en: { name: "Excel: grade sheet & groups", prompt: "Build a grade sheet for class [class] with weights [1-1-2-3], grade bands, and split into [6] groups with even averages." } },
  { id: "excel-dashboard", host: "excel",
    vi: { name: "Excel: trang tổng quan", prompt: "Làm trang tổng quan từ bảng [vùng dữ liệu], thống kê theo [cột nhóm] và vẽ biểu đồ [cột/đường/tròn]." },
    en: { name: "Excel: dashboard", prompt: "Build a dashboard from [data range], summarised by [group column], with a [column/line/pie] chart." } },
];

export function officePromptsFor(host: OfficeHost, lang: "vi" | "en"): { id: string; name: string; prompt: string }[] {
  return OFFICE_PROMPTS.filter((p) => p.host === host).map((p) => ({ id: `office-${p.id}`, ...(lang === "vi" ? p.vi : p.en) }));
}

/** Order of skills in the `/` menu: skills of the open app first (ppt-, word-, excel-), then the other office-* ones. */
export function skillGroup(name: string, host: OfficeHost): number {
  const own = host === "powerpoint" ? "ppt-" : host === "word" ? "word-" : host === "excel" ? "excel-" : "\u0000";
  if (name.startsWith(own)) return 0;
  if (/^(ppt|word|excel|office)-/.test(name)) return 1;
  return 2;
}
