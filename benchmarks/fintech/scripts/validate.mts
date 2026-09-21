import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Options, ValidateFunction } from "ajv";
import Ajv2020Module from "ajv/dist/2020.js";
import { assertFintechEvidence, renderFintechReport } from "./evidence.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const maximumArtifactBytes = 64 * 1024 * 1024;
const Ajv2020 = Ajv2020Module as unknown as new (
  options?: Options,
) => { compile(schema: object): ValidateFunction };

function inputPath(args: readonly string[]): string {
  if (args.length === 0) return join(root, "fixtures", "run.not-run.jsonc");
  if (args.length !== 2 || args[0] !== "--input")
    throw new TypeError("usage: validate.mts [--input <evidence.json>]");
  const candidate = args[1];
  if (!candidate) throw new TypeError("--input requires a path");
  return isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(process.cwd(), candidate);
}

async function readBoundedJson(path: string): Promise<unknown> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new TypeError(
      "fintech evidence input must be a regular non-symlink file",
    );
  if (before.size > maximumArtifactBytes)
    throw new TypeError("fintech evidence input exceeds the 64 MiB limit");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.size !== before.size)
      throw new TypeError("fintech evidence input changed while opening");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

const path = inputPath(process.argv.slice(2));
const [value, schema] = await Promise.all([
  readBoundedJson(path),
  readBoundedJson(join(root, "schema", "run.schema.jsonc")),
]);
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(
  schema as object,
);
if (!validateSchema(value))
  throw new TypeError(
    `fintech evidence schema validation failed: ${JSON.stringify(validateSchema.errors)}`,
  );
assertFintechEvidence(value);
process.stdout.write(renderFintechReport(value));
