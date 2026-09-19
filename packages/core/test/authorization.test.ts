import { describe, expect, it } from "vitest";
import { checkAuthorization, type AuthorizationContext } from "../src/index.js";

const authorization: AuthorizationContext = {
  principalId: "user-1",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  resourceScopes: ["project:read"],
  actionScopes: ["read"],
  permissionEpoch: "permission-1",
  approvalReferences: [],
  expiresAt: "2030-01-01T00:00:00.000Z",
};

describe("authorization boundary", () => {
  it("requires a host authorization context with an unexpired scoped action", () => {
    expect(
      checkAuthorization(
        authorization,
        { action: "read", resourceScope: "project:read" },
        Date.parse("2029-01-01T00:00:00.000Z"),
      ),
    ).toEqual({ authorized: true, reasonCode: "AUTHORIZED" });
    expect(
      checkAuthorization(
        authorization,
        { action: "write" },
        Date.parse("2029-01-01T00:00:00.000Z"),
      ),
    ).toEqual({ authorized: false, reasonCode: "ACTION_SCOPE_DENIED" });
    expect(
      checkAuthorization(
        authorization,
        { action: "read" },
        Date.parse("2030-01-01T00:00:00.000Z"),
      ),
    ).toEqual({ authorized: false, reasonCode: "AUTHORIZATION_EXPIRED" });
  });

  it("fails closed with a stable reason when the host clock is invalid", () => {
    for (const now of [
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(
        checkAuthorization(authorization, { action: "read" }, now),
      ).toEqual({
        authorized: false,
        reasonCode: "AUTHORIZATION_INVALID_TIME",
      });
    }
  });
});
