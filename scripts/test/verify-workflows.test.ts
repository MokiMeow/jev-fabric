import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");

describe("repository workflow contract", () => {
  it("has a fail-closed workflow verifier", async () => {
    const module = await import(
      new URL("../verify-workflows.mts", import.meta.url).href
    );
    await expect(module.verifyWorkflows(root)).resolves.toEqual([]);
  });

  it("rejects hostile workflow policy mutations", async () => {
    const fixture = await mkdtemp(
      join(tmpdir(), "jev-fabric-workflow-fixture-"),
    );
    const workflowRoot = resolve(fixture, ".github");
    try {
      await cp(resolve(root, ".github"), workflowRoot, { recursive: true });
      const verifier = await import(
        new URL("../verify-workflows.mts", import.meta.url).href
      );
      const mutations = [
        [
          "verify.yml",
          "persist-credentials: false",
          "persist-credentials: true",
        ],
        ["verify.yml", "contents: read", "contents: write"],
        ["verify.yml", "pull_request:", "pull_request_target:"],
        [
          "verify.yml",
          "pnpm verify",
          "echo $" + "{{ github.event.pull_request.title }}",
        ],
        ["verify.yml", "# v7.0.1", "# unversioned"],
        ["verify.yml", "timeout-minutes: 25", "timeout-minutes: 120"],
        ["verify.yml", "cancel-in-progress: true", "cancel-in-progress: false"],
        ["verify.yml", 'node: ["22.14", "24"]', 'node: ["20"]'],
        ["verify.yml", "pnpm install --frozen-lockfile", "pnpm install"],
        ["verify.yml", "pnpm coverage", "pnpm test"],
        [
          "verify.yml",
          "      - run: pnpm coverage",
          "      - run: pnpm coverage\n        env:\n          EXTRA: safe",
        ],
        [
          "verify.yml",
          "      - run: pnpm coverage",
          "      - run: pnpm coverage\n        env:\n          EXTRA: $" +
            "{{ github.token }}",
        ],
        [
          "verify.yml",
          "          cache: pnpm",
          "          cache: pnpm\n          token: safe",
        ],
        [
          "verify.yml",
          "          cache: pnpm",
          "          cache: pnpm\n          token: $" + "{{ github.token }}",
        ],
        [
          "verify.yml",
          "permissions: {}",
          "env:\n  EXTRA: $" + "{{ github . token }}\npermissions: {}",
        ],
        [
          "verify.yml",
          "    permissions:\n      contents: read",
          "    env:\n      EXTRA: $" +
            "{{ github['TOKEN'] }}\n    permissions:\n      contents: read",
        ],
        [
          "verify.yml",
          "      - run: pnpm docs:check",
          "      - run: pnpm docs:check\n        env:\n          EXTRA: $" +
            "{{ SeCrEtS . GITHUB_TOKEN }}",
        ],
        [
          "verify.yml",
          "      - run: pnpm security:check",
          "      - run: echo $" + "{{ github['TOKEN'] }}",
        ],
        ["codeql.yml", "security-events: write", "issues: write"],
        ["dependency-review.yml", "pull_request:", "push:"],
        ["scorecard.yml", "id-token: write", "attestations: write"],
        [
          "release.yml",
          "vars.NPM_PUBLISH_ENABLED == 'true'",
          "vars.NPM_PUBLISH_ENABLED == 'false'",
        ],
        ["release.yml", "id-token: write", "id-token: read"],
        ["release.yml", "runs-on: ubuntu-latest", "runs-on: self-hosted"],
        ["release.yml", "environment: npm-production", "environment: public"],
        ["release.yml", "attestations: write", "attestations: read"],
        ["release.yml", "artifact-metadata: write", "artifact-metadata: read"],
        [
          "release.yml",
          "    permissions:\n      contents: read",
          "    env:\n      EXTRA: $" +
            "{{ secrets.EXTRA_TOKEN }}\n    permissions:\n      contents: read",
        ],
        [
          "verify.yml",
          "    permissions:\n      contents: read",
          "    env:\n      TITLE: $" +
            "{{ github.event.pull_request.title }}\n    permissions:\n      contents: read",
        ],
        [
          "release.yml",
          "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
          "actions/attest@main",
        ],
        [
          "release.yml",
          "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
          "actions/upload-artifact@main",
        ],
        ["release.yml", "pnpm changeset status", "pnpm changeset check"],
        ["release.yml", "pnpm release:state", "pnpm release-state"],
        ["release.yml", "pnpm changeset publish", "pnpm publish"],
        ["release.yml", "subject-checksums", "subject-path"],
      ] as const;
      for (const [file, expected, replacement] of mutations) {
        const path = resolve(workflowRoot, "workflows", file);
        const original = await readFile(path, "utf8");
        expect(original).toContain(expected);
        await writeFile(path, original.replace(expected, replacement));
        expect(
          await verifier.verifyWorkflows(fixture),
          `${file}: ${expected}`,
        ).not.toEqual([]);
        await writeFile(path, original);
      }

      const codeql = resolve(workflowRoot, "workflows", "codeql.yml");
      const codeqlOriginal = await readFile(codeql, "utf8");
      const checkout =
        "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n" +
        "        with:\n" +
        "          persist-credentials: false\n";
      expect(codeqlOriginal).toContain(checkout);
      await writeFile(codeql, codeqlOriginal.replace(checkout, ""));
      expect(await verifier.verifyWorkflows(fixture)).not.toEqual([]);
      await writeFile(codeql, codeqlOriginal);

      const verify = resolve(workflowRoot, "workflows", "verify.yml");
      const verifyOriginal = await readFile(verify, "utf8");
      const uncommentedAction =
        "      - name: Checkout\n" +
        "        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n" +
        "        with:\n" +
        "          persist-credentials: false";
      await writeFile(
        verify,
        verifyOriginal.replace(
          "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n" +
            "        with:\n" +
            "          persist-credentials: false",
          uncommentedAction,
        ),
      );
      expect(await verifier.verifyWorkflows(fixture)).not.toEqual([]);
      await writeFile(verify, verifyOriginal);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
