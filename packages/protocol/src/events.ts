import { z } from "zod";
import { type JsonValue, portableIdentifierSchema } from "./json.js";

export const protectedAuthorizationFields = [
  "principalId",
  "tenantId",
  "workspaceId",
  "resourceScopes",
  "actionScopes",
  "permissionEpoch",
  "approvalReferences",
  "expiresAt",
] as const;

const protectedEventContentKeys = new Set<string>([
  ...protectedAuthorizationFields,
  "__proto__",
  "constructor",
  "prototype",
]);

type GenericEventContentSnapshot =
  | { readonly ok: true; readonly value: JsonValue }
  | {
      readonly ok: false;
      readonly path: PropertyKey[];
      readonly message: string;
    };

function invalidGenericEventContent(
  path: PropertyKey[] = [],
  message: string,
): GenericEventContentSnapshot {
  return { ok: false, path, message };
}

function snapshotGenericEventContent(
  value: unknown,
  path: PropertyKey[] = [],
  ancestors = new WeakSet<object>(),
): GenericEventContentSnapshot {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return { ok: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { ok: true, value }
      : invalidGenericEventContent(path, "JSON numbers must be finite");
  }
  if (typeof value !== "object") {
    return invalidGenericEventContent(path, "event content must be JSON-safe");
  }
  if (ancestors.has(value)) {
    return invalidGenericEventContent(
      path,
      "event content cannot contain cycles",
    );
  }

  ancestors.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) {
        return invalidGenericEventContent(
          path,
          "event arrays must have the standard prototype",
        );
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        return invalidGenericEventContent(
          path,
          "event arrays cannot contain symbol keys",
        );
      }
      const ownNames = Object.getOwnPropertyNames(value);
      for (const name of ownNames) {
        if (name !== "length" && !/^(0|[1-9]\d*)$/.test(name)) {
          return invalidGenericEventContent(
            [...path, name],
            "event arrays cannot have extra properties",
          );
        }
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) {
        return invalidGenericEventContent(
          path,
          "event arrays must have a safe length",
        );
      }

      const snapshot: JsonValue[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return invalidGenericEventContent(
            [...path, index],
            "event arrays must contain JSON values",
          );
        }
        const child = snapshotGenericEventContent(
          descriptor.value,
          [...path, index],
          ancestors,
        );
        if (!child.ok) {
          return child;
        }
        snapshot.push(child.value);
      }
      return { ok: true, value: snapshot };
    }

    if (prototype !== Object.prototype && prototype !== null) {
      return invalidGenericEventContent(
        path,
        "event objects must be plain JSON objects",
      );
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return invalidGenericEventContent(
        path,
        "event objects cannot contain symbol keys",
      );
    }
    const snapshot = Object.create(null) as { [key: string]: JsonValue };
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return invalidGenericEventContent(
          [...path, key],
          "event objects must contain JSON values",
        );
      }
      if (protectedEventContentKeys.has(key)) {
        return invalidGenericEventContent(
          [...path, key],
          "protected authorization fields are not event content",
        );
      }
      const child = snapshotGenericEventContent(
        descriptor.value,
        [...path, key],
        ancestors,
      );
      if (!child.ok) {
        return child;
      }
      snapshot[key] = child.value;
    }
    return { ok: true, value: snapshot };
  } catch {
    return invalidGenericEventContent(
      path,
      "event content cannot be safely inspected",
    );
  } finally {
    ancestors.delete(value);
  }
}

const genericEventContentSchema = z.unknown().transform((value, context) => {
  const snapshot = snapshotGenericEventContent(value);
  if (snapshot.ok) {
    return snapshot.value;
  }
  context.addIssue({
    code: "custom",
    path: snapshot.path,
    message: snapshot.message,
  });
  return z.NEVER;
});

const eventTypeSchema = z.enum([
  "user_turn",
  "context_candidate",
  "tool_proposal",
  "tool_result",
  "agent_checkpoint",
  "final_claim",
]);

const evidenceReferenceSchema = z
  .object({
    id: portableIdentifierSchema,
    contentHash: z.string().min(1),
  })
  .strict();

const normalizedEventFields = {
  id: portableIdentifierSchema,
  type: eventTypeSchema,
  sessionId: portableIdentifierSchema,
  timestamp: z.string().datetime({ offset: true }),
  host: z.string().min(1),
  goal: z.string().min(1),
  evidence: z.array(evidenceReferenceSchema),
  trust: z.enum(["trusted", "untrusted", "mixed"]),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
  freshness: z.enum(["current", "stale", "unknown"]),
  contentHash: z.string().min(1),
  content: genericEventContentSchema.optional(),
};

export const normalizedEventSchema = z.object(normalizedEventFields).strict();

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;

export interface AuthorizationContext {
  readonly principalId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly resourceScopes: readonly string[];
  readonly actionScopes: readonly string[];
  readonly permissionEpoch: string;
  readonly approvalReferences: readonly string[];
  readonly expiresAt: string;
}

export const authorizationContextSchema: z.ZodType<AuthorizationContext> = z
  .object({
    principalId: portableIdentifierSchema,
    tenantId: portableIdentifierSchema,
    workspaceId: portableIdentifierSchema,
    resourceScopes: z.array(z.string().min(1)),
    actionScopes: z.array(z.string().min(1)),
    permissionEpoch: portableIdentifierSchema,
    approvalReferences: z.array(z.string().min(1)),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
