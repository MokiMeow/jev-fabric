import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { canonicalJson, sha256 } from "../../lib/canonical.mjs";
import {
  FINANCE_CHART_RENDERER,
  FINANCE_VISUAL_MUTATION_ROUTES,
  FINANCE_VISUAL_MUTATIONS,
  type FinanceVisualMutation,
  renderFinanceChart,
} from "../render.mjs";

const visualRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (character: string) => `sha256:${character.repeat(64)}`;

test("matches every declared mutation and expected route in policy", async () => {
  const policy = JSON.parse(
    await readFile(
      join(visualRoot, "..", "policies", "visual-mutations.v1.json"),
      "utf8",
    ),
  ) as {
    mutations: { id: string; route: string }[];
  };
  assert.deepEqual(
    policy.mutations.map(({ id, route }) => ({ id, route })),
    FINANCE_VISUAL_MUTATIONS.map((id) => ({
      id,
      route: FINANCE_VISUAL_MUTATION_ROUTES[id],
    })),
  );
});

test("renders all five mutations with stable source bindings and declared routes", () => {
  const results = new Map(
    FINANCE_VISUAL_MUTATIONS.map((mutationId) => {
      const result = renderFinanceChart(chart(mutationId));
      assert.equal(
        result.expectedRoute,
        FINANCE_VISUAL_MUTATION_ROUTES[mutationId],
      );
      assert.match(result.imageHash, /^sha256:[a-f0-9]{64}$/u);
      assert.match(result.sourceBindingHash, /^sha256:[a-f0-9]{64}$/u);
      assert.match(result.artifactBindingHash, /^sha256:[a-f0-9]{64}$/u);
      assert.equal(result.imageHash, sha256(result.svg));
      assert.equal(
        result.artifactBindingHash,
        sha256(
          canonicalJson({
            schemaVersion: "1",
            renderer: FINANCE_CHART_RENDERER,
            sourceBindingHash: result.sourceBindingHash,
            imageHash: result.imageHash,
            mutationId,
            expectedRoute: result.expectedRoute,
          }),
        ),
      );
      assert.ok(result.svg.endsWith("</svg>\n"));
      return [mutationId, result] as const;
    }),
  );

  assert.equal(
    new Set([...results.values()].map((value) => value.imageHash)).size,
    5,
  );
  assert.equal(
    new Set([...results.values()].map((value) => value.sourceBindingHash)).size,
    1,
  );
  assert.equal(
    new Set([...results.values()].map((value) => value.artifactBindingHash))
      .size,
    5,
  );
  assert.match(results.get("faithful_render")?.svg ?? "", /USD millions/u);
  assert.match(results.get("faithful_render")?.svg ?? "", /2024-08-01/u);
  assert.doesNotMatch(results.get("missing_units")?.svg ?? "", /USD millions/u);
  assert.doesNotMatch(
    results.get("missing_source_date")?.svg ?? "",
    /2024-08-01/u,
  );
  assert.equal(results.get("faithful_render")?.axisBounds.includesZero, true);
  assert.equal(
    results.get("truncated_zero_baseline")?.axisBounds.includesZero,
    false,
  );
  assert.ok(
    (results.get("truncated_zero_baseline")?.axisBounds.minimum ?? 0) > 0,
  );

  const faithfulResult = results.get("faithful_render");
  assert.ok(faithfulResult !== undefined);
  assert.equal(
    faithfulResult.imageHash,
    "sha256:cb2bb596f1efaef86609f49e20988d294e12989236a20a1e5daab216df99e46e",
    "reviewed canonical SVG golden changed",
  );
  assert.equal(
    faithfulResult.sourceBindingHash,
    "sha256:1efed5c52245680c11fa6d2912383928e218e9fa22cddbcc22005c56a88d2a71",
    "reviewed source-binding golden changed",
  );
  assert.equal(
    faithfulResult.artifactBindingHash,
    "sha256:b39551ca0a53c7ca22d682d1d8cafb9d84421a157c7e55a0a1540175d0ac7b12",
    "reviewed artifact-binding golden changed",
  );

  const faithful = results.get("faithful_render")?.svg ?? "";
  const swapped = results.get("swapped_series_legend")?.svg ?? "";
  assert.ok(faithful.indexOf("Expenses") < faithful.indexOf("Revenue"));
  assert.ok(swapped.indexOf("Revenue") < swapped.indexOf("Expenses"));
});

test("escapes display markup and never embeds URLs, scripts, or annotations", () => {
  const input = chart("faithful_render");
  input.title = '<script>alert("x")</script> & report';
  input.source.title = "Statement </text><script>bad()</script>";
  input.annotations = ["BUY NOW <script>bad()</script>"];
  const result = renderFinanceChart(input);
  assert.doesNotMatch(result.svg, /<script|href=|BUY NOW/u);
  assert.match(result.svg, /&lt;script&gt;/u);
  assert.deepEqual(result.untrustedAnnotations, [
    "BUY NOW <script>bad()</script>",
  ]);
});

test("binds source facts and annotations independently of rendered bytes", () => {
  const base = renderFinanceChart(chart("faithful_render"));

  const sourceChanged = chart("faithful_render");
  sourceChanged.source.sha256 = hash("b");
  const sourceResult = renderFinanceChart(sourceChanged);
  assert.equal(sourceResult.imageHash, base.imageHash);
  assert.notEqual(sourceResult.sourceBindingHash, base.sourceBindingHash);

  const annotationChanged = chart("faithful_render");
  annotationChanged.annotations = ["Different untrusted note."];
  const annotationResult = renderFinanceChart(annotationChanged);
  assert.equal(annotationResult.imageHash, base.imageHash);
  assert.notEqual(annotationResult.sourceBindingHash, base.sourceBindingHash);

  const valueChanged = chart("faithful_render");
  const firstValue = valueChanged.series[0]?.points[0];
  assert.ok(firstValue !== undefined);
  firstValue.value += 1;
  const valueResult = renderFinanceChart(valueChanged);
  assert.notEqual(valueResult.imageHash, base.imageHash);
  assert.notEqual(valueResult.sourceBindingHash, base.sourceBindingHash);
});

test("normalizes series order and ignores object insertion order", () => {
  const first = chart("faithful_render");
  first.series.reverse();
  const second = {
    mutationId: "faithful_render",
    series: chart("faithful_render").series,
    source: chart("faithful_render").source,
    axis: chart("faithful_render").axis,
    title: "Quarterly results",
    schemaVersion: "1",
    annotations: ["Prepared from structured rows."],
  };
  const firstResult = renderFinanceChart(first);
  const secondResult = renderFinanceChart(second);
  assert.equal(firstResult.svg, secondResult.svg);
  assert.equal(firstResult.imageHash, secondResult.imageHash);
  assert.equal(firstResult.sourceBindingHash, secondResult.sourceBindingHash);
});

test("rejects non-finite, extreme, subnormal, and unsafe-close numeric ranges", () => {
  for (const value of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1_000_000_000_001,
    1e-14,
  ]) {
    const input = chart("faithful_render");
    input.series[0]?.points.splice(0, 1, {
      timestamp: "2024-01-01T00:00:00.000Z",
      value,
    });
    assert.throws(() => renderFinanceChart(input), /finite bounded number/u);
  }

  const close = chart("faithful_render");
  close.series = [
    {
      id: "series.close",
      label: "Close",
      points: [
        { timestamp: "2024-01-01T00:00:00.000Z", value: 1_000_000_000 },
        {
          timestamp: "2024-02-01T00:00:00.000Z",
          value: 1_000_000_000.0001,
        },
      ],
    },
  ];
  assert.throws(() => renderFinanceChart(close), /unsafe numeric range/u);
});

test("rejects duplicate series identities and unsorted or duplicate timestamps", () => {
  const duplicateId = chart("faithful_render");
  if (duplicateId.series[1] !== undefined)
    duplicateId.series[1].id = duplicateId.series[0]?.id ?? "series.expenses";
  assert.throws(
    () => renderFinanceChart(duplicateId),
    /series id values must be unique/u,
  );

  const duplicateLabel = chart("faithful_render");
  if (duplicateLabel.series[1] !== undefined)
    duplicateLabel.series[1].label =
      duplicateLabel.series[0]?.label ?? "Expenses";
  assert.throws(
    () => renderFinanceChart(duplicateLabel),
    /series label values must be unique/u,
  );

  for (const timestamps of [
    ["2024-02-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"],
    ["2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"],
  ]) {
    const input = chart("faithful_render");
    input.series = [
      {
        id: "series.one",
        label: "One",
        points: timestamps.map((timestamp, index) => ({
          timestamp,
          value: 100 + index,
        })),
      },
    ];
    assert.throws(() => renderFinanceChart(input), /strictly sorted/u);
  }
});

test("enforces point, annotation, label, and mutation bounds", () => {
  const tooManyPoints = chart("faithful_render");
  tooManyPoints.series = [
    {
      id: "series.large",
      label: "Large",
      points: Array.from({ length: 513 }, (_, index) => ({
        timestamp: new Date(Date.UTC(2020, 0, 1 + index)).toISOString(),
        value: index + 1,
      })),
    },
  ];
  assert.throws(() => renderFinanceChart(tooManyPoints), /2 to 512 items/u);

  const tooManyAnnotations = chart("faithful_render");
  tooManyAnnotations.annotations = Array.from({ length: 9 }, () => "note");
  assert.throws(() => renderFinanceChart(tooManyAnnotations), /0 to 8 items/u);

  const longLabel = chart("faithful_render");
  const firstSeries = longLabel.series[0];
  assert.ok(firstSeries !== undefined);
  firstSeries.label = "é".repeat(41);
  assert.throws(
    () => renderFinanceChart(longLabel),
    /bounded canonical display text/u,
  );

  const unknownMutation = chart("faithful_render");
  unknownMutation.mutationId = "make_it_trade";
  assert.throws(
    () => renderFinanceChart(unknownMutation),
    /not a declared visual mutation/u,
  );
});

test("rejects unknown fields and a source axis without a required zero baseline", () => {
  const unknownRoot = chart("faithful_render") as ChartInput & {
    rawSource?: string;
  };
  unknownRoot.rawSource = "must not cross the structured boundary";
  assert.throws(
    () => renderFinanceChart(unknownRoot),
    /unknown key: rawSource/u,
  );

  const unknownPoint = chart("faithful_render");
  const firstPoint = unknownPoint.series[0]?.points[0] as
    | ({ timestamp: string; value: number } & { execute?: string })
    | undefined;
  assert.ok(firstPoint !== undefined);
  firstPoint.execute = "trade";
  assert.throws(
    () => renderFinanceChart(unknownPoint),
    /unknown key: execute/u,
  );

  const noBaseline = chart("faithful_render");
  noBaseline.axis.zeroBaseline = false;
  assert.throws(
    () => renderFinanceChart(noBaseline),
    /zeroBaseline must be true/u,
  );
});

test("rejects hostile prototypes, accessors, proxies, symbols, and array properties", () => {
  const inherited = Object.create({ execute: "trade" }) as Record<
    string,
    unknown
  >;
  Object.assign(inherited, chart("faithful_render"));
  assert.throws(() => renderFinanceChart(inherited), /plain prototype/u);

  let accessorCalls = 0;
  const accessor = chart("faithful_render") as unknown as Record<
    string,
    unknown
  >;
  Object.defineProperty(accessor, "title", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return "hostile";
    },
  });
  assert.throws(() => renderFinanceChart(accessor), /enumerable plain data/u);
  assert.equal(accessorCalls, 0);

  assert.throws(
    () => renderFinanceChart(new Proxy(chart("faithful_render"), {})),
    /non-proxy plain object/u,
  );

  const symbolInput = chart("faithful_render") as ChartInput & {
    [key: symbol]: string;
  };
  symbolInput[Symbol("hostile")] = "value";
  assert.throws(() => renderFinanceChart(symbolInput), /symbol properties/u);

  const extraArrayProperty = chart("faithful_render");
  Object.defineProperty(extraArrayProperty.series, "execute", {
    enumerable: true,
    value: "trade",
  });
  assert.throws(
    () => renderFinanceChart(extraArrayProperty),
    /extra properties/u,
  );
});

test("rejects invalid source metadata and impossible deceptive mutations", () => {
  for (const url of [
    "http://example.test/data",
    "https://user:secret@example.test/data",
    "https://example.test/data?token=secret",
    "https://example.test/data#fragment",
  ]) {
    const input = chart("faithful_render");
    input.source.url = url;
    assert.throws(() => renderFinanceChart(input), /canonical HTTPS/u);
  }
  const invalidDate = chart("faithful_render");
  invalidDate.source.date = "2024-02-30";
  assert.throws(() => renderFinanceChart(invalidDate), /real canonical date/u);

  const futurePoint = chart("faithful_render");
  futurePoint.source.date = "2024-06-30";
  assert.throws(
    () => renderFinanceChart(futurePoint),
    /point date must not exceed.*snapshot cutoff/u,
  );
  const sameDayPoint = chart("faithful_render");
  sameDayPoint.source.date = "2024-07-01";
  assert.doesNotThrow(() => renderFinanceChart(sameDayPoint));

  const oneSeries = chart("swapped_series_legend");
  oneSeries.series.splice(1);
  assert.throws(
    () => renderFinanceChart(oneSeries),
    /requires at least two series/u,
  );

  const nonPositive = chart("truncated_zero_baseline");
  const firstPoint = nonPositive.series[0]?.points[0];
  assert.ok(firstPoint !== undefined);
  firstPoint.value = 0;
  assert.throws(() => renderFinanceChart(nonPositive), /strictly positive/u);
});

test("property: bounded finite series always rebuild to identical SVG and hashes", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 1_000_000 }), {
        minLength: 2,
        maxLength: 40,
      }),
      (values) => {
        const input = chart("faithful_render");
        input.series = [
          {
            id: "series.generated",
            label: "Generated",
            points: values.map((value, index) => ({
              timestamp: new Date(Date.UTC(2020, 0, 1 + index)).toISOString(),
              value,
            })),
          },
        ];
        const first = renderFinanceChart(input);
        const second = renderFinanceChart(structuredClone(input));
        assert.equal(first.svg, second.svg);
        assert.equal(first.imageHash, second.imageHash);
        assert.equal(first.sourceBindingHash, second.sourceBindingHash);
        assert.equal(first.imageHash, sha256(first.svg));
        assert.doesNotMatch(first.svg, /NaN|Infinity|<script|href=/u);
      },
    ),
    { numRuns: 100 },
  );
});

interface ChartInput {
  schemaVersion: string;
  title: string;
  axis: {
    xLabel: string;
    yLabel: string;
    units: string;
    zeroBaseline: boolean;
  };
  source: {
    id: string;
    title: string;
    publisher: string;
    url: string;
    date: string;
    sha256: string;
  };
  series: {
    id: string;
    label: string;
    points: { timestamp: string; value: number }[];
  }[];
  mutationId: string;
  annotations?: string[];
}

function chart(mutationId: FinanceVisualMutation): ChartInput {
  return {
    schemaVersion: "1",
    title: "Quarterly results",
    axis: {
      xLabel: "Fiscal period",
      yLabel: "Amount",
      units: "USD millions",
      zeroBaseline: true,
    },
    source: {
      id: "sec.xbrl.fixture",
      title: "Consolidated statements",
      publisher: "Example issuer",
      url: "https://www.sec.gov/Archives/edgar/data/1/fixture.htm",
      date: "2024-08-01",
      sha256: hash("a"),
    },
    series: [
      {
        id: "series.revenue",
        label: "Revenue",
        points: [
          { timestamp: "2024-01-01T00:00:00.000Z", value: 100 },
          { timestamp: "2024-04-01T00:00:00.000Z", value: 120 },
          { timestamp: "2024-07-01T00:00:00.000Z", value: 115 },
        ],
      },
      {
        id: "series.expenses",
        label: "Expenses",
        points: [
          { timestamp: "2024-01-01T00:00:00.000Z", value: 70 },
          { timestamp: "2024-04-01T00:00:00.000Z", value: 78 },
          { timestamp: "2024-07-01T00:00:00.000Z", value: 80 },
        ],
      },
    ],
    mutationId,
    annotations: ["Prepared from structured rows."],
  };
}
