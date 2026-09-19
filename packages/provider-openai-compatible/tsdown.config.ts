import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  format: ["esm"],
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  clean: true,
  sourcemap: true,
});
