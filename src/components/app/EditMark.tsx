import { Fragment, type ReactNode } from "react";

/** How many spots in this text a starter template left for the business's own details. */
export const editMarks = (text: string): number => (text.match(/\[edit\]/g) ?? []).length;

/** Shows each template "[edit]" spot as a small "fill in" highlight instead of the raw marker. */
export function Marked({ text }: { text: string }): ReactNode {
  if (!text.includes("[edit]")) return text;
  const parts = text.split("[edit]");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? <mark data-fill-in className="mx-0.5 rounded-[4px] bg-[color-mix(in_srgb,#f59e0b_28%,transparent)] px-1 text-[11.5px] font-medium text-ink">fill in</mark> : null}
        </Fragment>
      ))}
    </>
  );
}
