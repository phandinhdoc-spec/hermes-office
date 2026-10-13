import { pptExtraTools } from "./ppt_extra";
import { wordExtraTools } from "./word_extra";
import { excelExtraTools } from "./excel_extra";

type Args = Record<string, any>;

/** Tools added for the Office skill set. Registered in tools.ts with one spread. */
export const extraTools: Record<string, (a: Args) => Promise<unknown>> = {
  ...pptExtraTools,
  ...wordExtraTools,
  ...excelExtraTools,
};
