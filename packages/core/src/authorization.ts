import {
  authorizationContextSchema,
  type AuthorizationContext,
} from "@mokimeow/jev-fabric-protocol";

const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

export type { AuthorizationContext } from "@mokimeow/jev-fabric-protocol";

export interface AuthorizationRequirement {
  readonly action: string;
  readonly resourceScope?: string;
  readonly approvalReference?: string;
}

export interface AuthorizationResult {
  readonly authorized: boolean;
  readonly reasonCode:
    | "AUTHORIZED"
    | "AUTHORIZATION_REQUIRED"
    | "AUTHORIZATION_INVALID"
    | "AUTHORIZATION_INVALID_TIME"
    | "AUTHORIZATION_EXPIRED"
    | "ACTION_SCOPE_DENIED"
    | "RESOURCE_SCOPE_DENIED"
    | "APPROVAL_REQUIRED";
}

/** Validates a separately supplied host authorization context; evidence is never an input. */
export function checkAuthorization(
  context: AuthorizationContext | undefined,
  requirement: AuthorizationRequirement,
  now: number,
): AuthorizationResult {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_DATE_TIMESTAMP_MS)
    return { authorized: false, reasonCode: "AUTHORIZATION_INVALID_TIME" };
  if (!context)
    return { authorized: false, reasonCode: "AUTHORIZATION_REQUIRED" };
  const parsed = authorizationContextSchema.safeParse(context);
  if (!parsed.success)
    return { authorized: false, reasonCode: "AUTHORIZATION_INVALID" };
  const expiresAt = Date.parse(parsed.data.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now)
    return { authorized: false, reasonCode: "AUTHORIZATION_EXPIRED" };
  if (!includesScope(parsed.data.actionScopes, requirement.action))
    return { authorized: false, reasonCode: "ACTION_SCOPE_DENIED" };
  if (
    requirement.resourceScope !== undefined &&
    !includesScope(parsed.data.resourceScopes, requirement.resourceScope)
  )
    return { authorized: false, reasonCode: "RESOURCE_SCOPE_DENIED" };
  if (
    requirement.approvalReference !== undefined &&
    !parsed.data.approvalReferences.includes(requirement.approvalReference)
  )
    return { authorized: false, reasonCode: "APPROVAL_REQUIRED" };
  return { authorized: true, reasonCode: "AUTHORIZED" };
}

function includesScope(scopes: readonly string[], requested: string): boolean {
  return scopes.includes("*") || scopes.includes(requested);
}
