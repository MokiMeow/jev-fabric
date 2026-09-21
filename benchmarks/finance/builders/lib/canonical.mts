import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const hashPattern = /^sha256:[a-f0-9]{64}$/u;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("canonical JSON cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (typeof value !== "object")
    throw new TypeError(`unsupported canonical JSON value: ${typeof value}`);

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("canonical JSON objects must have a plain prototype");

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function assertSha256(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || !hashPattern.test(value))
    throw new TypeError(`${field} must be a lowercase sha256 digest`);
}

export function parseCanonicalJsonLines(
  bytes: Uint8Array,
  label: string,
): readonly Record<string, unknown>[] {
  const text = textDecoder.decode(bytes);
  if (text.startsWith("\uFEFF"))
    throw new TypeError(`${label} must not contain a BOM`);
  if (text.includes("\r"))
    throw new TypeError(`${label} must use LF line endings`);
  if (!text.endsWith("\n"))
    throw new TypeError(
      `${label} must end with exactly one LF-terminated record`,
    );

  const lines = text.slice(0, -1).split("\n");
  if (lines.length === 0 || lines.some((line) => line.length === 0))
    throw new TypeError(`${label} must not contain blank records`);

  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new TypeError(`${label} line ${index + 1} is not valid JSON`, {
        cause: error,
      });
    }
    if (!isRecord(parsed))
      throw new TypeError(`${label} line ${index + 1} must be a JSON object`);
    if (canonicalJson(parsed) !== line)
      throw new TypeError(`${label} line ${index + 1} is not canonical JSON`);
    return parsed;
  });
}

export function assertSafeRelativePath(
  value: unknown,
  field: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 240 ||
    isAbsolute(value) ||
    value.includes("\\") ||
    value.includes("\0")
  )
    throw new TypeError(`${field} must be a bounded POSIX relative path`);
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !/^[a-z0-9][a-z0-9._-]*$/iu.test(segment) ||
        segment.endsWith(".") ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment),
    )
  )
    throw new TypeError(`${field} contains an unsafe path segment`);
}

export async function readSafeRelativeFile(
  root: string,
  relativePath: string,
  maximumBytes = 10 * 1024 * 1024,
): Promise<Uint8Array> {
  assertSafeRelativePath(relativePath, "path");
  const rootPath = resolve(root);
  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new TypeError(`unsafe root directory: ${rootPath}`);
  const canonicalRoot = await realpath(rootPath);

  let cursor = rootPath;
  for (const segment of relativePath.split("/")) {
    cursor = resolve(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink())
      throw new TypeError(`symlink is not allowed: ${relativePath}`);
  }

  const canonicalTarget = await realpath(cursor);
  const fromRoot = relative(canonicalRoot, canonicalTarget);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  )
    throw new TypeError(`path escapes its root: ${relativePath}`);

  const pathBeforeOpen = await lstat(canonicalTarget);
  if (!pathBeforeOpen.isFile() || pathBeforeOpen.isSymbolicLink())
    throw new TypeError(`path is not a regular file: ${relativePath}`);
  const handle = await open(canonicalTarget, "r");
  try {
    const handleBeforeRead = await handle.stat();
    assertSameFile(pathBeforeOpen, handleBeforeRead, relativePath);
    if (!handleBeforeRead.isFile())
      throw new TypeError(`opened path is not a regular file: ${relativePath}`);
    if (handleBeforeRead.size > maximumBytes)
      throw new TypeError(
        `file exceeds ${maximumBytes} bytes: ${relativePath}`,
      );

    const bytes = await readOpenedFileWithinLimit(
      handle,
      relativePath,
      maximumBytes,
    );
    const [handleAfterRead, pathAfterRead] = await Promise.all([
      handle.stat(),
      lstat(canonicalTarget),
    ]);
    if (pathAfterRead.isSymbolicLink())
      throw new TypeError(
        `path became a symlink while being read: ${relativePath}`,
      );
    assertSameFile(handleBeforeRead, handleAfterRead, relativePath);
    assertSameFile(handleAfterRead, pathAfterRead, relativePath);
    if (bytes.byteLength !== handleAfterRead.size)
      throw new TypeError(
        `file size changed while being read: ${relativePath}`,
      );
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readOpenedFileWithinLimit(
  handle: Awaited<ReturnType<typeof open>>,
  relativePath: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)
    throw new TypeError("maximumBytes must be a non-negative safe integer");
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const remainingThroughSentinel = maximumBytes + 1 - total;
    if (remainingThroughSentinel <= 0)
      throw new TypeError(
        `file exceeds ${maximumBytes} bytes: ${relativePath}`,
      );
    const requested = Math.min(64 * 1024, remainingThroughSentinel);
    const chunk = Buffer.allocUnsafe(requested);
    const { bytesRead } = await handle.read(chunk, 0, requested, total);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maximumBytes)
      throw new TypeError(
        `file exceeds ${maximumBytes} bytes: ${relativePath}`,
      );
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

function assertSameFile(
  before: Awaited<ReturnType<typeof lstat>>,
  after: Awaited<ReturnType<typeof lstat>>,
  relativePath: string,
): void {
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw new TypeError(`file changed while being read: ${relativePath}`);
}

export function assertCanonicalHttpsUrl(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string")
    throw new TypeError(`${field} must be an HTTPS URL`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TypeError(`${field} must be an absolute URL`, { cause: error });
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    parsed.search !== "" ||
    parsed.hostname === ""
  )
    throw new TypeError(`${field} must be credential-free canonical HTTPS`);
  if (parsed.toString() !== value)
    throw new TypeError(`${field} must use the URL canonical serialization`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  field = "object",
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new TypeError(`${field} has unknown key: ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key))
      throw new TypeError(`${field} is missing ${key}`);
  }
}
