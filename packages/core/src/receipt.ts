import {
  decisionReceiptSchema,
  type DecisionReceipt,
} from "@mokimeow/jev-fabric-protocol";
import { Redactor } from "./redaction.js";

const forbiddenReceiptKeys = new Set([
  "state",
  "rawstate",
  "secret",
  "apikey",
  "ticket",
  "signingkey",
  "authorization",
]);

export interface ReceiptBuilderOptions {
  readonly schemaVersion?: string;
}

/** Creates protocol receipts from redacted metadata only. */
export class ReceiptBuilder {
  private readonly redactor: Redactor;

  constructor(private readonly options: ReceiptBuilderOptions = {}) {
    this.redactor = new Redactor();
  }

  build(
    input: Omit<DecisionReceipt, "redacted"> & Record<string, unknown>,
  ): DecisionReceipt {
    const effective = {
      ...input,
      schemaVersion: this.options.schemaVersion ?? input.schemaVersion,
    };
    rejectForbidden(effective);
    const redacted = this.redactor.redact(effective);
    return decisionReceiptSchema.parse({
      ...asRecord(redacted),
      redacted: true,
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("receipt must be an object");
  return value as Record<string, unknown>;
}

function rejectForbidden(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectForbidden(item);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenReceiptKeys.has(key.toLowerCase()))
      throw new TypeError(`receipt cannot contain ${key}`);
    rejectForbidden(item);
  }
}
