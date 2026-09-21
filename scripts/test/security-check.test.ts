import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { securityCheck } from "../security-check.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "jev-fabric-security-"));
  roots.push(root);
  await writeFile(join(root, "fixture.txt"), content, "utf8");
  return root;
}

test("rejects a standalone TypeSafe API credential without echoing it", async () => {
  const credential = `${"api"}key_${"a".repeat(40)}_${"b".repeat(40)}`;
  const root = await fixture(`credential ${credential}`);
  await assert.rejects(securityCheck(root), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /fixture\.txt: secret-like value/u);
    assert.equal(error.message.includes(credential), false);
    return true;
  });
});

test("retains labeled SDK-key detection and permits inert placeholders", async () => {
  const sdkCredential = `${"ts"}_${"c".repeat(24)}`;
  const rejected = await fixture(`api_key = '${sdkCredential}'`);
  await assert.rejects(securityCheck(rejected), /secret-like value/u);

  const placeholder = await fixture("TYPESAFE_API_KEY=replace-me");
  await assert.doesNotReject(securityCheck(placeholder));
});

test("does not confuse uppercase source identifiers with credential values", async () => {
  const root = await fixture("inputNanoUsdPerInputToken: JEV_PRICING_EVIDENCE");
  await assert.doesNotReject(securityCheck(root));
});

test("scans test directories instead of treating them as secret-safe", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-fabric-security-"));
  roots.push(root);
  const testDirectory = join(root, "test");
  await mkdir(testDirectory);
  const credential = `${"api"}key_${"d".repeat(64)}`;
  await writeFile(join(testDirectory, "credential.txt"), credential, "utf8");
  await assert.rejects(securityCheck(root), /secret-like value/u);
});
