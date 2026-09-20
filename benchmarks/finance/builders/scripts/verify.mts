#!/usr/bin/env node
import { resolve } from "node:path";
import { verifyFinanceBuilderDirectory } from "../lib/verify.mjs";

function argument(name: string, required = false): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (required && (value === undefined || value.startsWith("--")))
    throw new TypeError(`missing required argument: ${name}`);
  return value;
}

const dataset = argument("--dataset", true);
const cache = argument("--cache", true);
const compare = argument("--compare");

const result = await verifyFinanceBuilderDirectory({
  datasetDirectory: resolve(dataset as string),
  cacheDirectory: resolve(cache as string),
  ...(compare === undefined
    ? {}
    : { compareDatasetDirectory: resolve(compare) }),
});

process.stdout.write(`${JSON.stringify(result)}\n`);
