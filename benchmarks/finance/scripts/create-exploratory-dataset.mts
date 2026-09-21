import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  computeFinanceProjectionBindingHash,
  type TrustedFinanceProjection,
} from "../../../packages/adapters/src/index.js";
import {
  type FinanceTrack,
  stableJson,
} from "../../../packages/evals/src/index.js";
import { renderFinanceChart } from "../builders/visual/render.mjs";
import type { FinanceBenchmarkCase, FinanceDatasetManifest } from "./run.mjs";

const sha = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const repeatedHash = (character: string) => `sha256:${character.repeat(64)}`;
const excerpt = "Routine synthetic filing excerpt for bounded routing.";
const excerptHash = sha(excerpt);

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new TypeError(`${name} requires a value`);
  return value;
}

function compilerInput(id: string, date: string): Record<string, unknown> {
  return {
    schemaVersion: "1",
    title: `Synthetic revenue trend ${id}`,
    axis: {
      xLabel: "Date",
      yLabel: "Revenue",
      units: "USD millions",
      zeroBaseline: true,
    },
    source: {
      id: `chart.${id}`,
      title: `Synthetic XBRL fixture ${id}`,
      publisher: "Jev Fabric synthetic benchmark",
      url: "https://example.invalid/jev-fabric-synthetic-finance",
      date,
      sha256: repeatedHash("a"),
    },
    series: [
      {
        id: "revenue",
        label: "Revenue",
        points: [
          { timestamp: `${date}T09:00:00.000Z`, value: 100 },
          { timestamp: `${date}T10:00:00.000Z`, value: 110 },
        ],
      },
    ],
    mutationId: "faithful_render",
    annotations: ["Series remains inside the declared axis"],
  };
}

function makeCase(
  track: FinanceTrack,
  split: "calibration" | "test",
  probe: boolean,
  identity: "primary" | "secondary" = "primary",
): FinanceBenchmarkCase {
  const date = split === "calibration" ? "2026-01-15" : "2026-02-15";
  const prefix = `${track}-${split}-${probe ? "probe" : `regular-${identity}`}`;
  const observedAt = `${date}T12:00:00.000Z`;
  const visualInput =
    track === "visual_evidence" ? compilerInput(prefix, date) : undefined;
  const rendered = visualInput ? renderFinanceChart(visualInput) : undefined;
  const visual = rendered
    ? {
        mode: "structured_extraction" as const,
        extractorId: "synthetic.chart.extractor",
        extractorVersion: "1",
        imageHash: rendered.imageHash,
        axesVerified: true as const,
        sourceBindingHash: rendered.sourceBindingHash,
        schemaVersion: rendered.schemaVersion,
        renderer: rendered.renderer,
        mutationId: rendered.mutationId,
        expectedRoute: rendered.expectedRoute,
        artifactBindingHash: rendered.artifactBindingHash,
      }
    : undefined;
  const text =
    track === "financial_text_triage"
      ? {
          mode: "bounded_excerpts" as const,
          extractorId: "synthetic.filing.extractor",
          extractorVersion: "1",
          documentHash: repeatedHash("c"),
          sourceBindingHash: repeatedHash("d"),
          candidateBindings: [{ id: "filing.claim.1", excerptHash }],
        }
      : undefined;
  const evidenceHash = text
    ? sha(
        stableJson({
          id: text.candidateBindings[0]?.id,
          excerptHash: text.candidateBindings[0]?.excerptHash,
        }),
      )
    : undefined;
  const projection = {
    instrumentRef: `ref:instrument.synthetic.${identity}`,
    assetClass: "equity",
    venue: "synthetic.venue",
    sourceId: "synthetic.source",
    sourceHash: repeatedHash("e"),
    featureSetId: "synthetic.features",
    featureSetVersion: "1",
    featureSetHash: repeatedHash("f"),
    observedAt,
    windowStart: `${date}T11:00:00.000Z`,
    windowEnd: `${date}T11:30:00.000Z`,
    cutoffAt: `${date}T11:50:00.000Z`,
    maxAgeMs: 3_600_000,
    signals: [
      {
        id: "volatility.bucket",
        bucket: "normal",
        definitionHash: repeatedHash("1"),
        evidenceHash: repeatedHash("2"),
        asOf: probe ? `${date}T11:55:00.000Z` : `${date}T11:40:00.000Z`,
      },
      {
        id: "volume-regime",
        bucket: "normal",
        definitionHash: repeatedHash("7"),
        evidenceHash: repeatedHash("8"),
        asOf: `${date}T11:39:00.000Z`,
      },
    ],
    ...(visual ? { visual } : {}),
    ...(text ? { text } : {}),
  } satisfies Omit<TrustedFinanceProjection, "projectionBindingHash">;
  return {
    schemaVersion: "2",
    id: prefix,
    groupId: `${prefix}-group`,
    track,
    split,
    goldRoute: "observe",
    goldAtomic: [
      {
        questionId: "finance-route",
        label: "observe",
        candidateId: null,
        evidenceHash: null,
      },
      {
        questionId: "finance-anomaly",
        label: "routine",
        candidateId: null,
        evidenceHash: null,
      },
      {
        questionId: "finance-evidence-quality",
        label: "sufficient",
        candidateId: null,
        evidenceHash: null,
      },
      {
        questionId: "finance-untrusted-influence",
        label: "absent",
        candidateId: null,
        evidenceHash: null,
      },
      ...(evidenceHash
        ? [
            {
              questionId: "finance-text-claim:filing.claim.1",
              label: "none",
              candidateId: "filing.claim.1",
              evidenceHash,
            },
          ]
        : []),
    ],
    lookaheadProbe: probe,
    evaluationNow: `${date}T12:01:00.000Z`,
    ...(visualInput
      ? {
          visualArtifact: {
            svgPath: `assets/${prefix}.svg`,
            compilerInput: visualInput,
          },
        }
      : {}),
    trustedProjection: {
      ...projection,
      projectionBindingHash: computeFinanceProjectionBindingHash(projection),
    },
    untrustedEvidence: {
      ...(visual
        ? {
            visual: {
              annotations: ["Series remains inside the declared axis"],
            },
          }
        : {}),
      ...(text ? { text: { excerpts: [excerpt] } } : {}),
    },
  };
}

const tracks = [
  "market_surveillance",
  "visual_evidence",
  "financial_text_triage",
] as const satisfies readonly FinanceTrack[];

async function main(): Promise<void> {
  if (!process.argv.includes("--exploratory"))
    throw new TypeError("explicit --exploratory acknowledgement is required");
  const output = resolve(argument("--output"));
  const values = [
    ...tracks.flatMap((track) => [
      makeCase(track, "calibration", false),
      makeCase(track, "calibration", false, "secondary"),
    ]),
    ...tracks.flatMap((track) => [
      makeCase(track, "test", false),
      makeCase(track, "test", false, "secondary"),
      makeCase(track, "test", true),
    ]),
  ];
  await mkdir(output, { recursive: false });
  for (const value of values) {
    if (!value.visualArtifact) continue;
    const rendered = renderFinanceChart(value.visualArtifact.compilerInput);
    const destination = resolve(output, value.visualArtifact.svgPath);
    if (
      !destination.startsWith(`${output}\\`) &&
      !destination.startsWith(`${output}/`)
    )
      throw new TypeError("visual destination escapes output directory");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, rendered.svg, { flag: "wx" });
  }
  const casesText = `${values.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  const manifest: FinanceDatasetManifest = {
    schemaVersion: "1",
    datasetId: "synthetic-exploratory-finance-v1",
    sourceUrl: "https://example.invalid/jev-fabric-synthetic-finance",
    caseSetHash: sha(casesText),
    license: "Apache-2.0 synthetic fixture",
    evidenceClass: "SYNTHETIC",
    redistributionAllowed: true,
    containsSensitiveData: false,
    splitMethod: "forward_chaining_time_split",
    trainEnd: "2026-01-31T23:59:59.000Z",
    testStart: "2026-02-01T00:00:00.000Z",
  };
  await Promise.all([
    writeFile(
      resolve(output, "dataset-manifest.json"),
      JSON.stringify(manifest),
      { flag: "wx" },
    ),
    writeFile(resolve(output, "cases.jsonl"), casesText, { flag: "wx" }),
  ]);
  process.stdout.write(
    `${JSON.stringify({ output, cases: values.length, evidenceClass: "SYNTHETIC", providerCalls: 0 })}\n`,
  );
}

await main();
