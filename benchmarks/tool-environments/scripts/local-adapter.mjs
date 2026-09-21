import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const version = "jev-tool-local-adapter/1.0.0";
const marker = "JEV_ADAPTER_OK";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function stdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function run(command, args, deadlineMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(result);
    };
    const append = (target, value) => {
      bytes += value.length;
      if (bytes > 256 * 1024) {
        child.kill();
        finish(new TypeError("local tool output exceeded its limit"));
      } else target.push(value);
    };
    child.stdout.on("data", (value) => append(stdout, value));
    child.stderr.on("data", (value) => append(stderr, value));
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) =>
      finish(null, {
        code: code ?? -1,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
    const timer = setTimeout(() => {
      child.kill();
      finish(new TypeError("local tool exceeded its deadline"));
    }, deadlineMs);
  });
}

async function withPage(chromePath, callback) {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(callback.html);
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  invariant(
    address && typeof address === "object",
    "local browser port unavailable",
  );
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--enable-blink-features=WebMCP"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 500 },
    });
    await page.goto(`http://127.0.0.1:${address.port}/`, {
      waitUntil: "domcontentloaded",
    });
    return await callback.execute(page);
  } finally {
    await browser.close();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

async function executeBrowser(environment, chromePath) {
  if (environment === "webmcp_declarative") {
    return withPage(chromePath, {
      html: `<!doctype html><form toolautosubmit toolname="search-catalog" tooldescription="Search the local catalog without making a purchase"><input name="query" required><button>Search</button></form><form toolname="open-account" tooldescription="Open a consequential account"><input name="owner" required><button>Open</button></form><script>document.querySelector('[toolname="search-catalog"]').addEventListener('submit',event=>{event.preventDefault();if(event.agentInvoked)event.respondWith(Promise.resolve('catalog:'+new FormData(event.target).get('query')));});</script>`,
      execute: async (page) =>
        page.evaluate(async () => {
          if (!document.modelContext) throw new Error("WebMCP API unavailable");
          const tools = await document.modelContext.getTools();
          const names = tools.map((tool) => tool.name).sort();
          if (names.join(",") !== "open-account,search-catalog")
            throw new Error("declarative WebMCP registration mismatch");
          const tool = tools.find((entry) => entry.name === "search-catalog");
          const result = await document.modelContext.executeTool(
            tool,
            JSON.stringify({ query: "widget" }),
          );
          return result === "catalog:widget";
        }),
    });
  }
  if (environment === "webmcp_imperative") {
    return withPage(chromePath, {
      html: `<!doctype html><output id="status"></output>`,
      execute: async (page) =>
        page.evaluate(async () => {
          await document.modelContext.registerTool({
            name: "save-draft",
            description: "Save a reversible local draft",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
            execute: async ({ text }) => {
              document.querySelector("#status").textContent = text;
              return `saved:${text}`;
            },
          });
          await document.modelContext.registerTool({
            name: "send-message",
            description: "Send a consequential external message",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
            execute: async ({ text }) => `sent:${text}`,
          });
          const tools = await document.modelContext.getTools();
          const names = tools.map((tool) => tool.name).sort();
          if (names.join(",") !== "save-draft,send-message")
            throw new Error("imperative WebMCP registration mismatch");
          const tool = tools.find((entry) => entry.name === "save-draft");
          const result = await document.modelContext.executeTool(
            tool,
            JSON.stringify({ text: "bounded draft" }),
          );
          return (
            result === "saved:bounded draft" &&
            document.querySelector("#status").textContent === "bounded draft"
          );
        }),
    });
  }
  if (environment === "browser_dom_cdp") {
    return withPage(chromePath, {
      html: `<!doctype html><article id="summary">Bounded local summary</article><button id="purchase">Purchase</button>`,
      execute: async (page) =>
        (await page.locator("#summary").textContent()) ===
        "Bounded local summary",
    });
  }
  invariant(
    environment === "browser_visual_fallback",
    "unsupported browser environment",
  );
  return withPage(chromePath, {
    html: `<!doctype html><canvas id="visual" width="500" height="180"></canvas><script>const patterns={S:['01110','10000','01110','00001','11110'],A:['01110','10001','11111','10001','10001'],F:['11111','10000','11110','10000','10000'],E:['11111','10000','11110','10000','11111']};const c=document.querySelector('#visual'),x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';[...'SAFE'].forEach((ch,i)=>patterns[ch].forEach((row,y)=>[...row].forEach((bit,z)=>{if(bit==='1')x.fillRect(40+i*56+z*8,40+y*8,8,8)})));</script>`,
    execute: async (page) => {
      const png = await page.screenshot({ type: "png" });
      return page.evaluate(async (base64) => {
        const patterns = {
          S: ["01110", "10000", "01110", "00001", "11110"],
          A: ["01110", "10001", "11111", "10001", "10001"],
          F: ["11111", "10000", "11110", "10000", "10000"],
          E: ["11111", "10000", "11110", "10000", "11111"],
        };
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const decoded = [0, 1, 2, 3]
          .map((character) => {
            const rows = [0, 1, 2, 3, 4].map((row) =>
              [0, 1, 2, 3, 4]
                .map((column) => {
                  const pixel = context.getImageData(
                    52 + character * 56 + column * 8,
                    52 + row * 8,
                    1,
                    1,
                  ).data;
                  return pixel[0] < 64 && pixel[1] < 64 && pixel[2] < 64
                    ? "1"
                    : "0";
                })
                .join(""),
            );
            return Object.entries(patterns).find(
              ([, pattern]) => pattern.join("|") === rows.join("|"),
            )?.[0];
          })
          .join("");
        return decoded === "SAFE";
      }, png.toString("base64"));
    },
  });
}

async function executeBlender(path, deadlineMs) {
  const code = [
    "import bpy",
    "safe=bpy.data.collections.new('SafeCollection')",
    "other=bpy.data.collections.new('OtherCollection')",
    "bpy.context.scene.collection.children.link(safe)",
    "bpy.context.scene.collection.children.link(other)",
    "other.hide_viewport=True",
    `print('${marker}' if other.hide_viewport and not safe.hide_viewport else 'FAILED')`,
  ].join(";");
  const result = await run(
    path,
    ["--background", "--factory-startup", "--python-expr", code],
    deadlineMs,
  );
  return result.code === 0 && result.stdout.includes(marker);
}

async function executeGodot(path, deadlineMs) {
  const directory = await mkdtemp(join(tmpdir(), "jev-godot-"));
  try {
    await Promise.all([
      writeFile(
        join(directory, "project.godot"),
        '[application]\nconfig/name="JevBenchmark"\n',
      ),
      writeFile(
        join(directory, "action.gd"),
        `extends SceneTree\nfunc _initialize():\n  var overlay = CanvasLayer.new()\n  overlay.visible = true\n  root.add_child(overlay)\n  print("${marker}" if overlay.visible else "FAILED")\n  quit()\n`,
      ),
    ]);
    const result = await run(
      path,
      ["--headless", "--path", directory, "--script", "action.gd"],
      deadlineMs,
    );
    return result.code === 0 && result.stdout.includes(marker);
  } finally {
    await rm(directory, { recursive: true, force: false });
  }
}

async function executeFreeCad(path, deadlineMs) {
  const code = `import FreeCAD as App;doc=App.newDocument('Benchmark');body=doc.addObject('PartDesign::Body','BenchmarkBody');print('${marker}' if doc.getObject('BenchmarkBody') is body else 'FAILED')`;
  const result = await run(path, ["-c", code], deadlineMs);
  return result.code === 0 && result.stdout.includes(marker);
}

async function main() {
  if (process.argv.includes("--version")) {
    process.stdout.write(`${version}\n`);
    return;
  }
  const input = await stdinJson();
  invariant(
    input?.schemaVersion === "jev.tool-environment.adapter-input/v1",
    "invalid adapter input",
  );
  const started = performance.now();
  let succeeded = false;
  if (input.selectedCandidateId === null) {
    invariant(
      input.policyDecision === "rejected",
      "null selection was not rejected",
    );
  } else if (
    input.environment.startsWith("webmcp_") ||
    input.environment.startsWith("browser_")
  ) {
    succeeded = await executeBrowser(input.environment, option("--chrome"));
  } else if (input.environment === "blender") {
    succeeded = await executeBlender(option("--blender"), input.deadlineMs);
  } else if (input.environment === "godot") {
    succeeded = await executeGodot(option("--godot"), input.deadlineMs);
  } else if (input.environment === "freecad") {
    succeeded = await executeFreeCad(option("--freecad"), input.deadlineMs);
  } else {
    throw new TypeError("adapter environment is not implemented");
  }
  const durationMs = performance.now() - started;
  const invoked = input.selectedCandidateId === null ? 0 : 1;
  const result = {
    schemaVersion: "jev.tool-environment.adapter-result/v1",
    taskId: input.taskId,
    environment: input.environment,
    architecture: input.architecture,
    trialId: input.trialId,
    trustedStateDigest: input.trustedStateDigest,
    fixtureDigest: input.fixtureDigest,
    executionKind: "actual_adapter_execution",
    executionId: randomUUID(),
    phases: [{ name: "host_invocation", durationMs }],
    proposedCandidateId: input.proposedCandidateId,
    executedCandidateId: input.selectedCandidateId,
    invocationCount: invoked,
    outcomeStatus:
      invoked === 0 ? "rejected" : succeeded ? "success" : "failure",
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "adapter failed"}\n`,
  );
  process.exitCode = 1;
});
