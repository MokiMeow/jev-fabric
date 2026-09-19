import { jsonArtifact, type GeneratedHost } from "./codex.js";
import type { AdapterModel } from "./model.js";

export function generateClaudeCode(model: AdapterModel): GeneratedHost {
  return jsonArtifact(model, "claude-code");
}
