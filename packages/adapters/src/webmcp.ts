import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

/**
 * Experimental WebMCP boundary: all page-derived fields are untrusted. A host
 * must project the approved origin, frame, tool and schema before calling this
 * module. This module deliberately contains no browser or tool-execution API.
 */
export interface TrustedWebMcpHostProjection {
  readonly origin: string;
  readonly frameId: string;
  readonly toolName: string;
  readonly inputSchema: JsonValue;
  readonly policyEpoch: string;
  readonly stateVersion: string;
}

/** Values observed from a page; callers must not treat them as instructions. */
export interface UntrustedWebMcpPageMetadata {
  readonly origin: unknown;
  readonly frameId: unknown;
  readonly toolName: unknown;
  readonly inputSchema: unknown;
}

export interface WebMcpAdvisoryBinding {
  readonly advisoryOnly: true;
  readonly execution: "NOT_SUPPORTED";
  readonly originFingerprint: string;
  readonly frameFingerprint: string;
  readonly toolFingerprint: string;
  readonly schemaFingerprint: string;
  readonly policyEpoch: string;
  readonly stateVersion: string;
  readonly bindingFingerprint: string;
}

/**
 * Trusted deployment facts for mcp-handler's experimental WebMCP bridge.
 * Every exposed tool must also appear in `readOnlyToolNames`; this alpha
 * boundary deliberately excludes side-effectful bridged tools.
 */
export interface TrustedMcpHandlerWebMcpProjection
  extends TrustedWebMcpHostProjection {
  readonly bridgeRevision: string;
  readonly endpointPath: string;
  readonly exposedTools: readonly string[];
  readonly readOnlyToolNames: readonly string[];
  readonly credentials: "same-origin";
  readonly requireSameOriginFetch: true;
}

/** Page-observed bridge metadata. It is untrusted even when same-origin. */
export interface UntrustedMcpHandlerWebMcpMetadata
  extends UntrustedWebMcpPageMetadata {
  readonly scriptUrl: unknown;
  readonly readOnlyHint: unknown;
}

export interface McpHandlerWebMcpAdvisoryBinding extends WebMcpAdvisoryBinding {
  readonly authority: "NONE";
  readonly bridge: "mcp-handler-webmcp";
  readonly bridgeRevision: string;
  readonly endpointFingerprint: string;
  readonly allowlistFingerprint: string;
  readonly credentials: "same-origin";
  readonly readOnlyOnly: true;
  readonly requiresHostRevalidation: true;
  readonly sameOriginCookieGate: "REQUIRED";
  readonly bridgeBindingFingerprint: string;
}

type JsonPrimitive = null | boolean | number | string;
type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const safeIdentifier = /^[A-Za-z0-9._-]{1,120}$/u;
const safeToolName = /^[A-Za-z][A-Za-z0-9._-]{0,119}$/u;
const safeEndpointPath = /^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+\/?$/u;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 2_048;
const MAX_CANONICAL_BYTES = 65_536;
const MAX_CONTAINER_ENTRIES = 64;
const MAX_PROPERTY_NAME_LENGTH = 120;
const schemaKeys = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
]);

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });

function fail(message: string): never {
  throw new TypeError(`invalid WebMCP advisory boundary: ${message}`);
}

interface JsonWorkItem {
  readonly source: unknown;
  readonly depth: number;
  readonly assign: (value: JsonValue) => void;
}

function dataProperties(
  value: object,
  label: string,
): Readonly<Record<string, unknown>> {
  if (isProxy(value)) fail(`${label} must not be a proxy`);
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    fail(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length > 0)
    fail(`${label} must not contain symbol properties`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable)
      fail(`${label} must contain only enumerable data properties`);
    result[key] = descriptor.value;
  }
  return result;
}

function arrayValues(value: readonly unknown[]): readonly unknown[] {
  if (isProxy(value)) fail("JSON array must not be a proxy");
  if (Object.getPrototypeOf(value) !== Array.prototype)
    fail("JSON array must be a plain array");
  if (value.length > MAX_CONTAINER_ENTRIES) fail("oversized JSON array");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowedKeys = new Set(["length"]);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    allowedKeys.add(key);
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      fail("JSON arrays must be dense and contain only data properties");
    result.push(descriptor.value);
  }
  if (Reflect.ownKeys(descriptors).some((key) => !allowedKeys.has(String(key))))
    fail("JSON array contains an extra property");
  return result;
}

/** Copy hostile input into bounded, accessor-free JSON without recursion. */
function sanitizeJson(value: unknown): JsonValue {
  const root: { value?: JsonValue } = {};
  const seenObjects = new WeakSet<object>();
  const work: JsonWorkItem[] = [
    {
      source: value,
      depth: 0,
      assign: (clean) => {
        root.value = clean;
      },
    },
  ];
  let nodes = 0;
  while (work.length > 0) {
    const item = work.pop();
    if (!item) fail("internal JSON traversal failure");
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail("oversized JSON graph");
    if (item.depth > MAX_JSON_DEPTH) fail("JSON nesting is too deep");
    const source = item.source;
    if (source === null || typeof source === "boolean") {
      item.assign(source);
      continue;
    }
    if (typeof source === "number") {
      if (!Number.isFinite(source)) fail("non-finite JSON number");
      item.assign(source);
      continue;
    }
    if (typeof source === "string") {
      if (source.length > 240) fail("oversized JSON string");
      item.assign(source);
      continue;
    }
    if (!source || typeof source !== "object") fail("non-JSON metadata");
    if (seenObjects.has(source))
      fail("cyclic or shared JSON object references are forbidden");
    seenObjects.add(source);
    if (Array.isArray(source)) {
      const values = arrayValues(source);
      const clean: JsonValue[] = new Array(values.length);
      item.assign(clean);
      for (let index = values.length - 1; index >= 0; index -= 1) {
        const targetIndex = index;
        work.push({
          source: values[targetIndex],
          depth: item.depth + 1,
          assign: (child) => {
            clean[targetIndex] = child;
          },
        });
      }
      continue;
    }
    const properties = dataProperties(source, "JSON object");
    const keys = Object.keys(properties).sort();
    if (keys.length > MAX_CONTAINER_ENTRIES) fail("oversized JSON object");
    const clean: Record<string, JsonValue> = Object.create(null) as Record<
      string,
      JsonValue
    >;
    item.assign(clean);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (
        !key ||
        key.length > MAX_PROPERTY_NAME_LENGTH ||
        hasControlCharacter(key)
      )
        fail("unsafe JSON property name");
      work.push({
        source: properties[key],
        depth: item.depth + 1,
        assign: (child) => {
          clean[key] = child;
        },
      });
    }
  }
  if (root.value === undefined) fail("missing JSON value");
  return root.value;
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sanitizeJson(value));
  if (new TextEncoder().encode(serialized).byteLength > MAX_CANONICAL_BYTES)
    fail("oversized canonical JSON");
  return serialized;
}

function assertSchema(value: JsonValue): void {
  const work: JsonValue[] = [value];
  while (work.length > 0) {
    const node = work.pop();
    if (!node || typeof node !== "object" || Array.isArray(node))
      fail("schema node must be an object");
    const record = node as Readonly<Record<string, JsonValue>>;
    for (const [key, child] of Object.entries(record)) {
      if (!schemaKeys.has(key)) fail("unapproved schema annotation or keyword");
      if (key === "properties") {
        if (!child || typeof child !== "object" || Array.isArray(child))
          fail("schema properties must be an object");
        for (const property of Object.values(child as Record<string, unknown>))
          work.push(property as JsonValue);
      } else if (key === "additionalProperties") {
        if (typeof child !== "boolean") work.push(child);
      } else if (key === "items" || key === "not") work.push(child);
      else if (["allOf", "anyOf", "oneOf"].includes(key)) {
        if (!Array.isArray(child)) fail("schema composition must be an array");
        for (const branch of child) work.push(branch);
      } else if (key === "required") {
        if (
          !Array.isArray(child) ||
          child.some((name) => typeof name !== "string")
        )
          fail("schema required must be a string array");
      } else if (key === "type") {
        const types = Array.isArray(child) ? child : [child];
        const allowed = new Set([
          "null",
          "boolean",
          "object",
          "array",
          "number",
          "integer",
          "string",
        ]);
        if (
          types.length === 0 ||
          types.some((type) => typeof type !== "string" || !allowed.has(type))
        )
          fail("schema type is unsupported");
      } else if (["minimum", "maximum"].includes(key)) {
        if (typeof child !== "number") fail("schema bound must be numeric");
      } else if (["minLength", "maxLength"].includes(key)) {
        if (
          typeof child !== "number" ||
          !Number.isSafeInteger(child) ||
          child < 0
        )
          fail("schema length must be a non-negative integer");
      } else if (["pattern", "format"].includes(key)) {
        if (typeof child !== "string")
          fail("schema text constraint must be a string");
      } else if (key === "enum") {
        if (!Array.isArray(child) || child.length === 0)
          fail("schema enum must be a non-empty array");
      }
    }
  }
}

function canonicalSchema(value: unknown): string {
  const clean = sanitizeJson(value);
  assertSchema(clean);
  const serialized = JSON.stringify(clean);
  if (new TextEncoder().encode(serialized).byteLength > MAX_CANONICAL_BYTES)
    fail("oversized canonical JSON");
  return serialized;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function trustedOrigin(value: unknown): string {
  if (typeof value !== "string") fail("origin must be a string");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("origin is not a URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== value
  )
    fail("origin must be a canonical HTTPS origin");
  return value;
}

function identifier(
  value: unknown,
  label: string,
  expression = safeIdentifier,
): string {
  if (typeof value !== "string" || !expression.test(value))
    fail(`${label} is unsafe`);
  return value;
}

function canonicalEndpointPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 240 ||
    !safeEndpointPath.test(value) ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  )
    fail("mcp-handler endpoint path is unsafe");
  return value;
}

function toolNameList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const values = arrayValues(value);
  if (values.length === 0 || values.length > MAX_CONTAINER_ENTRIES)
    fail(`${label} must contain between 1 and 64 tools`);
  const names = values.map((entry) =>
    identifier(entry, `${label} entry`, safeToolName),
  );
  if (new Set(names).size !== names.length)
    fail(`${label} must not contain duplicate tools`);
  const sorted = [...names].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (JSON.stringify(names) !== JSON.stringify(sorted))
    fail(`${label} must be sorted`);
  return names;
}

function exactBridgeScriptUrl(
  value: unknown,
  origin: string,
  endpointPath: string,
): string {
  if (typeof value !== "string") fail("bridge script URL must be a string");
  const expected = `${origin}${endpointPath}?webmcp-script`;
  if (value.length !== expected.length)
    fail("bridge script URL must have the exact expected length");
  let scriptUrl: URL;
  try {
    scriptUrl = new URL(value);
  } catch {
    fail("bridge script URL is not a URL");
  }
  if (
    scriptUrl.href !== expected ||
    scriptUrl.origin !== origin ||
    scriptUrl.pathname !== endpointPath ||
    scriptUrl.search !== "?webmcp-script" ||
    scriptUrl.hash
  )
    fail("bridge script URL must be the exact same-origin mcp-handler asset");
  return value;
}

function projection(
  input: TrustedWebMcpHostProjection,
): TrustedWebMcpHostProjection {
  if (!input || typeof input !== "object")
    fail("trusted projection is required");
  const fields = dataProperties(input, "trusted projection");
  const expected = [
    "frameId",
    "inputSchema",
    "origin",
    "policyEpoch",
    "stateVersion",
    "toolName",
  ];
  if (JSON.stringify(Object.keys(fields).sort()) !== JSON.stringify(expected))
    fail("trusted projection has unexpected fields");
  return {
    origin: trustedOrigin(fields.origin),
    frameId: identifier(fields.frameId, "frame id"),
    toolName: identifier(fields.toolName, "tool name", safeToolName),
    inputSchema: JSON.parse(canonicalSchema(fields.inputSchema)) as JsonValue,
    policyEpoch: identifier(fields.policyEpoch, "policy epoch"),
    stateVersion: identifier(fields.stateVersion, "state version"),
  };
}

function pageMetadata(input: UntrustedWebMcpPageMetadata): {
  readonly origin: string;
  readonly frameId: string;
  readonly toolName: string;
  readonly inputSchema: JsonValue;
} {
  if (!input || typeof input !== "object") fail("page metadata is required");
  const fields = dataProperties(input, "page metadata");
  const keys = Object.keys(fields).sort();
  if (
    JSON.stringify(keys) !==
    JSON.stringify(["frameId", "inputSchema", "origin", "toolName"])
  )
    fail("page metadata contains an untrusted hint, description, or output");
  return {
    origin: trustedOrigin(fields.origin),
    frameId: identifier(fields.frameId, "page frame id"),
    toolName: identifier(fields.toolName, "page tool name", safeToolName),
    inputSchema: JSON.parse(canonicalSchema(fields.inputSchema)) as JsonValue,
  };
}

/**
 * Produces a stable, advisory-only binding. It intentionally returns neither
 * page descriptions nor page output and never invokes a browser or WebMCP tool.
 */
export function bindWebMcpAdvisory(
  hostProjection: TrustedWebMcpHostProjection,
  untrustedPageMetadata: UntrustedWebMcpPageMetadata,
): WebMcpAdvisoryBinding {
  const trusted = projection(hostProjection);
  const page = pageMetadata(untrustedPageMetadata);
  if (page.origin !== trusted.origin) fail("cross-origin page metadata");
  if (page.frameId !== trusted.frameId) fail("frame binding drift");
  if (page.toolName !== trusted.toolName) fail("tool binding drift");
  const schemaFingerprint = fingerprint(trusted.inputSchema);
  if (fingerprint(page.inputSchema) !== schemaFingerprint)
    fail("schema binding drift");
  const originFingerprint = fingerprint({ origin: trusted.origin });
  const frameFingerprint = fingerprint({
    origin: trusted.origin,
    frameId: trusted.frameId,
  });
  const toolFingerprint = fingerprint({ toolName: trusted.toolName });
  const binding = {
    originFingerprint,
    frameFingerprint,
    toolFingerprint,
    schemaFingerprint,
    policyEpoch: trusted.policyEpoch,
    stateVersion: trusted.stateVersion,
  };
  return {
    advisoryOnly: true,
    execution: "NOT_SUPPORTED",
    ...binding,
    bindingFingerprint: fingerprint(binding),
  };
}

/**
 * Binds mcp-handler 2.2+'s experimental bridge without importing mcp-handler,
 * inspecting cookies, making a network request, or exposing an execution API.
 * The returned value is provenance only; the host still enforces cookie auth,
 * current policy, user consent, and tool execution.
 */
export function bindMcpHandlerWebMcpAdvisory(
  hostProjection: TrustedMcpHandlerWebMcpProjection,
  untrustedPageMetadata: UntrustedMcpHandlerWebMcpMetadata,
): McpHandlerWebMcpAdvisoryBinding {
  if (!hostProjection || typeof hostProjection !== "object")
    fail("trusted mcp-handler projection is required");
  const trustedFields = dataProperties(
    hostProjection,
    "trusted mcp-handler projection",
  );
  const expectedTrustedFields = [
    "bridgeRevision",
    "credentials",
    "endpointPath",
    "exposedTools",
    "frameId",
    "inputSchema",
    "origin",
    "policyEpoch",
    "readOnlyToolNames",
    "requireSameOriginFetch",
    "stateVersion",
    "toolName",
  ];
  if (
    JSON.stringify(Object.keys(trustedFields).sort()) !==
    JSON.stringify(expectedTrustedFields)
  )
    fail("trusted mcp-handler projection has unexpected fields");

  const baseProjection = projection({
    origin: trustedFields.origin as string,
    frameId: trustedFields.frameId as string,
    toolName: trustedFields.toolName as string,
    inputSchema: trustedFields.inputSchema as JsonValue,
    policyEpoch: trustedFields.policyEpoch as string,
    stateVersion: trustedFields.stateVersion as string,
  });
  const bridgeRevision = identifier(
    trustedFields.bridgeRevision,
    "bridge revision",
  );
  const endpointPath = canonicalEndpointPath(trustedFields.endpointPath);
  const exposedTools = toolNameList(
    trustedFields.exposedTools,
    "exposed tools",
  );
  const readOnlyToolNames = toolNameList(
    trustedFields.readOnlyToolNames,
    "read-only tools",
  );
  if (JSON.stringify(exposedTools) !== JSON.stringify(readOnlyToolNames))
    fail("every exposed bridge tool must be host-declared read-only");
  if (!exposedTools.includes(baseProjection.toolName))
    fail("selected tool is absent from the bridge allowlist");
  if (trustedFields.credentials !== "same-origin")
    fail("mcp-handler bridge credentials must be same-origin");
  if (trustedFields.requireSameOriginFetch !== true)
    fail("same-origin cookie request enforcement is required");

  if (!untrustedPageMetadata || typeof untrustedPageMetadata !== "object")
    fail("mcp-handler page metadata is required");
  const pageFields = dataProperties(
    untrustedPageMetadata,
    "mcp-handler page metadata",
  );
  const expectedPageFields = [
    "frameId",
    "inputSchema",
    "origin",
    "readOnlyHint",
    "scriptUrl",
    "toolName",
  ];
  if (
    JSON.stringify(Object.keys(pageFields).sort()) !==
    JSON.stringify(expectedPageFields)
  )
    fail("mcp-handler page metadata contains an untrusted extra field");
  if (pageFields.readOnlyHint !== true)
    fail("page tool is not marked read-only");
  const scriptUrl = exactBridgeScriptUrl(
    pageFields.scriptUrl,
    baseProjection.origin,
    endpointPath,
  );
  const baseBinding = bindWebMcpAdvisory(baseProjection, {
    origin: pageFields.origin,
    frameId: pageFields.frameId,
    toolName: pageFields.toolName,
    inputSchema: pageFields.inputSchema,
  });
  const endpointFingerprint = fingerprint({
    origin: baseProjection.origin,
    endpointPath,
    scriptUrl,
  });
  const allowlistFingerprint = fingerprint({
    exposedTools,
    readOnlyToolNames,
  });
  const bridgeBinding = {
    baseBindingFingerprint: baseBinding.bindingFingerprint,
    bridge: "mcp-handler-webmcp",
    bridgeRevision,
    endpointFingerprint,
    allowlistFingerprint,
    credentials: "same-origin",
    readOnlyOnly: true,
    sameOriginCookieGate: "REQUIRED",
  } as const;
  return {
    ...baseBinding,
    authority: "NONE",
    bridge: "mcp-handler-webmcp",
    bridgeRevision,
    endpointFingerprint,
    allowlistFingerprint,
    credentials: "same-origin",
    readOnlyOnly: true,
    requiresHostRevalidation: true,
    sameOriginCookieGate: "REQUIRED",
    bridgeBindingFingerprint: fingerprint(bridgeBinding),
  };
}
