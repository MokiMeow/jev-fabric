export type DnsResolver = (
  hostname: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<readonly string[]>;

export interface EndpointPolicyOptions {
  readonly resolve: DnsResolver;
  readonly allowLoopbackHttp?: boolean;
  readonly allowedPorts?: readonly number[];
}
/** A resolver-bound destination. Transports must connect to `address`, never re-resolve `url.hostname`. */
export interface EndpointConnectionPlan {
  readonly url: URL;
  readonly address: string;
  readonly serverName: string;
  readonly hostHeader: string;
  readonly localLoopback: boolean;
}
/** Error deliberately omits endpoint details, including paths and query strings. */
export class EndpointPolicyError extends Error {
  readonly name = "EndpointPolicyError";
  constructor() {
    super("endpoint rejected by network policy");
  }
}

/**
 * Builds an address-pinned connection plan. The production transport consumes
 * this plan atomically: DNS policy validation alone is not a connection guard.
 */
export class EndpointPolicy {
  readonly #resolve: DnsResolver;
  readonly #allowLoopbackHttp: boolean;
  readonly #allowedPorts: ReadonlySet<number>;
  constructor(options: EndpointPolicyOptions) {
    this.#resolve = options.resolve;
    this.#allowLoopbackHttp = options.allowLoopbackHttp === true;
    this.#allowedPorts = new Set(options.allowedPorts ?? [443]);
  }
  async plan(
    value: string | URL,
    signal?: AbortSignal,
  ): Promise<EndpointConnectionPlan> {
    return this.#plan(value, false, signal);
  }
  async planRedirect(
    current: string | URL,
    location: string,
    signal?: AbortSignal,
  ): Promise<EndpointConnectionPlan> {
    let destination: URL;
    try {
      destination = new URL(location, current);
    } catch {
      throw new EndpointPolicyError();
    }
    return this.#plan(destination, true, signal);
  }
  async #plan(
    value: string | URL,
    redirect: boolean,
    signal?: AbortSignal,
  ): Promise<EndpointConnectionPlan> {
    throwIfAborted(signal);
    const raw = typeof value === "string" ? value : value.toString();
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new EndpointPolicyError();
    }
    if (url.username || url.password || url.hash || !safeRawHost(raw, url))
      throw new EndpointPolicyError();
    const loopback =
      !redirect &&
      this.#allowLoopbackHttp &&
      url.protocol === "http:" &&
      exactLoopback(raw, url);
    if (!loopback && url.protocol !== "https:") throw new EndpointPolicyError();
    const port =
      url.port === ""
        ? url.protocol === "https:"
          ? 443
          : 80
        : Number(url.port);
    if (
      !Number.isSafeInteger(port) ||
      port < 1 ||
      port > 65535 ||
      (!loopback && !this.#allowedPorts.has(port))
    )
      throw new EndpointPolicyError();
    if (loopback) return plan(url, unbracket(url.hostname), true);
    if (forbiddenHostname(url.hostname)) throw new EndpointPolicyError();
    if (isIpLiteral(url.hostname)) {
      const address = unbracket(url.hostname);
      if (isSpecialAddress(address)) throw new EndpointPolicyError();
      return plan(url, address, false);
    }
    let addresses: readonly string[];
    try {
      addresses = await raceAbort(
        () =>
          signal
            ? this.#resolve(url.hostname, { signal })
            : this.#resolve(url.hostname),
        signal,
      );
    } catch {
      if (signal?.aborted) throw abortError(signal);
      throw new EndpointPolicyError();
    }
    throwIfAborted(signal);
    if (addresses.length === 0 || addresses.some(isSpecialAddress))
      throw new EndpointPolicyError();
    return plan(url, addresses[0] ?? "", false);
  }
}
function plan(
  url: URL,
  address: string,
  localLoopback: boolean,
): EndpointConnectionPlan {
  if (!address) throw new EndpointPolicyError();
  return {
    url,
    address,
    serverName: unbracket(url.hostname),
    hostHeader: url.host,
    localLoopback,
  };
}
function exactLoopback(raw: string, url: URL): boolean {
  return (
    (url.hostname === "127.0.0.1" || url.hostname === "[::1]") &&
    /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?:[/:?#]|$)/i.test(raw)
  );
}
function safeRawHost(value: string, url: URL): boolean {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (!authority) return false;
  const host = authority.replace(/^.*@/, "").replace(/:\d*$/, "");
  return (
    !isIpLiteral(url.hostname) ||
    host.toLowerCase() === url.hostname.toLowerCase()
  );
}
function forbiddenHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  );
}
function unbracket(value: string): string {
  return value.replace(/^\[|\]$/g, "");
}
function isIpLiteral(value: string): boolean {
  return (
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || /^\[[0-9a-f:.]+\]$/i.test(value)
  );
}
function isSpecialAddress(value: string): boolean {
  const address = unbracket(value).toLowerCase();
  if (address.includes(":")) return isSpecialIpv6(address);
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113)
  );
}
function isSpecialIpv6(address: string): boolean {
  const value = parseIpv6(address);
  if (value === undefined) return true;
  const prefix96 = value >> 32n;
  // Unspecified/loopback; IPv4-compatible, mapped, and translated; NAT64;
  // 6to4; and Teredo are rejected as transition forms. Their embedded IPv4
  // destinations must never bypass the IPv4 special-use policy.
  if (
    value === 0n ||
    value === 1n ||
    prefix96 === 0n ||
    prefix96 === 0xffffn ||
    prefix96 === 0xffff0000n ||
    value >> 96n === 0x64ff9bn ||
    value >> 80n === 0x64ff9b0001n ||
    value >> 112n === 0x2002n ||
    value >> 96n === 0x20010000n
  )
    return true;
  return (
    value >> 121n === 0x7en ||
    value >> 118n === 0x3fan ||
    value >> 120n === 0xffn ||
    value >> 96n === 0x20010db8n
  );
}
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("endpoint planning cancelled");
}
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}
/**
 * DNS implementations are a trust boundary: production resolvers should honor
 * the signal, but this race also bounds a non-cooperative injected resolver.
 * Its rejection handler remains attached after cancellation, so a late resolver
 * rejection cannot become an unhandled rejection.
 */
function raceAbort<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return Promise.resolve().then(operation);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(error);
    };
    const onAbort = () => fail(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve()
      .then(operation)
      .then((value) => finish(resolve, value), fail);
  });
}
function parseIpv6(address: string): bigint | undefined {
  let text = address;
  const v4 = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const octets = (v4[1] ?? "").split(".").map(Number);
    if (
      octets.length !== 4 ||
      octets.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 255,
      )
    )
      return undefined;
    text = `${text.slice(0, text.length - (v4[1] ?? "").length)}${(((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16)}:${(((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16)}`;
  }
  const chunks = text.split("::");
  if (chunks.length > 2) return undefined;
  const left = chunks[0] ? chunks[0].split(":") : [];
  const right = chunks[1] ? chunks[1].split(":") : [];
  if (left.concat(right).some((chunk) => !/^[0-9a-f]{1,4}$/i.test(chunk)))
    return undefined;
  const missing = 8 - left.length - right.length;
  if ((chunks.length === 1 && missing !== 0) || missing < 0) return undefined;
  return [...left, ...Array(missing).fill("0"), ...right].reduce(
    (value, chunk) => (value << 16n) | BigInt(`0x${chunk}`),
    0n,
  );
}
