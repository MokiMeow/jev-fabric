import { Redactor } from "./redaction.js";
import {
  MAX_TELEMETRY_RECORD_BYTES,
  OVERSIZED_RECORD_MARKER,
} from "./telemetry-limits.js";

export interface TelemetrySink {
  emit(record: unknown): void | Promise<void>;
}

export interface JsonlTelemetrySinkOptions {
  readonly write: (line: string) => void | Promise<void>;
  readonly redactor?: Redactor;
}

/** A caller-owned JSONL transport that emits one structurally redacted record per call. */
export class JsonlTelemetrySink implements TelemetrySink {
  private readonly redactor: Redactor;

  constructor(private readonly options: JsonlTelemetrySinkOptions) {
    this.redactor = options.redactor ?? new Redactor();
  }

  emit(record: unknown): void | Promise<void> {
    const sanitized = sanitizeControls(
      this.redactor.redact(record),
      this.redactor,
    );
    let line = `${JSON.stringify(sanitized)}\n`;
    if (Buffer.byteLength(line, "utf8") > MAX_TELEMETRY_RECORD_BYTES)
      line = `${JSON.stringify({ redacted: true, marker: OVERSIZED_RECORD_MARKER })}\n`;
    return this.options.write(line);
  }
}

function sanitizeControls(value: unknown, redactor: Redactor): unknown {
  if (typeof value === "string") return redactor.sanitizeText(value);
  if (Array.isArray(value))
    return value.map((item) => sanitizeControls(item, redactor));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeControls(item, redactor),
      ]),
    );
  }
  return value;
}
