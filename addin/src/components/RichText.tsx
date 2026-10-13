import { Markdown, stripMachine } from "./Markdown";

export const stripHidden = stripMachine;

/** Assistant text as Markdown, without machine blocks; [[ref: ...]] become jump buttons. */
export default function RichText({ text, onRef }: { text: string; onRef: (kind: string, target: string) => void }) {
  return <Markdown text={stripMachine(text)} onRef={onRef} />;
}
