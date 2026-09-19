import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["index.ts"],
  dts: true,
  format: ["esm"],
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  clean: true,
  sourcemap: true,
});
