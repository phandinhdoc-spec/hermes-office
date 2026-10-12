import { forwardRef, useImperativeHandle, useRef, type KeyboardEvent } from "react";

/**
 * Ô nhập liệu KHÔNG điều khiển (uncontrolled) dành cho gõ tiếng Việt.
 *
 * Các bộ gõ macOS như GoTiengViet, XKey, OpenKey... không dùng IME chuẩn: khi gõ "co" + "s"
 * chúng gửi phím xoá lùi rồi chèn lại "ó". Nếu ô nhập là controlled của React
 * (`value={state}` + `onChange`), React có thể ghi đè giá trị giữa hai bước đó và dấu bị mất
 * ("có" → "co"). Ở đây DOM là nguồn dữ liệu duy nhất lúc gõ, React không bao giờ gán lại `value`.
 */
export interface ImeTextareaHandle {
  getValue(): string;
  setValue(v: string): void;
  /** Nối thêm vào cuối (xuống dòng nếu ô đang có chữ). */
  append(v: string): void;
  focus(): void;
}

interface Props {
  className?: string;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Chỉ dùng làm giá trị khởi tạo khi mount. */
  defaultValue?: string;
  /** Gọi mỗi khi nội dung đổi (không làm React gán lại value). */
  onTextChange?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

const ImeTextarea = forwardRef<ImeTextareaHandle, Props>(function ImeTextarea(
  { className, rows, placeholder, disabled, defaultValue, onTextChange, onKeyDown },
  ref,
) {
  const el = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => el.current?.value ?? "",
      setValue: (v) => {
        if (!el.current) return;
        el.current.value = v;
        onTextChange?.(v);
      },
      append: (v) => {
        if (!el.current) return;
        const cur = el.current.value;
        el.current.value = cur.trim() ? cur + "\n" + v : v;
        onTextChange?.(el.current.value);
      },
      focus: () => el.current?.focus(),
    }),
    [onTextChange],
  );

  return (
    <textarea
      ref={el}
      rows={rows}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      defaultValue={defaultValue}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      onInput={(e) => onTextChange?.(e.currentTarget.value)}
      onKeyDown={onKeyDown}
    />
  );
});

export default ImeTextarea;
