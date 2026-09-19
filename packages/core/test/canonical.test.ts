import { describe, expect, it } from "vitest";
import { canonicalize, sha256Digest } from "../src/index.js";

describe("canonical hashing", () => {
  it("sorts object keys while preserving candidate order", () => {
    expect(sha256Digest({ b: 2, a: 1 })).toBe(sha256Digest({ a: 1, b: 2 }));
    expect(sha256Digest({ candidates: ["a", "b"] })).not.toBe(
      sha256Digest({ candidates: ["b", "a"] }),
    );
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});
