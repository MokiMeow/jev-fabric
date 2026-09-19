import { jsonArtifact, type GeneratedHost } from "./codex.js";
import type { AdapterModel } from "./model.js";

export function generateKimiCli(model: AdapterModel): GeneratedHost {
  return jsonArtifact(model, "kimi-cli");
}
