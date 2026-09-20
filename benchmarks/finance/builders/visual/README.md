# Deterministic finance chart compiler

`render.mts` converts bounded structured series into static canonical SVG for
the finance benchmark. It does not fetch a URL, call a model, interpret prose,
provide trading advice, or execute an action. Numeric scaling, UTC date
handling, legend placement, mutation application, XML escaping, and hashing
are code-owned operations.

The input boundary accepts only plain data with this shape:

```json
{
  "schemaVersion": "1",
  "title": "Quarterly results",
  "axis": {
    "xLabel": "Fiscal period",
    "yLabel": "Amount",
    "units": "USD millions",
    "zeroBaseline": true
  },
  "source": {
    "id": "sec.xbrl.example",
    "title": "Consolidated statements",
    "publisher": "Example issuer",
    "url": "https://www.sec.gov/Archives/edgar/data/1/example.htm",
    "date": "2025-01-31",
    "sha256": "sha256:<64 lowercase hexadecimal characters>"
  },
  "series": [
    {
      "id": "series.revenue",
      "label": "Revenue",
      "points": [
        { "timestamp": "2024-01-01T00:00:00.000Z", "value": 100 },
        { "timestamp": "2024-04-01T00:00:00.000Z", "value": 120 }
      ]
    }
  ],
  "mutationId": "faithful_render",
  "annotations": ["Untrusted display evidence retained outside the SVG."]
}
```

Objects and arrays must contain only the declared fields. Proxies, accessors,
symbols, inherited application objects, sparse arrays, duplicate series,
unsorted or duplicate timestamps, noncanonical dates, non-HTTPS source URLs,
non-finite or unsafe numeric ranges, and over-limit text or collections are
rejected. Series are sorted by stable identifier before rendering. Strings are
NFC-normalized, bounded by UTF-8 bytes, and escaped before entering SVG. Source
URLs and annotations are never embedded into the image, and the SVG contains no
scripts, stylesheets, event handlers, links, fonts, or external assets.

`source.date` is the inclusive UTC publication or snapshot cutoff for the
structured source. Every plotted point's UTC calendar date must be on or before
that cutoff. A future point is rejected before hashing or rendering, preventing
a chart from claiming a source snapshot that could not yet contain its data.

The result includes the exact LF-terminated SVG string, three distinct hashes,
code-computed axis bounds, the declared expected route, and the bounded
annotations marked as untrusted:

- `imageHash` is SHA-256 over the exact UTF-8 SVG bytes and therefore acts as
  the canonical SVG hash;
- `sourceBindingHash` covers normalized source metadata, the axis contract,
  structured points, labels, and annotations, but intentionally excludes the
  mutation so every controlled variant remains tied to the same source facts;
- `artifactBindingHash` covers the image and source-binding hashes together
  with `mutationId`, `expectedRoute`, the output schema, the fixed
  `finance.canonical-svg` renderer version, and the
  `finance.visual-mutations.v3` policy identifier. Relabeling a retained SVG
  therefore invalidates its artifact binding.

The focused test pins a reviewed faithful-render golden for all three hashes.
Intentional renderer or policy changes must update the version and golden in a
reviewable change.

The compiler implements exactly the mutations in
`../policies/visual-mutations.v3.json`:

| Mutation | Expected route | Deterministic effect |
| --- | --- | --- |
| `faithful_render` | `observe` | Shows source date, units, correct legend, and the required zero baseline. |
| `missing_source_date` | `investigate` | Omits only the visible source date. |
| `missing_units` | `investigate` | Omits only the visible y-axis units. |
| `swapped_series_legend` | `escalate` | Swaps the first two canonical legend labels without changing plotted series. |
| `reversed_time_axis` | `escalate` | Reverses both chronological x coordinates and visible date ticks while preserving source points. |
| `undisclosed_log_scale` | `escalate` | Applies a logarithmic y-coordinate transform while leaving the visible ticks and label linear; it is valid only for strictly positive source values. |
| `truncated_zero_baseline` | `escalate` | Uses a positive lower bound; it is valid only for strictly positive source values. |

Renderer v1 and its five-mutation policy, plus renderer v2 and its six-mutation
policy, remain accepted by the trusted adapter, finance pack, and offline
verifier for existing retained artifacts. New compiler output uses renderer v3.
A v1 artifact cannot claim `reversed_time_axis` or `undisclosed_log_scale`; a
v2 artifact cannot claim the v3-only `undisclosed_log_scale` mutation.

Run the focused offline checks with:

```sh
tsx --test benchmarks/finance/builders/visual/test/render.test.mts
```
