import { isRecognizableActionTicket } from "./ticket.js";
import {
  MAX_TELEMETRY_STRING_BYTES,
  OVERSIZED_STRING_MARKER,
} from "./telemetry-limits.js";

const REDACTED = "[REDACTED]";
const sensitiveKeys = new Set([
  "apikey",
  "xapikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "credential",
  "credentials",
  "password",
  "passphrase",
  "secret",
  "signingkey",
  "token",
  "ticket",
]);
const bearer = /\bBearer\s+[^\s,;]+/giu;
const jwt = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const actionTicket =
  /v1\.[A-Za-z][A-Za-z0-9_:-]{0,127}\.[A-Za-z0-9_-]{1,8143}\.[A-Za-z0-9_-]{43}/gu;
const embeddedHttpUrl = /https?:\/\/[^\s<>"']+/giu;

/** Deterministic structural secret redaction; it is deliberately not a perfect secret detector. */
export class Redactor {
  redact(value: unknown): unknown {
    return redactValue(value, new WeakSet<object>());
  }

  sanitizeText(value: string): string {
    return Array.from(value, (character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && isControl(codePoint)
        ? `\\u${codePoint.toString(16).padStart(4, "0")}`
        : character;
    }).join("");
  }
}

function isControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function redactValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return REDACTED;
  ancestors.add(value);
  try {
    if (Array.isArray(value))
      return value.map((item) => redactValue(item, ancestors));
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const redactedKey = redactString(key);
      result[redactedKey] = isSensitiveKey(key)
        ? REDACTED
        : redactValue(item, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function redactString(value: string): string {
  if (Buffer.byteLength(value, "utf8") > MAX_TELEMETRY_STRING_BYTES)
    return OVERSIZED_STRING_MARKER;
  const redactedFormats = redactSecretFormats(value);
  const url = redactUrl(redactedFormats);
  return url ?? redactEmbeddedHttpUrls(redactedFormats);
}

function redactSecretFormats(value: string): string {
  return value
    .replace(actionTicket, (candidate) =>
      isRecognizableActionTicket(candidate) ? REDACTED : candidate,
    )
    .replace(bearer, "Bearer [REDACTED]")
    .replace(jwt, REDACTED);
}

function redactUrl(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return undefined;
  return redactHttpUrl(value);
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeys.has(key.replace(/[^A-Za-z0-9]/gu, "").toLowerCase());
}

function redactEmbeddedHttpUrls(value: string): string {
  return value.replace(
    embeddedHttpUrl,
    (candidate) => redactUrl(candidate) ?? candidate,
  );
}

/** Preserves every safe raw URI byte and replaces only secret-bearing components. */
function redactHttpUrl(value: string): string | undefined {
  const scheme = /^https?:\/\//iu.exec(value);
  if (!scheme) return undefined;
  const authorityStart = scheme[0].length;
  const fragmentStart = value.indexOf("#", authorityStart);
  const withoutFragment =
    fragmentStart < 0 ? value : value.slice(0, fragmentStart);
  const queryStart = withoutFragment.indexOf("?", authorityStart);
  const pathStart = firstDelimiter(withoutFragment, authorityStart, "/?");
  const authorityEnd = pathStart < 0 ? withoutFragment.length : pathStart;
  const pathEnd = queryStart < 0 ? withoutFragment.length : queryStart;
  const authority = value.slice(authorityStart, authorityEnd);
  const path = value.slice(authorityEnd, pathEnd);
  const query =
    queryStart < 0 ? "" : value.slice(queryStart + 1, withoutFragment.length);
  const fragment = fragmentStart < 0 ? "" : value.slice(fragmentStart + 1);
  const redactedAuthority = redactUserinfo(authority);
  const redactedPath = path
    .split("/")
    .map((segment) => redactUriComponent(segment))
    .join("/");
  const redactedQuery = redactQuery(query);
  const redactedFragment = redactUriComponent(fragment);
  if (
    redactedAuthority === authority &&
    redactedPath === path &&
    redactedQuery === query &&
    redactedFragment === fragment
  )
    return undefined;
  return `${value.slice(0, authorityStart)}${redactedAuthority}${redactedPath}${queryStart < 0 ? "" : `?${redactedQuery}`}${fragmentStart < 0 ? "" : `#${redactedFragment}`}`;
}

function firstDelimiter(
  value: string,
  start: number,
  delimiters: string,
): number {
  for (let index = start; index < value.length; index += 1) {
    if (delimiters.includes(value[index] ?? "")) return index;
  }
  return -1;
}

function redactUserinfo(authority: string): string {
  const separator = authority.lastIndexOf("@");
  return separator < 0 ? authority : authority.slice(separator + 1);
}

function redactQuery(query: string): string {
  if (!query) return query;
  return query
    .split("&")
    .map((entry) => {
      const separator = entry.indexOf("=");
      const key = separator < 0 ? entry : entry.slice(0, separator);
      const parameterValue = separator < 0 ? "" : entry.slice(separator + 1);
      const redactedValue = isSensitiveKey(tolerantPercentProjection(key, true))
        ? REDACTED
        : redactUriComponent(parameterValue);
      return redactedValue === parameterValue
        ? entry
        : `${key}=${encodeURIComponent(redactedValue)}`;
    })
    .join("&");
}

/** Bounded by the enclosing string cap; tolerantly inspects one percent-decoding pass. */
function redactUriComponent(value: string): string {
  const rawRedacted = redactSecretFormats(value);
  if (rawRedacted !== value) return REDACTED;
  const projection = tolerantPercentProjection(value, false);
  return redactSecretFormats(projection) === projection ? value : REDACTED;
}

function tolerantPercentProjection(value: string, queryKey: boolean): string {
  let projection = "";
  for (let index = 0; index < value.length; index += 1) {
    const first = value[index];
    const second = value[index + 1];
    const third = value[index + 2];
    if (first === "%" && isHex(second) && isHex(third)) {
      projection += String.fromCharCode(parseInt(`${second}${third}`, 16));
      index += 2;
    } else {
      projection += queryKey && first === "+" ? " " : first;
    }
  }
  return projection;
}

function isHex(value: string | undefined): boolean {
  return value !== undefined && /^[0-9A-Fa-f]$/u.test(value);
}
