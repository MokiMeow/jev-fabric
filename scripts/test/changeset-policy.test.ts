import { describe, expect, it } from "vitest";

describe("Changeset pull-request policy", () => {
  it("requires a pending Changeset for publishable code", async () => {
    const { checkChangesetPolicy } = await import(
      new URL("../check-changeset-policy.mts", import.meta.url).href
    );
    expect(() =>
      checkChangesetPolicy({ changedFiles: ["packages/core/src/runtime.ts"] }),
    ).toThrow(/require a pending/u);
    expect(() =>
      checkChangesetPolicy({
        changedFiles: [
          "packages/core/src/runtime.ts",
          ".changeset/bright-hounds-prepare.md",
        ],
      }),
    ).not.toThrow();
  });

  it("allows only non-package changes and tightly constrained version preparation", async () => {
    const { checkChangesetPolicy } = await import(
      new URL("../check-changeset-policy.mts", import.meta.url).href
    );
    expect(() =>
      checkChangesetPolicy({
        changedFiles: [
          "docs/reference/cli.md",
          "packages/core/test/runtime.test.ts",
        ],
      }),
    ).not.toThrow();
    expect(() =>
      checkChangesetPolicy({
        changedFiles: ["docs/reference/cli.md", "examples/test/demo.test.ts"],
      }),
    ).not.toThrow();
    expect(() =>
      checkChangesetPolicy({
        headRef: "changeset-release/alpha-2",
        changedFiles: ["packages/core/package.json", "pnpm-lock.yaml"],
      }),
    ).not.toThrow();
    expect(() =>
      checkChangesetPolicy({
        headRef: "changeset-release/alpha-2",
        changedFiles: ["packages/core/src/runtime.ts"],
      }),
    ).toThrow(/require a pending/u);
  });
});
