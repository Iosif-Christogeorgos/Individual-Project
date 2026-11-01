import { describe, expect, it } from "vitest";
import { escapeHtml } from "../../frontend/ui-utils.js";

describe("escapeHtml", () => {
  it("escapes tags", () => {
    expect(escapeHtml("<img src=x onerror=alert(1)>")).toBe(
      "&lt;img src=x onerror=alert(1)&gt;",
    );
  });

  it("escapes both quote types so values are safe inside attributes", () => {
    expect(escapeHtml(`" onmouseover="alert(1)`)).toBe(
      "&quot; onmouseover=&quot;alert(1)",
    );
    expect(escapeHtml("' x='")).toBe("&#39; x=&#39;");
  });

  it("escapes ampersands first so entities aren't double-decoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("handles empty and non-string values", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml("")).toBe("");
    expect(escapeHtml(0)).toBe("0");
  });
});
