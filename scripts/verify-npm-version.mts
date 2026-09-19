import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

const npmCommand =
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
          "--version",
        ],
      ]
    : ["npm", ["--version"]];
const raw = execFileSync(npmCommand[0], npmCommand[1], {
  encoding: "utf8",
}).trim();
const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(raw);
if (!match) throw new Error(`unparseable npm version: ${raw}`);
const [major, minor, patch] = match.slice(1).map(Number);
if (
  major === undefined ||
  minor === undefined ||
  patch === undefined ||
  major < 11 ||
  (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))
)
  throw new Error(`npm ${raw} is below the trusted-publishing minimum 11.5.1`);
