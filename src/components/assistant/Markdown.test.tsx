// The assistant's Markdown: safe by construction, in-app links become buttons.
//   bun test src/components/assistant/Markdown.test.tsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, parseBlocks } from "./Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} onLink={() => {}} />);

describe("assistant markdown", () => {
  test("lists, bold and code", () => {
    const out = html("1. Open **Clients**\n2. Press `New`\n\n- one\n- two");
    expect(out).toContain("<ol");
    expect(out).toContain("<strong");
    expect(out).toContain("<code");
    expect(out).toContain("<ul");
    expect(parseBlocks("a\n\nb").length).toBe(2);
  });

  test("a relative link becomes a button, an https link opens a new tab, others are plain text", () => {
    const out = html("[Open Clients](/admin/clients) [Docs](https://example.com/x) [Bad](javascript:alert(1)) [Proto](//evil.example)");
    expect(out).toContain('data-assistant-link="/admin/clients"');
    expect(out).toContain('href="https://example.com/x"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("//evil.example");
  });

  test("HTML in the answer is escaped, never rendered", () => {
    const out = html('<img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
  });

  test("an unfinished fence or bold while streaming does not throw", () => {
    expect(() => html("```\ncode so far")).not.toThrow();
    expect(() => html("**half bol")).not.toThrow();
    expect(() => html("[half link](/adm")).not.toThrow();
  });
});
