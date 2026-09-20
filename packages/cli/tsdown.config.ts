import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  dts: true,
  deps: {
    onlyBundle: ["@modelcontextprotocol/core", "@modelcontextprotocol/server"],
    dts: {
      neverBundle: [/^zod(?:\/|$)/u],
    },
  },
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  clean: true,
});
