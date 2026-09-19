import { describe, expect, it } from "vitest";
import { Redactor } from "../src/index.js";

describe("structural redaction", () => {
  it("redacts nested secrets, headers, and URL credentials without mutating input", () => {
    const value = {
      nested: {
        apiKey: "super-secret",
        headers: {
          Authorization: "Bearer abc.def.ghi",
          accept: "application/json",
        },
        url: "https://alice:password@example.test/path?token=secret&visible=ok",
      },
      normal: "safe",
    };
    const original = structuredClone(value);

    expect(new Redactor().redact(value)).toEqual({
      nested: {
        apiKey: "[REDACTED]",
        headers: {
          Authorization: "[REDACTED]",
          accept: "application/json",
        },
        url: "https://example.test/path?token=%5BREDACTED%5D&visible=ok",
      },
      normal: "safe",
    });
    expect(value).toEqual(original);
  });

  it("sanitizes every JSONL control character deterministically", () => {
    expect(new Redactor().sanitizeText("line\nnext\r\u0000\tend")).toBe(
      "line\\u000anext\\u000d\\u0000\\u0009end",
    );
  });

  it("does not redact ordinary fields merely because a word contains a sensitive substring", () => {
    expect(
      new Redactor().redact({ secretary: "Ada", tokenizedStatus: "complete" }),
    ).toEqual({ secretary: "Ada", tokenizedStatus: "complete" });
  });
});
