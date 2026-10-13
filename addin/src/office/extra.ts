import { pptExtraTools } from "./ppt_extra";
import { wordExtraTools } from "./word_extra";
import { excelExtraTools } from "./excel_extra";
import { compatTools } from "./compat_extra";

type Args = Record<string, any>;

/** Tools added for the Office skill set. Registered in tools.ts with one spread. */
/** Order matters: tools.ts spreads this table FIRST, so its own entries (and compatTools' stand-ins for them) override. */
export const extraTools: Record<string, (a: Args) => Promise<unknown>> = {
  ...compatTools,
  ...pptExtraTools,
  ...wordExtraTools,
  ...excelExtraTools,
};
