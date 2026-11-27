import { Fragment, memo, type ReactNode } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

// A small, safe Markdown renderer for the help assistant's answers: paragraphs,
// headings, lists, quotes, code, **bold**, *italic*, `code` and links. It builds React
// elements (never HTML strings), so nothing the model writes can inject markup. A link
// to a page in this app (a relative path) becomes a button; an https link opens in a
// new tab; anything else is shown as plain text.

const INTERNAL = /^\/(?!\/)[A-Za-z0-9\-._~/?=&%#$]*$/;
const EXTERNAL = /^https:\/\/[^\s<>"']+$/;

export const isInternalHref = (href: string) => INTERNAL.test(href);

type LinkHandler = (href: string) => void;

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*?\*)|(_[^_\s][^_\n]*?_)/;

function inline(text: string, onLink: LinkHandler, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) {
      out.push(
        <code key={k} className="rounded bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] px-1 py-0.5 font-mono text-[0.92em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(
        <strong key={k} className="font-semibold text-ink">
          {inline(tok.slice(2, -2), onLink, k)}
        </strong>,
      );
    } else if (m[3]) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const label = mm[1];
      const href = mm[2];
      if (INTERNAL.test(href)) {
        out.push(
          <a
            key={k}
            href={href}
            data-assistant-link={href}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onLink(href);
            }}
            className="mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[color-mix(in_srgb,var(--indigo)_30%,#fff)] bg-[color-mix(in_srgb,var(--indigo)_8%,var(--card))] px-2.5 py-0.5 align-baseline text-[12.5px] font-medium text-[var(--primary-ink,var(--indigo))] no-underline transition-colors hover:bg-indigo hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo"
          >
            {label}
            <ArrowRight className="h-3 w-3" aria-hidden />
          </a>,
        );
      } else if (EXTERNAL.test(href)) {
        out.push(
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-indigo underline underline-offset-2">
            {label}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>,
        );
      } else {
        out.push(label);
      }
    } else {
      out.push(
        <em key={k} className="italic">
          {inline(tok.slice(1, -1), onLink, k)}
        </em>,
      );
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

type Block =
  | { t: "p"; text: string }
  | { t: "h"; level: number; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "code"; text: string }
  | { t: "hr" };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", text: para.join("\n") });
    para.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++; // the closing fence (or the end, while still streaming)
      blocks.push({ t: "code", text: code.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line);
    if (h) {
      flush();
      blocks.push({ t: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = Boolean(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(lines[i]);
        if (m && Boolean(m[2]) === ordered) {
          items.push(m[3]);
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          const sub = /^\s{2,}[-*+]\s+(.*)$/.exec(lines[i]);
          // an indented bullet under an item stays on its own line; anything else is a wrapped line
          items[items.length - 1] += sub ? "\n\u2022 " + sub[1] : " " + lines[i].trim();
          i++;
        } else break;
      }
      blocks.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", text: q.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return blocks;
}

function Lines({ text, onLink }: { text: string; onLink: LinkHandler }) {
  const parts = text.split("\n");
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {inline(p, onLink, `l${i}`)}
        </Fragment>
      ))}
    </>
  );
}

export const Markdown = memo(function Markdown({ text, onLink, className }: { text: string; onLink: LinkHandler; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={cn("space-y-2.5 text-[13.5px] leading-[1.55] text-ink [&>*:first-child]:mt-0", className)}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h":
            return (
              <p key={i} className="pt-1 text-[13.5px] font-semibold text-ink">
                {inline(b.text, onLink, `h${i}`)}
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 marker:text-ink-muted">
                {b.items.map((it, j) => (
                  <li key={j}><Lines text={it} onLink={onLink} /></li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5 marker:font-medium marker:text-ink-muted">
                {b.items.map((it, j) => (
                  <li key={j}><Lines text={it} onLink={onLink} /></li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-hairline pl-3 text-ink-muted">
                <Lines text={b.text} onLink={onLink} />
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-lg bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] p-2.5 font-mono text-[12px] leading-5">
                {b.text}
              </pre>
            );
          case "hr":
            return <hr key={i} className="border-hairline" />;
          default:
            return (
              <p key={i}>
                <Lines text={b.text} onLink={onLink} />
              </p>
            );
        }
      })}
    </div>
  );
});
