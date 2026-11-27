import { expect, test } from "bun:test";
import { brandedIndex } from "./product";
const html = '<html lang="en"><head><title>Answered</title></head><body></body></html>';
test("plain installs carry the neutral UI marker and escaped generic product name", () => {
  const plain = brandedIndex(html, "Your agency", true);
  expect(plain).toContain('<html data-neutral-dashboard lang="en">');
  expect(plain).toContain('<meta name="product" content="Your agency"');
  expect(plain).not.toContain("Answered");
});
test("branded installs keep their name and do not acquire the neutral theme", () => {
  const own = brandedIndex(html, 'Smith & Sons', false);
  expect(own).toContain("Smith &amp; Sons");
  expect(own).not.toContain("data-neutral-dashboard");
});
