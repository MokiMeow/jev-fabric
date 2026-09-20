import { types as nodeTypes } from "node:util";
import { canonicalJson, sha256 } from "../lib/canonical.mjs";

export const FINANCE_VISUAL_MUTATIONS = [
  "faithful_render",
  "missing_source_date",
  "missing_units",
  "swapped_series_legend",
  "reversed_time_axis",
  "undisclosed_log_scale",
  "truncated_zero_baseline",
] as const;

export type FinanceVisualMutation = (typeof FINANCE_VISUAL_MUTATIONS)[number];
export type FinanceVisualRoute = "observe" | "investigate" | "escalate";

export const FINANCE_VISUAL_MUTATION_ROUTES = Object.freeze({
  faithful_render: "observe",
  missing_source_date: "investigate",
  missing_units: "investigate",
  swapped_series_legend: "escalate",
  reversed_time_axis: "escalate",
  undisclosed_log_scale: "escalate",
  truncated_zero_baseline: "escalate",
} as const satisfies Record<FinanceVisualMutation, FinanceVisualRoute>);

export const FINANCE_CHART_RENDERER_V1 = Object.freeze({
  id: "finance.canonical-svg",
  version: "1",
  schemaVersion: "1",
  mutationPolicyId: "finance.visual-mutations.v1",
} as const);

export const FINANCE_CHART_RENDERER_V2 = Object.freeze({
  id: "finance.canonical-svg",
  version: "2",
  schemaVersion: "1",
  mutationPolicyId: "finance.visual-mutations.v2",
} as const);

export const FINANCE_CHART_RENDERER = Object.freeze({
  id: "finance.canonical-svg",
  version: "3",
  schemaVersion: "1",
  mutationPolicyId: "finance.visual-mutations.v3",
} as const);

export type FinanceChartRenderer =
  | typeof FINANCE_CHART_RENDERER_V1
  | typeof FINANCE_CHART_RENDERER_V2
  | typeof FINANCE_CHART_RENDERER;

export interface RenderedFinanceChart {
  readonly schemaVersion: "1";
  readonly mutationId: FinanceVisualMutation;
  readonly expectedRoute: FinanceVisualRoute;
  /** Exact canonical UTF-8 SVG text. It always ends in one LF. */
  readonly svg: string;
  readonly imageHash: string;
  readonly sourceBindingHash: string;
  /** Seals the renderer, policy, source, image, mutation, and expected route. */
  readonly artifactBindingHash: string;
  readonly renderer: FinanceChartRenderer;
  readonly axisBounds: Readonly<{
    minimum: number;
    maximum: number;
    includesZero: boolean;
  }>;
  readonly untrustedAnnotations: readonly string[];
}

interface Point {
  readonly timestamp: string;
  readonly epochMs: number;
  readonly value: number;
}

interface Series {
  readonly id: string;
  readonly label: string;
  readonly points: readonly Point[];
}

interface NormalizedChart {
  readonly title: string;
  readonly axis: Readonly<{
    xLabel: string;
    yLabel: string;
    units: string;
    zeroBaseline: true;
  }>;
  readonly source: Readonly<{
    id: string;
    title: string;
    publisher: string;
    url: string;
    date: string;
    sha256: string;
  }>;
  readonly series: readonly Series[];
  readonly mutationId: FinanceVisualMutation;
  readonly annotations: readonly string[];
}

const WIDTH = 960;
const HEIGHT = 540;
const PLOT_LEFT = 84;
const PLOT_RIGHT = 926;
const PLOT_TOP = 82;
const PLOT_BOTTOM = 430;
const MAX_SERIES = 8;
const MAX_POINTS_PER_SERIES = 512;
const MAX_TOTAL_POINTS = 2_048;
const MAX_ANNOTATIONS = 8;
const MAX_ABSOLUTE_VALUE = 1_000_000_000_000;
const MIN_NONZERO_VALUE = 1e-12;
const PALETTE = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#7c3aed",
  "#d97706",
  "#0891b2",
  "#db2777",
  "#4b5563",
] as const;
const identifierPattern = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const canonicalTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const utf8Encoder = new TextEncoder();

/**
 * Compiles already-structured finance data into inert, byte-stable SVG.
 * The input is treated as untrusted data and is never executed or fetched.
 */
export function renderFinanceChart(input: unknown): RenderedFinanceChart {
  return renderFinanceChartWithRenderer(input, FINANCE_CHART_RENDERER);
}

/** Rebuilds retained renderer-v1 artifacts without granting v1 new mutations. */
export function renderFinanceChartV1(input: unknown): RenderedFinanceChart {
  return renderFinanceChartWithRenderer(input, FINANCE_CHART_RENDERER_V1);
}

/** Rebuilds retained renderer-v2 artifacts without granting v2 new mutations. */
export function renderFinanceChartV2(input: unknown): RenderedFinanceChart {
  return renderFinanceChartWithRenderer(input, FINANCE_CHART_RENDERER_V2);
}

function renderFinanceChartWithRenderer(
  input: unknown,
  renderer: FinanceChartRenderer,
): RenderedFinanceChart {
  const chart = normalizeChart(input);
  validateMutationApplicability(chart);
  if (
    renderer.version === "1" &&
    (chart.mutationId === "reversed_time_axis" ||
      chart.mutationId === "undisclosed_log_scale")
  )
    throw new TypeError(
      `${chart.mutationId} requires a newer finance canonical SVG renderer`,
    );
  if (renderer.version === "2" && chart.mutationId === "undisclosed_log_scale")
    throw new TypeError(
      "undisclosed_log_scale requires finance canonical SVG renderer v3",
    );

  const values = chart.series.flatMap((series) =>
    series.points.map((point) => point.value),
  );
  const bounds = computeAxisBounds(values, chart.mutationId);
  const sourceBindingHash = sha256(canonicalJson(sourceBinding(chart)));
  const svg = renderSvg(chart, bounds);
  const imageHash = sha256(svg);
  const expectedRoute = FINANCE_VISUAL_MUTATION_ROUTES[chart.mutationId];
  const artifactBindingHash = sha256(
    canonicalJson({
      schemaVersion: "1",
      renderer,
      sourceBindingHash,
      imageHash,
      mutationId: chart.mutationId,
      expectedRoute,
    }),
  );
  const untrustedAnnotations = Object.freeze([...chart.annotations]);

  return Object.freeze({
    schemaVersion: "1",
    mutationId: chart.mutationId,
    expectedRoute,
    svg,
    imageHash,
    sourceBindingHash,
    artifactBindingHash,
    renderer,
    axisBounds: Object.freeze({
      minimum: bounds.minimum,
      maximum: bounds.maximum,
      includesZero: bounds.minimum <= 0 && bounds.maximum >= 0,
    }),
    untrustedAnnotations,
  });
}

function normalizeChart(input: unknown): NormalizedChart {
  const root = strictRecord(input, "chart");
  assertExactKeys(
    root,
    ["schemaVersion", "title", "axis", "source", "series", "mutationId"],
    ["annotations"],
    "chart",
  );
  if (root.schemaVersion !== "1")
    throw new TypeError('chart.schemaVersion must equal "1"');

  const axisInput = strictRecord(root.axis, "chart.axis");
  assertExactKeys(
    axisInput,
    ["xLabel", "yLabel", "units", "zeroBaseline"],
    [],
    "chart.axis",
  );
  if (axisInput.zeroBaseline !== true)
    throw new TypeError("chart.axis.zeroBaseline must be true");

  const sourceInput = strictRecord(root.source, "chart.source");
  assertExactKeys(
    sourceInput,
    ["id", "title", "publisher", "url", "date", "sha256"],
    [],
    "chart.source",
  );
  const sourceId = boundedIdentifier(sourceInput.id, "chart.source.id");
  const sourceHash = boundedHash(sourceInput.sha256, "chart.source.sha256");
  const sourceUrl = canonicalHttpsUrl(sourceInput.url, "chart.source.url");
  const sourceDate = canonicalDate(sourceInput.date, "chart.source.date");

  const seriesInput = strictArray(root.series, "chart.series", 1, MAX_SERIES);
  const series = seriesInput.map((value, index) =>
    normalizeSeries(value, `chart.series[${index}]`),
  );
  series.sort((left, right) => compareAscii(left.id, right.id));
  assertUnique(
    series.map((entry) => entry.id),
    "chart series id",
  );
  assertUnique(
    series.map((entry) => entry.label),
    "chart series label",
  );
  const totalPoints = series.reduce(
    (sum, entry) => sum + entry.points.length,
    0,
  );
  if (totalPoints > MAX_TOTAL_POINTS)
    throw new TypeError(`chart exceeds ${MAX_TOTAL_POINTS} total points`);
  for (const entry of series) {
    for (const point of entry.points) {
      if (point.timestamp.slice(0, 10) > sourceDate)
        throw new TypeError(
          "chart point date must not exceed chart.source.date snapshot cutoff",
        );
    }
  }
  assertSafeNumericRange(series);

  const mutationId = mutation(root.mutationId);
  const annotations =
    root.annotations === undefined
      ? []
      : strictArray(
          root.annotations,
          "chart.annotations",
          0,
          MAX_ANNOTATIONS,
        ).map((value, index) =>
          boundedText(value, `chart.annotations[${index}]`, 160, true),
        );

  return Object.freeze({
    title: boundedText(root.title, "chart.title", 160),
    axis: Object.freeze({
      xLabel: boundedText(axisInput.xLabel, "chart.axis.xLabel", 80),
      yLabel: boundedText(axisInput.yLabel, "chart.axis.yLabel", 80),
      units: boundedText(axisInput.units, "chart.axis.units", 40),
      zeroBaseline: true,
    }),
    source: Object.freeze({
      id: sourceId,
      title: boundedText(sourceInput.title, "chart.source.title", 160),
      publisher: boundedText(
        sourceInput.publisher,
        "chart.source.publisher",
        100,
      ),
      url: sourceUrl,
      date: sourceDate,
      sha256: sourceHash,
    }),
    series: Object.freeze(series),
    mutationId,
    annotations: Object.freeze(annotations),
  });
}

function normalizeSeries(value: unknown, field: string): Series {
  const input = strictRecord(value, field);
  assertExactKeys(input, ["id", "label", "points"], [], field);
  const pointsInput = strictArray(
    input.points,
    `${field}.points`,
    2,
    MAX_POINTS_PER_SERIES,
  );
  let previousEpoch = -1;
  const points = pointsInput.map((entry, index) => {
    const pointField = `${field}.points[${index}]`;
    const pointInput = strictRecord(entry, pointField);
    assertExactKeys(pointInput, ["timestamp", "value"], [], pointField);
    const timestamp = canonicalTimestamp(
      pointInput.timestamp,
      `${pointField}.timestamp`,
    );
    const epochMs = Date.parse(timestamp);
    if (epochMs <= previousEpoch)
      throw new TypeError(`${field}.points timestamps must be strictly sorted`);
    previousEpoch = epochMs;
    const numericValue = finiteValue(pointInput.value, `${pointField}.value`);
    return Object.freeze({ timestamp, epochMs, value: numericValue });
  });
  return Object.freeze({
    id: boundedIdentifier(input.id, `${field}.id`),
    label: boundedText(input.label, `${field}.label`, 80),
    points: Object.freeze(points),
  });
}

function sourceBinding(chart: NormalizedChart): Record<string, unknown> {
  return {
    schemaVersion: "1",
    title: chart.title,
    axis: chart.axis,
    source: chart.source,
    series: chart.series.map((series) => ({
      id: series.id,
      label: series.label,
      points: series.points.map((point) => ({
        timestamp: point.timestamp,
        value: point.value,
      })),
    })),
    untrustedAnnotations: chart.annotations,
  };
}

function validateMutationApplicability(chart: NormalizedChart): void {
  if (chart.mutationId === "swapped_series_legend" && chart.series.length < 2)
    throw new TypeError("swapped_series_legend requires at least two series");
  if (
    (chart.mutationId === "truncated_zero_baseline" ||
      chart.mutationId === "undisclosed_log_scale") &&
    chart.series.some((series) =>
      series.points.some((point) => point.value <= 0),
    )
  )
    throw new TypeError(
      `${chart.mutationId} requires strictly positive source values`,
    );
}

function assertSafeNumericRange(series: readonly Series[]): void {
  const values = series.flatMap((entry) =>
    entry.points.map((point) => point.value),
  );
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) return;
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
  if (maximum - minimum < magnitude * 1e-12)
    throw new TypeError("chart values form an unsafe numeric range");
}

function computeAxisBounds(
  values: readonly number[],
  mutationId: FinanceVisualMutation,
): { readonly minimum: number; readonly maximum: number } {
  const dataMinimum = Math.min(...values);
  const dataMaximum = Math.max(...values);
  let minimum: number;
  let maximum: number;

  if (mutationId === "truncated_zero_baseline") {
    const span = dataMaximum - dataMinimum;
    const padding =
      span > 0 ? span * 0.08 : Math.max(dataMinimum * 0.1, MIN_NONZERO_VALUE);
    const candidate = dataMinimum - padding;
    minimum = candidate > 0 ? candidate : dataMinimum * 0.9;
    maximum = dataMaximum + padding;
  } else {
    minimum = Math.min(0, dataMinimum);
    maximum = Math.max(0, dataMaximum);
    if (minimum === maximum) maximum = 1;
    const span = maximum - minimum;
    if (minimum < 0) minimum -= span * 0.05;
    if (maximum > 0) maximum += span * 0.05;
  }

  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    maximum <= minimum
  )
    throw new TypeError("computed chart axis is unsafe");
  return Object.freeze({ minimum, maximum });
}

function renderSvg(
  chart: NormalizedChart,
  bounds: { readonly minimum: number; readonly maximum: number },
): string {
  const allPoints = chart.series.flatMap((series) => series.points);
  const xMinimum = Math.min(...allPoints.map((point) => point.epochMs));
  const xMaximum = Math.max(...allPoints.map((point) => point.epochMs));
  if (xMaximum <= xMinimum)
    throw new TypeError("chart timestamps must span a non-zero range");

  const x = (epochMs: number) => {
    const fraction = (epochMs - xMinimum) / (xMaximum - xMinimum);
    return chart.mutationId === "reversed_time_axis"
      ? PLOT_RIGHT - fraction * (PLOT_RIGHT - PLOT_LEFT)
      : PLOT_LEFT + fraction * (PLOT_RIGHT - PLOT_LEFT);
  };
  const y = (value: number) => {
    const span = bounds.maximum - bounds.minimum;
    const fraction =
      chart.mutationId === "undisclosed_log_scale"
        ? Math.log1p(value - bounds.minimum) / Math.log1p(span)
        : (value - bounds.minimum) / span;
    return PLOT_BOTTOM - fraction * (PLOT_BOTTOM - PLOT_TOP);
  };

  const legendLabels = chart.series.map((series) => series.label);
  if (chart.mutationId === "swapped_series_legend") {
    const first = legendLabels[0];
    const second = legendLabels[1];
    if (first === undefined || second === undefined)
      throw new TypeError("swapped legend is missing series labels");
    legendLabels[0] = second;
    legendLabels[1] = first;
  }

  const yLabel =
    chart.mutationId === "missing_units"
      ? chart.axis.yLabel
      : `${chart.axis.yLabel} (${chart.axis.units})`;
  const sourceLabel =
    chart.mutationId === "missing_source_date"
      ? `Source: ${chart.source.publisher} — ${chart.source.title}`
      : `Source: ${chart.source.publisher} — ${chart.source.title} — ${chart.source.date}`;

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="chart-title chart-description">`,
    `  <title id="chart-title">${xml(chart.title)}</title>`,
    `  <desc id="chart-description">Static finance chart with ${chart.series.length} series and ${allPoints.length} source-bound points.</desc>`,
    `  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`,
    `  <text x="${PLOT_LEFT}" y="38" fill="#111827" font-family="sans-serif" font-size="22" font-weight="700">${xml(chart.title)}</text>`,
  ];

  for (let index = 0; index <= 4; index += 1) {
    const fraction = index / 4;
    const coordinate = PLOT_BOTTOM - fraction * (PLOT_BOTTOM - PLOT_TOP);
    const value = bounds.minimum + fraction * (bounds.maximum - bounds.minimum);
    lines.push(
      `  <line x1="${PLOT_LEFT}" y1="${decimal(coordinate)}" x2="${PLOT_RIGHT}" y2="${decimal(coordinate)}" stroke="#e5e7eb" stroke-width="1"/>`,
      `  <text x="${PLOT_LEFT - 10}" y="${decimal(coordinate + 4)}" text-anchor="end" fill="#4b5563" font-family="sans-serif" font-size="12">${xml(numberLabel(value))}</text>`,
    );
  }

  const xTickCount = 5;
  for (let index = 0; index < xTickCount; index += 1) {
    const fraction = index / (xTickCount - 1);
    const epochMs = Math.round(
      chart.mutationId === "reversed_time_axis"
        ? xMaximum - fraction * (xMaximum - xMinimum)
        : xMinimum + fraction * (xMaximum - xMinimum),
    );
    const coordinate = PLOT_LEFT + fraction * (PLOT_RIGHT - PLOT_LEFT);
    lines.push(
      `  <line x1="${decimal(coordinate)}" y1="${PLOT_BOTTOM}" x2="${decimal(coordinate)}" y2="${PLOT_BOTTOM + 5}" stroke="#374151" stroke-width="1"/>`,
      `  <text x="${decimal(coordinate)}" y="${PLOT_BOTTOM + 22}" text-anchor="middle" fill="#4b5563" font-family="sans-serif" font-size="11">${dateLabel(epochMs)}</text>`,
    );
  }

  lines.push(
    `  <line x1="${PLOT_LEFT}" y1="${PLOT_TOP}" x2="${PLOT_LEFT}" y2="${PLOT_BOTTOM}" stroke="#374151" stroke-width="1.5"/>`,
    `  <line x1="${PLOT_LEFT}" y1="${PLOT_BOTTOM}" x2="${PLOT_RIGHT}" y2="${PLOT_BOTTOM}" stroke="#374151" stroke-width="1.5"/>`,
    `  <text x="${(PLOT_LEFT + PLOT_RIGHT) / 2}" y="478" text-anchor="middle" fill="#111827" font-family="sans-serif" font-size="13">${xml(chart.axis.xLabel)}</text>`,
    `  <text x="22" y="${(PLOT_TOP + PLOT_BOTTOM) / 2}" text-anchor="middle" transform="rotate(-90 22 ${(PLOT_TOP + PLOT_BOTTOM) / 2})" fill="#111827" font-family="sans-serif" font-size="13">${xml(yLabel)}</text>`,
  );

  chart.series.forEach((series, index) => {
    const color = PALETTE[index];
    if (color === undefined) throw new TypeError("chart palette is exhausted");
    const path = series.points
      .map(
        (point, pointIndex) =>
          `${pointIndex === 0 ? "M" : "L"}${decimal(x(point.epochMs))} ${decimal(y(point.value))}`,
      )
      .join(" ");
    lines.push(
      `  <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  });

  chart.series.forEach((_series, index) => {
    const color = PALETTE[index];
    const label = legendLabels[index];
    if (color === undefined || label === undefined)
      throw new TypeError("chart legend is incomplete");
    const xPosition = PLOT_LEFT + index * 104;
    lines.push(
      `  <line x1="${xPosition}" y1="60" x2="${xPosition + 20}" y2="60" stroke="${color}" stroke-width="3"/>`,
      `  <text x="${xPosition + 26}" y="64" fill="#374151" font-family="sans-serif" font-size="11">${xml(label)}</text>`,
    );
  });

  lines.push(
    `  <text x="${PLOT_LEFT}" y="516" fill="#6b7280" font-family="sans-serif" font-size="11">${xml(sourceLabel)}</text>`,
    "</svg>",
  );
  return `${lines.join("\n")}\n`;
}

function strictRecord(value: unknown, field: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    nodeTypes.isProxy(value)
  )
    throw new TypeError(`${field} must be a non-proxy plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${field} must have a plain prototype`);
  if (Object.getOwnPropertySymbols(value).length !== 0)
    throw new TypeError(`${field} must not contain symbol properties`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable)
      throw new TypeError(`${field}.${key} must be enumerable plain data`);
    result[key] = descriptor.value;
  }
  return result;
}

function strictArray(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    nodeTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  )
    throw new TypeError(`${field} must be a non-proxy plain array`);
  if (value.length < minimum || value.length > maximum)
    throw new TypeError(`${field} must contain ${minimum} to ${maximum} items`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      throw new TypeError(`${field}[${index}] must be enumerable plain data`);
    result.push(descriptor.value);
  }
  const expectedKeys = new Set([
    "length",
    ...result.map((_, index) => String(index)),
  ]);
  if (Object.keys(descriptors).some((key) => !expectedKeys.has(key)))
    throw new TypeError(`${field} must not contain extra properties`);
  return result;
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  field: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new TypeError(`${field} has unknown key: ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key))
      throw new TypeError(`${field} is missing ${key}`);
  }
}

function boundedText(
  value: unknown,
  field: string,
  maximumBytes: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string") throw new TypeError(`${field} must be text`);
  if (
    (!allowEmpty && value.length === 0) ||
    value !== value.normalize("NFC") ||
    !value.isWellFormed() ||
    hasForbiddenTextCodePoint(value) ||
    utf8Encoder.encode(value).byteLength > maximumBytes
  )
    throw new TypeError(`${field} must be bounded canonical display text`);
  return value;
}

function boundedIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value))
    throw new TypeError(`${field} must be a bounded identifier`);
  return value;
}

function boundedHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !hashPattern.test(value))
    throw new TypeError(`${field} must be a lowercase sha256 digest`);
  return value;
}

function canonicalHttpsUrl(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new TypeError(`${field} must be an HTTPS URL`);
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError(`${field} must be an absolute URL`, { cause: error });
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname === "" ||
    url.toString() !== value
  )
    throw new TypeError(`${field} must be credential-free canonical HTTPS`);
  return value;
}

function canonicalDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !datePattern.test(value))
    throw new TypeError(`${field} must be a canonical date`);
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  )
    throw new TypeError(`${field} must be a real canonical date`);
  return value;
}

function canonicalTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !canonicalTimestampPattern.test(value))
    throw new TypeError(`${field} must be a canonical UTC timestamp`);
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  )
    throw new TypeError(`${field} must be a real canonical UTC timestamp`);
  return value;
}

function finiteValue(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_ABSOLUTE_VALUE ||
    (value !== 0 && Math.abs(value) < MIN_NONZERO_VALUE)
  )
    throw new TypeError(`${field} must be a finite bounded number`);
  return Object.is(value, -0) ? 0 : value;
}

function mutation(value: unknown): FinanceVisualMutation {
  if (
    typeof value !== "string" ||
    !FINANCE_VISUAL_MUTATIONS.includes(value as FinanceVisualMutation)
  )
    throw new TypeError("chart.mutationId is not a declared visual mutation");
  return value as FinanceVisualMutation;
}

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length)
    throw new TypeError(`${field} values must be unique`);
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function decimal(value: number): string {
  const rounded = Math.abs(value) < 0.0005 ? 0 : value;
  return rounded
    .toFixed(3)
    .replace(/\.0+$/u, "")
    .replace(/(\.\d*?)0+$/u, "$1");
}

function numberLabel(value: number): string {
  const normalized = Math.abs(value) < 1e-12 ? 0 : value;
  if (normalized === 0) return "0";
  const absolute = Math.abs(normalized);
  if (absolute >= 1_000_000_000 || absolute < 0.001)
    return normalized
      .toExponential(3)
      .replace(/\.0+e/u, "e")
      .replace(/(\.\d*?)0+e/u, "$1e");
  return Number(normalized.toPrecision(8)).toString();
}

function dateLabel(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function hasForbiddenTextCodePoint(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    )
      return true;
  }
  return false;
}
