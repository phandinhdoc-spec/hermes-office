import { currentHost } from "./host";

/** A restorable copy of the document taken before Hermes changes it. Held in memory only (it can be large). */
export interface Snapshot {
  id: string;
  host: string;
  label: string;
  at: number;
  restore: () => Promise<void>;
  /** What this snapshot cannot bring back, shown to the user. */
  note?: string;
}

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_CELLS = 250_000;

function fileBase64(): Promise<string> {
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(Office.FileType.Compressed, { sliceSize: 1024 * 1024 }, (res) => {
      if (res.status !== Office.AsyncResultStatus.Succeeded) return reject(new Error(res.error?.message ?? "getFileAsync failed"));
      const file = res.value;
      if (file.size > MAX_FILE_BYTES) {
        file.closeAsync();
        return reject(new Error("document too large to snapshot"));
      }
      const parts: Uint8Array[] = [];
      const next = (i: number) => {
        if (i >= file.sliceCount) {
          file.closeAsync();
          const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
          let o = 0;
          for (const p of parts) { all.set(p, o); o += p.length; }
          let bin = "";
          for (let k = 0; k < all.length; k += 0x8000) bin += String.fromCharCode(...all.subarray(k, k + 0x8000));
          return resolve(btoa(bin));
        }
        file.getSliceAsync(i, (s) => {
          if (s.status !== Office.AsyncResultStatus.Succeeded) { file.closeAsync(); return reject(new Error(s.error?.message ?? "getSliceAsync failed")); }
          parts.push(new Uint8Array(s.value.data));
          next(i + 1);
        });
      };
      next(0);
    });
  });
}

async function wordSnapshot(): Promise<Pick<Snapshot, "restore" | "note">> {
  const b64 = await fileBase64();
  return {
    restore: () => Word.run(async (ctx) => {
      (ctx.document.body as any).insertFileFromBase64(b64, "Replace", { importTheme: true, importStyles: true, importParagraphSpacing: true, importPageColor: true, importChangeTrackingMode: true, importCustomProperties: true, importCustomXmlParts: true });
      await ctx.sync();
    }),
    note: "headers/footers and comments may not come back",
  };
}

async function pptSnapshot(): Promise<Pick<Snapshot, "restore" | "note">> {
  const b64 = await fileBase64();
  return {
    restore: () => PowerPoint.run(async (ctx) => {
      const old = ctx.presentation.slides;
      old.load("items/id");
      await ctx.sync();
      const oldIds = old.items.map((s) => s.id);
      ctx.presentation.insertSlidesFromBase64(b64, { formatting: "KeepSourceFormatting" });
      await ctx.sync();
      for (const id of oldIds) ctx.presentation.slides.getItem(id).delete();
      await ctx.sync();
    }),
  };
}

async function excelSnapshot(): Promise<Pick<Snapshot, "restore" | "note">> {
  const saved = await Excel.run(async (ctx) => {
    const sheets = ctx.workbook.worksheets;
    sheets.load("items/name");
    await ctx.sync();
    const used = sheets.items.map((ws) => {
      const r = ws.getUsedRangeOrNullObject(false);
      r.load(["address", "formulas", "numberFormat", "isNullObject", "rowCount", "columnCount"]);
      return { name: ws.name, r };
    });
    await ctx.sync();
    let cells = 0;
    const out = used.map(({ name, r }) => {
      if (r.isNullObject) return { name, addr: "", formulas: [] as any[][], nf: [] as any[][] };
      cells += r.rowCount * r.columnCount;
      return { name, addr: r.address.split("!").pop() ?? "", formulas: r.formulas, nf: r.numberFormat };
    });
    if (cells > MAX_CELLS) throw new Error("workbook too large to snapshot");
    return out;
  });
  return {
    restore: () => Excel.run(async (ctx) => {
      const sheets = ctx.workbook.worksheets;
      sheets.load("items/name");
      await ctx.sync();
      const keep = new Set(saved.map((s) => s.name));
      for (const ws of sheets.items) if (!keep.has(ws.name)) ws.delete(); // sheets Hermes added
      await ctx.sync();
      for (const s of saved) {
        const ws = ctx.workbook.worksheets.getItemOrNullObject(s.name);
        await ctx.sync();
        if (ws.isNullObject) continue;
        ws.getUsedRangeOrNullObject(false).clear("Contents");
        if (s.addr) {
          const r = ws.getRange(s.addr);
          r.formulas = s.formulas;
          r.numberFormat = s.nf;
        }
        await ctx.sync();
      }
    }),
    note: "restores cell contents and number formats; fonts, colours and charts are not reverted",
  };
}

/** Best-effort snapshot of the current document; throws when the host/document cannot be captured. */
export async function takeSnapshot(label: string): Promise<Snapshot> {
  const host = currentHost();
  const part = host === "word" ? await wordSnapshot() : host === "powerpoint" ? await pptSnapshot() : host === "excel" ? await excelSnapshot() : null;
  if (!part) throw new Error("snapshot not supported for this host");
  return { id: crypto.randomUUID().slice(0, 8), host, label, at: Date.now(), ...part };
}
