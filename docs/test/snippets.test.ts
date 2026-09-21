import { execFile as execFileCallback, execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const packSmoke = resolve(root, "scripts/pack-smoke.mjs");
const execFile = promisify(execFileCallback);

function npm(arguments_: string[], cwd: string): string {
  const [command, commandArguments]: [string, string[]] =
    process.platform === "win32"
      ? [
          process.execPath,
          [
            join(
              dirname(process.execPath),
              "node_modules",
              "npm",
              "bin",
              "npm-cli.js",
            ),
            ...arguments_,
          ],
        ]
      : ["npm", arguments_];
  return execFileSync(command, commandArguments, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      TEMP: process.env.TEMP ?? tmpdir(),
      TMP: process.env.TMP ?? tmpdir(),
      ...(process.platform === "win32"
        ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec }
        : {}),
      npm_config_registry: "http://127.0.0.1:9/",
    },
  });
}

async function installPackedFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "jev-fabric-public-docs-"));
  const artifacts = join(directory, "packed-artifacts");
  await mkdir(artifacts);
  await execFile(process.execPath, [packSmoke, "--artifacts-dir", artifacts], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
  const fixture = join(artifacts, "consumer-fixture");
  await expect(readFile(join(fixture, "package.json"))).resolves.toBeTruthy();
  await expect(readFile(join(fixture, ".npmrc"))).resolves.toBeTruthy();
  expect((await readdir(join(fixture, "tarballs"))).length).toBeGreaterThan(0);
  await writeFile(
    join(fixture, "network-trap.cjs"),
    "for (const name of ['net','tls','http','https']) { const mod=require(name); for (const key of ['connect','request','get']) if (typeof mod[key]==='function') mod[key]=()=>{ throw new Error('network forbidden') }; }\n",
  );
  npm(["install", "--offline", "--ignore-scripts"], fixture);
  return fixture;
}

describe("public quickstart snippets", () => {
  it("isolates concurrent packed artifact staging", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "jev-fabric-pack-concurrent-"),
    );
    const left = join(directory, "left");
    const right = join(directory, "right");
    try {
      await Promise.all([mkdir(left), mkdir(right)]);
      await Promise.all(
        [left, right].map((artifacts) =>
          execFile(
            process.execPath,
            [packSmoke, "--artifacts-dir", artifacts],
            { cwd: root, maxBuffer: 10 * 1024 * 1024 },
          ),
        ),
      );
      for (const artifacts of [left, right]) {
        await expect(
          readFile(
            join(artifacts, "mokimeow-jev-fabric-cli-0.1.0-alpha.1.tgz"),
          ),
        ).resolves.toBeInstanceOf(Buffer);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("installs packed public artifacts offline and executes documented commands and code", async () => {
    const [readme, quickstart] = await Promise.all([
      readFile(resolve(root, "README.md"), "utf8"),
      readFile(resolve(root, "docs/quickstart/offline.md"), "utf8"),
    ]);
    expect(readme).toContain("npx --no-install jev-fabric doctor --json");
    expect(readme).toContain("npx --no-install jev-fabric evaluate --json");
    expect(quickstart).toContain(
      "console.log(result.receipt.outcome); // route",
    );
    const source = quickstart.match(/```ts\n([\s\S]*?)\n```/u)?.[1];
    expect(source).toBeTruthy();
    const directory = await installPackedFixture();
    try {
      const doctor = npm(
        [
          "exec",
          "--offline",
          "--yes=false",
          "--",
          "jev-fabric",
          "doctor",
          "--json",
        ],
        directory,
      );
      expect(JSON.parse(doctor) as { network: string }).toMatchObject({
        network: "not_used",
      });
      const evaluation = npm(
        [
          "exec",
          "--offline",
          "--yes=false",
          "--",
          "jev-fabric",
          "evaluate",
          "--json",
        ],
        directory,
      );
      expect(JSON.parse(evaluation) as { mode: string }).toMatchObject({
        mode: "offline",
      });
      const script = join(directory, "quickstart.mjs");
      await writeFile(script, `${source}\n`);
      const output = execFileSync(
        process.execPath,
        ["--require", join(directory, "network-trap.cjs"), script],
        { cwd: directory, encoding: "utf8" },
      );
      expect(output).toBe("route\n");
    } finally {
      await rm(resolve(directory, "..", ".."), {
        recursive: true,
        force: true,
      });
    }
  }, 60_000);
});
