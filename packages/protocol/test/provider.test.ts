import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  authorizationContextSchema,
  providerCapabilitiesSchema,
} from "../src/index.js";

describe("provider and authorization contracts", () => {
  it("uses explicit capabilities and a separately trusted authorization context", () => {
    expect(
      providerCapabilitiesSchema.parse({
        questionTypes: ["choice", "noul", "score"],
        probabilitySemantics: ["native_calibrated"],
        maxQuestions: 10,
      }),
    ).toMatchObject({ maxQuestions: 10 });
    expect(
      authorizationContextSchema.parse({
        principalId: "user-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        resourceScopes: ["repo:read"],
        actionScopes: ["review"],
        permissionEpoch: "epoch-4",
        approvalReferences: [],
        expiresAt: "2026-09-19T11:00:00.000Z",
      }),
    ).toMatchObject({ tenantId: "tenant-1" });
  });

  it("keeps the default packed-artifact smoke test offline", () => {
    const rootPackage = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(rootPackage.scripts["pack:test"]).toBe(
      "node scripts/pack-smoke.mjs",
    );
    const smokeScript = readFileSync(
      new URL("../../../scripts/pack-smoke.mjs", import.meta.url),
      "utf8",
    );
    expect(smokeScript).toContain('"--offline"');
    expect(smokeScript).toContain('const pnpmVersion = "12.4.2"');
    expect(smokeScript).toContain("pinned pnpm prerequisite");
    expect(smokeScript).not.toMatch(/npm\s+exec\s+--yes/u);
    expect(smokeScript).toContain('"--pack-destination"');
  });

  it("scopes the package test command to the protocol test path", () => {
    const protocolPackage = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(protocolPackage.scripts.test).toContain("packages/protocol/test");
  });
});
