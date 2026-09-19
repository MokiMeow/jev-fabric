import { createHash } from "node:crypto";
import { CanonicalizationError } from "./errors.js";

/** Serializes only finite, plain JSON values with recursively sorted object keys. */
export function canonicalize(value: unknown): string {
  return serialize(value, new WeakSet<object>());
}

function serialize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw invalid();
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw invalid();
  }
  if (ancestors.has(value)) throw invalid("cyclic values are not JSON");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw invalid();
      const names = Object.getOwnPropertyNames(value);
      if (
        Object.getOwnPropertySymbols(value).length > 0 ||
        names.some((name) => name !== "length" && !/^(0|[1-9]\d*)$/.test(name))
      )
        throw invalid();
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          throw invalid();
        items.push(serialize(descriptor.value, ancestors));
      }
      return `[${items.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalid();
    if (Object.getOwnPropertySymbols(value).length > 0) throw invalid();
    const keys = Object.getOwnPropertyNames(value).sort();
    const pairs = keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        throw invalid();
      return `${JSON.stringify(key)}:${serialize(descriptor.value, ancestors)}`;
    });
    return `{${pairs.join(",")}}`;
  } catch (error) {
    if (error instanceof CanonicalizationError) throw error;
    throw invalid();
  } finally {
    ancestors.delete(value);
  }
}

function invalid(
  reason = "value is outside the JSON domain",
): CanonicalizationError {
  return new CanonicalizationError(reason);
}

/**
 * Returns a SHA-256 digest over an explicit domain and canonical JSON payload.
 * Domains prevent a digest for one artifact class from being reused as another.
 */
export function sha256Digest(
  value: unknown,
  domain = "jev-fabric/value/v1",
): string {
  if (!domain || /[\r\n]/u.test(domain))
    throw new CanonicalizationError("invalid digest domain");
  return createHash("sha256")
    .update(`${domain}\u0000${canonicalize(value)}`, "utf8")
    .digest("hex");
}
