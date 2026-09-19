import type { BootstrapInterval } from "./bootstrap.js";
import { codeUnitCompare, type EvidenceLabel } from "./manifest.js";
const markdownCharacters = new Set("-\\`*_{}[]<>()#+.!|");
export function escapeMarkdown(value: string): string {
  return [...value]
    .map((character) =>
      markdownCharacters.has(character) ? `\\${character}` : character,
    )
    .join("")
    .replace(/[\r\n]+/g, " ");
}
export interface ReportInput {
  readonly title: string;
  readonly runId?: string;
  readonly environmentId?: string;
  readonly versions?: Readonly<Record<string, string>>;
  readonly denominators?: Readonly<Record<string, number>>;
  readonly independentGroups?: number;
  readonly prevalence?: Readonly<Record<string, number>>;
  readonly invalidResponses?: number;
  readonly abstentions?: number;
  readonly intervals?: Readonly<Record<string, BootstrapInterval>>;
  readonly limitations?: readonly string[];
  readonly evidence: EvidenceLabel;
  readonly metrics: Readonly<Record<string, number | null>>;
  readonly note?: string;
}
function bulletRows(values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values)
    .sort(([left], [right]) => codeUnitCompare(left, right))
    .map(
      ([key, value]) =>
        `- ${escapeMarkdown(key)}: ${escapeMarkdown(String(value))}`,
    )
    .join("\n");
}
export function renderReport(input: ReportInput): string {
  const rows = Object.entries(input.metrics)
    .sort(([a], [b]) => codeUnitCompare(a, b))
    .map(
      ([name, value]) =>
        `| ${escapeMarkdown(name)} | ${value === null ? "NA / NOT RUN" : String(value)} |`,
    )
    .join("\n");
  const metadata = [
    input.runId && `Run: \`${escapeMarkdown(input.runId)}\``,
    input.environmentId &&
      `Environment: \`${escapeMarkdown(input.environmentId)}\``,
  ]
    .filter(Boolean)
    .join("\n");
  const denominatorRows = Object.entries(input.denominators ?? {})
    .sort(([a], [b]) => codeUnitCompare(a, b))
    .map(([key, value]) => `- ${escapeMarkdown(key)}: ${value}`)
    .join("\n");
  const versionRows = input.versions ? bulletRows(input.versions) : "";
  const prevalenceRows = input.prevalence ? bulletRows(input.prevalence) : "";
  const outcomeCounts = bulletRows({
    ...(input.independentGroups === undefined
      ? {}
      : { "independent groups": input.independentGroups }),
    ...(input.invalidResponses === undefined
      ? {}
      : { "invalid responses": input.invalidResponses }),
    ...(input.abstentions === undefined
      ? {}
      : { abstentions: input.abstentions }),
  });
  const intervalRows = Object.entries(input.intervals ?? {})
    .sort(([left], [right]) => codeUnitCompare(left, right))
    .map(
      ([key, value]) =>
        `- ${escapeMarkdown(key)}: ${value.lower ?? "NA / NOT RUN"} to ${value.upper ?? "NA / NOT RUN"} (${value.method}, seed ${value.seed}, ${value.replicates} replicates, ${value.groups} groups)`,
    )
    .join("\n");
  const limits = (input.limitations ?? [])
    .map((value) => `- ${escapeMarkdown(value)}`)
    .join("\n");
  return `# ${escapeMarkdown(input.title)}\n\nEvidence: \`${input.evidence}\`\n${metadata ? `\n${metadata}\n` : ""}\n| Metric | Value |\n| --- | --- |\n${rows}\n${versionRows ? `\n## Versions\n\n${versionRows}\n` : ""}${denominatorRows ? `\n## Denominators\n\n${denominatorRows}\n` : ""}${outcomeCounts ? `\n## Outcome accounting\n\n${outcomeCounts}\n` : ""}${prevalenceRows ? `\n## Class prevalence\n\n${prevalenceRows}\n` : ""}${intervalRows ? `\n## Cluster-percentile intervals\n\n${intervalRows}\n` : ""}${limits ? `\n## Limitations\n\n${limits}\n` : ""}${input.note === undefined ? "" : `\nCorrection: ${escapeMarkdown(input.note)}\n`}`;
}
