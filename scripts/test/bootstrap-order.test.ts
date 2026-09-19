import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("clean-checkout verification", () => {
  it("builds workspace declarations before type-checking dependents", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const verify = packageJson.scripts?.verify;

    expect(verify).toBeTypeOf("string");
    expect(verify?.indexOf("pnpm build")).toBeGreaterThanOrEqual(0);
    expect(verify?.indexOf("pnpm typecheck")).toBeGreaterThan(
      verify?.indexOf("pnpm build") ?? Number.POSITIVE_INFINITY,
    );
  });
});
