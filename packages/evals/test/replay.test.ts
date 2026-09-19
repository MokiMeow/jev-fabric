import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replayArtifacts } from "../src/index.js";
describe("offline replay", () => {
  it("authenticates every artifact before rendering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jev-evals-"));
    await cp("../../benchmarks/historical/v0", directory, { recursive: true });
    const first = await replayArtifacts(directory);
    const second = await replayArtifacts(directory);
    expect(first.digest).toBe(second.digest);
    await writeFile(join(directory, "attempts.jsonl"), "tampered\n");
    await expect(replayArtifacts(directory)).rejects.toThrow(/digest/);
  });
});
