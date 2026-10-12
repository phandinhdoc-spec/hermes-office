export type OfficeHost = "word" | "excel" | "powerpoint" | "unknown";

export function currentHost(): OfficeHost {
  switch (Office.context?.host) {
    case Office.HostType.Word:
      return "word";
    case Office.HostType.Excel:
      return "excel";
    case Office.HostType.PowerPoint:
      return "powerpoint";
    default:
      return "unknown";
  }
}

export function requireHost(expected: OfficeHost): void {
  const h = currentHost();
  if (h !== expected) throw new Error(`This tool needs ${expected}, but the host is ${h}`);
}
