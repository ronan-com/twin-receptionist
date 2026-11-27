import { describe, expect, test } from "bun:test";
import { CLIENT_TUTORIALS, TUTORIALS, TUTORIAL_GROUPS, tutorialsFor, videoEmbed } from "../src/lib/tutorials";
import { buildKnowledgePrompt } from "./assistant";

describe("tutorials", () => {
  test("ids are unique, groups exist, steps are 3 to 6", () => {
    const ids = TUTORIALS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(TUTORIAL_GROUPS.map((g) => g.id));
    for (const t of TUTORIALS) {
      expect(groups.has(t.group)).toBe(true);
      expect(t.steps.length).toBeGreaterThanOrEqual(3);
      expect(t.steps.length).toBeLessThanOrEqual(6);
      expect(t.to.startsWith("/admin")).toBe(true);
    }
    expect(CLIENT_TUTORIALS.length).toBe(5);
  });

  test("never hard-codes a product name", () => {
    const text = JSON.stringify([TUTORIALS, CLIENT_TUTORIALS]);
    expect(text).not.toContain("Answered");
    expect(text).not.toContain("Chloe");
  });

  test("phone set-up follows the agency", () => {
    const managed = tutorialsFor("platform", false).map((t) => t.id);
    expect(managed).toContain("request-number");
    expect(managed).not.toContain("buy-number");
    expect(managed).not.toContain("connect-phone");
    expect(managed).not.toContain("support-access");
    const own = tutorialsFor("own", false).map((t) => t.id);
    expect(own).toContain("buy-number");
    expect(own).not.toContain("request-number");
    expect(tutorialsFor("none", true).map((t) => t.id)).toContain("support-access");
  });

  test("videoEmbed", () => {
    expect(videoEmbed("")).toBeNull();
    expect(videoEmbed("javascript:alert(1)")).toBeNull();
    expect(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ kind: "iframe", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ?t=3")?.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbed("https://www.loom.com/share/0123456789abcdef")?.src).toBe("https://www.loom.com/embed/0123456789abcdef");
    expect(videoEmbed("https://vimeo.com/123456789")?.src).toBe("https://player.vimeo.com/video/123456789");
    expect(videoEmbed("https://cdn.example.com/how-to.mp4")).toEqual({ kind: "file", src: "https://cdn.example.com/how-to.mp4" });
    expect(videoEmbed("https://example.com/page")).toBeNull();
  });

  test("the help assistant knows the tutorials and links them", () => {
    const own = buildKnowledgePrompt({ product: "Chloe", phone: "own", singleAgency: true });
    expect(own).toContain("/admin/tutorials#test-call");
    expect(own).toContain("/admin/tutorials#buy-number");
    const platform = buildKnowledgePrompt({ product: "Chloe", phone: "platform", singleAgency: false });
    expect(platform).toContain("/admin/tutorials#request-number");
    expect(platform).not.toContain("Telnyx");
    expect(platform).not.toContain("Buy a number");
  });
});
