// biome-ignore-all lint/style/useTemplate: Policy diagnostics are intentionally assembled from stable fragments.
import { glob, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const githubExpression = (path: string): string => "$" + "{{ " + path + " }}";

const files = [
  "codeql.yml",
  "dependency-review.yml",
  "release.yml",
  "scorecard.yml",
  "verify.yml",
] as const;
const pin = /^[\w.-]+(?:\/[\w.-]+)+@[a-f0-9]{40}$/u;
const approvedActions = new Set([
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
  "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "github/codeql-action/analyze@1c5b675653bb5c22dbe9b12b556ec555138e09fd",
  "github/codeql-action/init@1c5b675653bb5c22dbe9b12b556ec555138e09fd",
  "ossf/scorecard-action@2d1146689b8cda280b9bc96326124645441f03bc",
]);
const events: Record<string, Json> = {
  "verify.yml": {
    pull_request: null,
    push: { branches: ["main"] },
    workflow_dispatch: null,
  },
  "codeql.yml": {
    push: { branches: ["main"] },
    pull_request: { branches: ["main"] },
    schedule: [{ cron: "31 4 * * 1" }],
    workflow_dispatch: null,
  },
  "dependency-review.yml": { pull_request: { branches: ["main"] } },
  "scorecard.yml": {
    push: { branches: ["main"] },
    schedule: [{ cron: "47 5 * * 1" }],
    workflow_dispatch: null,
  },
  "release.yml": {
    workflow_dispatch: {
      inputs: {
        confirm: {
          description:
            "Confirm that npm package ownership and trusted publisher are configured.",
          required: true,
          type: "boolean",
          default: false,
        },
      },
    },
  },
};
const policies: Record<
  string,
  Record<
    string,
    {
      permissions: Json;
      runner: "ubuntu-latest" | "windows-latest";
      timeout: number;
      checkout: boolean;
    }
  >
> = {
  "verify.yml": {
    verify: {
      permissions: { contents: "read" },
      runner: "ubuntu-latest",
      timeout: 25,
      checkout: true,
    },
    "windows-packaging": {
      permissions: { contents: "read" },
      runner: "windows-latest",
      timeout: 25,
      checkout: true,
    },
  },
  "codeql.yml": {
    analyze: {
      permissions: { contents: "read", "security-events": "write" },
      runner: "ubuntu-latest",
      timeout: 20,
      checkout: true,
    },
  },
  "dependency-review.yml": {
    review: {
      permissions: { contents: "read" },
      runner: "ubuntu-latest",
      timeout: 10,
      checkout: false,
    },
  },
  "scorecard.yml": {
    analysis: {
      permissions: {
        contents: "read",
        "id-token": "write",
        "security-events": "write",
      },
      runner: "ubuntu-latest",
      timeout: 15,
      checkout: true,
    },
  },
  "release.yml": {
    release: {
      permissions: {
        contents: "read",
        "id-token": "write",
        attestations: "write",
        "artifact-metadata": "write",
      },
      runner: "ubuntu-latest",
      timeout: 30,
      checkout: true,
    },
  },
};
const concurrencyPolicies: Record<string, Json> = {
  "verify.yml": {
    group: [
      "verify",
      githubExpression("github.workflow"),
      githubExpression("github.ref"),
    ].join("-"),
    "cancel-in-progress": true,
  },
  "codeql.yml": {
    group: [
      "codeql",
      githubExpression("github.workflow"),
      githubExpression("github.ref"),
    ].join("-"),
    "cancel-in-progress": true,
  },
  "dependency-review.yml": {
    group: [
      "dependency-review",
      githubExpression("github.workflow"),
      githubExpression("github.event.pull_request.number"),
    ].join("-"),
    "cancel-in-progress": true,
  },
  "scorecard.yml": {
    group: [
      "scorecard",
      githubExpression("github.workflow"),
      githubExpression("github.ref"),
    ].join("-"),
    "cancel-in-progress": true,
  },
  "release.yml": {
    group: [
      "release",
      githubExpression("github.workflow"),
      githubExpression("github.ref"),
    ].join("-"),
    "cancel-in-progress": false,
  },
};
const expectedSteps: Record<string, Record<string, string[]>> = {
  "verify.yml": {
    verify: [
      "uses:actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "uses:actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "run:npm install --global --ignore-scripts pnpm@12.4.2",
      "run:pnpm install --frozen-lockfile",
      "run:git fetch --no-tags --depth=1 origin main:refs/remotes/origin/main",
      "run:pnpm changeset:check",
      "run:pnpm verify",
      "run:pnpm coverage",
      "run:pnpm security:check",
      "run:pnpm docs:check",
      "run:pnpm examples:check",
      "run:pnpm adapters:check",
      "run:pnpm conformance",
      "run:pnpm run sbom",
    ],
    "windows-packaging": [
      "uses:actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "uses:actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "run:npm install --global --ignore-scripts pnpm@12.4.2",
      "run:pnpm install --frozen-lockfile",
      "run:pnpm build",
      "run:pnpm pack:test",
      "run:pnpm conformance",
    ],
  },
  "codeql.yml": {
    analyze: [
      "uses:actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "uses:github/codeql-action/init@1c5b675653bb5c22dbe9b12b556ec555138e09fd",
      "uses:github/codeql-action/analyze@1c5b675653bb5c22dbe9b12b556ec555138e09fd",
    ],
  },
  "dependency-review.yml": {
    review: [
      "uses:actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
    ],
  },
  "scorecard.yml": {
    analysis: [
      "uses:actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "uses:ossf/scorecard-action@2d1146689b8cda280b9bc96326124645441f03bc",
    ],
  },
  "release.yml": {
    release: [
      "uses:actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "uses:actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "run:npm install --global --ignore-scripts pnpm@12.4.2",
      "run:pnpm install --frozen-lockfile",
      "run:pnpm exec tsx scripts/verify-npm-version.mts",
      "run:pnpm changeset:check",
      "run:pnpm changeset status",
      "run:pnpm release:state",
      "run:pnpm build",
      'run:pnpm pack:test -- --artifacts-dir .artifacts/packages --source-revision "$GITHUB_SHA" --source-date-epoch "$(git log -1 --format=%ct)"',
      'run:pnpm run sbom -- --artifacts-dir .artifacts/packages --output .artifacts/jev-fabric.spdx.json --source-revision "$GITHUB_SHA" --source-date-epoch "$(git log -1 --format=%ct)"',
      "run:pnpm run release:checksums -- --artifacts-dir .artifacts/packages --sbom .artifacts/jev-fabric.spdx.json",
      "uses:actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      "uses:actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
      "run:pnpm changeset publish",
    ],
  },
};

function object(value: Json | undefined): Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function same(left: Json | undefined, right: Json): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((item, index) => same(item, right[index] ?? null))
    );
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  )
    return false;
  const leftObject = object(left);
  const rightObject = object(right);
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && same(leftObject[key], rightObject[key]),
    )
  );
}
function steps(job: Record<string, Json>): Record<string, Json>[] {
  return Array.isArray(job.steps) ? job.steps.map((step) => object(step)) : [];
}
function stepSignature(step: Record<string, Json>): string | undefined {
  if (typeof step.uses === "string") return "uses:" + step.uses;
  if (typeof step.run === "string") return "run:" + step.run;
  return undefined;
}
function hasRun(job: Record<string, Json>, command: string): boolean {
  return steps(job).some((step) => step.run === command);
}
function hardenedCheckout(
  job: Record<string, Json>,
  required: boolean,
): boolean {
  const checkouts = steps(job).filter(
    (step) =>
      step.uses === "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  );
  return required
    ? checkouts.length === 1 &&
        object(checkouts[0]?.with)["persist-credentials"] === false
    : checkouts.length === 0;
}
function unsafeExpression(value: Json | undefined): boolean {
  if (typeof value === "string")
    return /\$\{\{\s*(?:github\.event(?:\.|\b)|github\.head_ref|github\.base_ref|github\.actor|github\.repository_owner|secrets\.)/u.test(
      value,
    );
  if (Array.isArray(value)) return value.some(unsafeExpression);
  return Object.values(object(value)).some(unsafeExpression);
}
function forbiddenCredentialReference(value: Json | undefined): boolean {
  if (typeof value === "string")
    return /(?:\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b|\bsecrets\s*(?:\.|\[)|\bgithub\s*(?:\.\s*token\b|\[\s*["']token["']\s*\]))/iu.test(
      value,
    );
  if (Array.isArray(value)) return value.some(forbiddenCredentialReference);
  return Object.entries(object(value)).some(
    ([key, nested]) =>
      /^(?:NPM_TOKEN|NODE_AUTH_TOKEN)$/u.test(key) ||
      forbiddenCredentialReference(nested),
  );
}
function hasVersionComment(text: string, uses: string): boolean {
  const escaped = uses.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const occurrences = text.match(
    new RegExp(`^\\s*(?:-\\s+)?uses:\\s*${escaped}[^\\n]*$`, "gmu"),
  );
  return (
    occurrences !== null &&
    occurrences.length > 0 &&
    occurrences.every((line) =>
      new RegExp(
        `^\\s*(?:-\\s+)?uses:\\s*${escaped}\\s+#\\s+v\\d[\\w.-]*\\s*$`,
        "u",
      ).test(line),
    )
  );
}
function jobSchema(file: string, name: string): string[] {
  const common = ["runs-on", "timeout-minutes", "permissions", "steps"];
  if (file === "verify.yml" && name === "verify")
    return ["name", ...common, "strategy"].sort();
  if (file === "verify.yml" && name === "windows-packaging")
    return ["name", ...common].sort();
  if (file === "release.yml") return ["environment", "if", ...common].sort();
  return common.sort();
}
function fieldMatches(
  step: Record<string, Json>,
  field: "env" | "with",
  expected: Json | undefined,
): boolean {
  return expected === undefined
    ? !(field in step)
    : same(step[field], expected);
}
function expectedStepFields(
  file: string,
  name: string,
  step: Record<string, Json>,
): { env: Json | undefined; with: Json | undefined } {
  switch (step.uses) {
    case "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1":
      return { env: undefined, with: { "persist-credentials": false } };
    case "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020":
      return {
        env: undefined,
        with: {
          "node-version":
            file === "verify.yml" && name === "verify"
              ? githubExpression("matrix.node")
              : "24",
        },
      };
    case "github/codeql-action/init@1c5b675653bb5c22dbe9b12b556ec555138e09fd":
      return {
        env: undefined,
        with: { languages: "javascript-typescript", "build-mode": "none" },
      };
    case "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294":
      return {
        env: undefined,
        with: {
          "fail-on-severity": "moderate",
          "deny-licenses": "GPL-2.0-only, GPL-3.0-only, AGPL-3.0-only",
        },
      };
    case "ossf/scorecard-action@2d1146689b8cda280b9bc96326124645441f03bc":
      return {
        env: undefined,
        with: {
          results_file: "results.sarif",
          results_format: "sarif",
          publish_results: true,
        },
      };
    case "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a":
      return {
        env: undefined,
        with: {
          name: "jev-fabric-release-evidence",
          path: ".artifacts/packages\n.artifacts/jev-fabric.spdx.json\n",
          "if-no-files-found": "error",
          "retention-days": 90,
        },
      };
    case "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6":
      return {
        env: undefined,
        with: {
          "subject-checksums": ".artifacts/packages/SHA256SUMS",
          "sbom-path": ".artifacts/jev-fabric.spdx.json",
        },
      };
    default:
      return { env: undefined, with: undefined };
  }
}
function specific(
  file: string,
  jobs: Record<string, Json>,
  errors: string[],
): void {
  if (file === "verify.yml") {
    const verify = object(jobs.verify);
    const windows = object(jobs["windows-packaging"]);
    if (!same(object(object(verify.strategy).matrix).node, ["22.14", "24"]))
      errors.push("verify.yml: Node matrix must be exactly 22.14 and 24");
    if (
      !hasRun(verify, "pnpm install --frozen-lockfile") ||
      !hasRun(windows, "pnpm install --frozen-lockfile")
    )
      errors.push("verify.yml: every verification install must be frozen");
    if (!hasRun(verify, "pnpm coverage"))
      errors.push("verify.yml: coverage evidence is required");
    if (
      !steps(windows).some((step) => object(step.with)["node-version"] === "24")
    )
      errors.push("verify.yml: Windows packaging must use Node 24");
  }
  if (
    file === "codeql.yml" &&
    !steps(object(jobs.analyze)).some(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("github/codeql-action/init@") &&
        object(step.with).languages === "javascript-typescript",
    )
  )
    errors.push("codeql.yml: JavaScript/TypeScript initialization is required");
  if (
    file === "dependency-review.yml" &&
    !steps(object(jobs.review)).some(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/dependency-review-action@"),
    )
  )
    errors.push("dependency-review.yml: dependency review action is required");
  if (
    file === "scorecard.yml" &&
    !steps(object(jobs.analysis)).some(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("ossf/scorecard-action@") &&
        object(step.with).publish_results === true,
    )
  )
    errors.push(
      "scorecard.yml: trusted Scorecard SARIF publication is required",
    );
  if (file === "release.yml") {
    const release = object(jobs.release);
    if (
      release.if !==
      "$" +
        "{{ vars.NPM_PUBLISH_ENABLED == 'true' && github.event_name == 'workflow_dispatch' && inputs.confirm }}"
    )
      errors.push(
        "release.yml: publishing gate must be default-off and dispatch-only",
      );
    if (!hasRun(release, "pnpm install --frozen-lockfile"))
      errors.push("release.yml: install must be frozen");
    if (
      !steps(release).some((step) => object(step.with)["node-version"] === "24")
    )
      errors.push("release.yml: trusted publisher requires hosted Node 24");
    if (!hasRun(release, "pnpm exec tsx scripts/verify-npm-version.mts"))
      errors.push("release.yml: npm >=11.5.1 guard is required");
    if (release.environment !== "npm-production")
      errors.push(
        "release.yml: protected npm-production environment is required",
      );
    for (const command of [
      "pnpm changeset:check",
      "pnpm changeset status",
      "pnpm release:state",
      "pnpm build",
      'pnpm pack:test -- --artifacts-dir .artifacts/packages --source-revision "$GITHUB_SHA" --source-date-epoch "$(git log -1 --format=%ct)"',
      "pnpm run release:checksums -- --artifacts-dir .artifacts/packages --sbom .artifacts/jev-fabric.spdx.json",
      "pnpm changeset publish",
    ])
      if (!hasRun(release, command))
        errors.push(`release.yml: required release step missing: ${command}`);
    if (
      !steps(release).some(
        (step) =>
          step.uses ===
          "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
      ) ||
      !steps(release).some(
        (step) =>
          step.uses ===
          "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      )
    )
      errors.push(
        "release.yml: release artifacts require upload and attestation",
      );
    if (
      steps(release).some(
        (step) =>
          typeof step.run === "string" &&
          /\b(?:npm|pnpm)\s+publish\b/u.test(step.run),
      )
    )
      errors.push("release.yml: direct publish commands are forbidden");
  }
}
export async function verifyWorkflows(root = process.cwd()): Promise<string[]> {
  const errors: string[] = [];
  const directory = resolve(root, ".github", "workflows");
  const found: string[] = [];
  for await (const file of glob("*.yml", { cwd: directory })) found.push(file);
  if (!same([...found].sort(), [...files].sort()))
    errors.push("workflow set does not match policy");
  for (const file of files) {
    const path = resolve(directory, file);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      errors.push("missing " + file);
      continue;
    }
    if (/\bpull_request_target\b/u.test(text))
      errors.push(file + ": forbidden event or registry token");
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length > 0) {
      errors.push(file + ": YAML parse error");
      continue;
    }
    const workflow = object(document.toJS() as Json);
    if (
      !same(Object.keys(workflow).sort(), [
        "concurrency",
        "jobs",
        "name",
        "on",
        "permissions",
      ])
    )
      errors.push(file + ": workflow schema does not match policy");
    if (!same(workflow.permissions, {}))
      errors.push(file + ": top-level permissions must be {}");
    if (!same(workflow.on, events[file]))
      errors.push(file + ": events do not match trusted policy");
    if (!same(workflow.concurrency, concurrencyPolicies[file]))
      errors.push(file + ": concurrency policy does not match policy");
    const jobs = object(workflow.jobs);
    if (!same(Object.keys(jobs).sort(), Object.keys(policies[file]).sort()))
      errors.push(file + ": job set does not match policy");
    for (const [name, policy] of Object.entries(policies[file])) {
      const job = object(jobs[name]);
      if (!same(Object.keys(job).sort(), jobSchema(file, name)))
        errors.push(file + "/" + name + ": job schema does not match policy");
      if (!same(job.permissions, policy.permissions))
        errors.push(
          file +
            "/" +
            name +
            ": permissions do not match least-privilege policy",
        );
      if (job["timeout-minutes"] !== policy.timeout)
        errors.push(file + "/" + name + ": timeout does not match policy");
      if (job["runs-on"] !== policy.runner)
        errors.push(
          file + "/" + name + ": runner does not match hosted policy",
        );
      if (!hardenedCheckout(job, policy.checkout))
        errors.push(
          file + "/" + name + ": checkout must disable persisted credentials",
        );
      const actualSignatures = steps(job)
        .map(stepSignature)
        .filter((signature): signature is string => signature !== undefined)
        .sort();
      const requiredSignatures = [...expectedSteps[file][name]].sort();
      if (!same(actualSignatures, requiredSignatures))
        errors.push(file + "/" + name + ": required steps do not match policy");
      if (
        forbiddenCredentialReference(workflow.env) ||
        forbiddenCredentialReference(job.env)
      )
        errors.push(
          file + "/" + name + ": credential references are forbidden",
        );
      if (unsafeExpression(workflow.env) || unsafeExpression(job.env))
        errors.push(file + "/" + name + ": untrusted expression is executable");
      for (const step of steps(job)) {
        const keys = Object.keys(step);
        const expectedFields = expectedStepFields(file, name, step);
        if (
          keys.some((key) => !["env", "run", "uses", "with"].includes(key)) ||
          (typeof step.uses === "string") === (typeof step.run === "string")
        )
          errors.push(
            file + "/" + name + ": step schema does not match policy",
          );
        if (
          !fieldMatches(step, "env", expectedFields.env) ||
          !fieldMatches(step, "with", expectedFields.with)
        )
          errors.push(
            file +
              "/" +
              name +
              ": action inputs or environment do not match policy",
          );
        if (typeof step.uses === "string" && !pin.test(step.uses))
          errors.push(file + "/" + name + ": action is not immutable");
        if (typeof step.uses === "string" && !approvedActions.has(step.uses))
          errors.push(file + "/" + name + ": action pin is not approved");
        if (
          typeof step.uses === "string" &&
          !hasVersionComment(text, step.uses)
        )
          errors.push(
            file + "/" + name + ": action requires a version comment",
          );
        if (
          unsafeExpression(step.run) ||
          unsafeExpression(step.with) ||
          unsafeExpression(step.env)
        )
          errors.push(
            file + "/" + name + ": untrusted expression is executable",
          );
        if (
          forbiddenCredentialReference(step.run) ||
          forbiddenCredentialReference(step.with) ||
          forbiddenCredentialReference(step.env)
        )
          errors.push(
            file + "/" + name + ": credential references are forbidden",
          );
      }
    }
    specific(file, jobs, errors);
  }
  return errors;
}
if (process.argv[1]?.endsWith("verify-workflows.mts")) {
  const errors = await verifyWorkflows();
  if (errors.length > 0) throw new Error(errors.join("\n"));
}
