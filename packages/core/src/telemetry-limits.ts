/** Maximum UTF-8 bytes accepted from a single telemetry string before fail-closed redaction. */
export const MAX_TELEMETRY_STRING_BYTES = 32 * 1024;

/** Maximum UTF-8 bytes emitted for a complete JSONL telemetry record, including its newline. */
export const MAX_TELEMETRY_RECORD_BYTES = 64 * 1024;

export const OVERSIZED_STRING_MARKER = "[REDACTED:OVERSIZED]";
export const OVERSIZED_RECORD_MARKER = "[REDACTED:OVERSIZED_RECORD]";
