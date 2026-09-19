import { describe, expect, it } from "vitest";
import { EndpointPolicy, EndpointPolicyError } from "../src/endpoint-policy.js";

const publicResolver = async () => ["8.8.8.8"];

describe("EndpointPolicy", () => {
  it("permits only validated public HTTPS endpoints by default", async () => {
    const policy = new EndpointPolicy({ resolve: publicResolver });
    await expect(
      policy.plan("https://models.example.test/v1/chat/completions"),
    ).resolves.toMatchObject({
      address: "8.8.8.8",
      serverName: "models.example.test",
      hostHeader: "models.example.test",
    });
  });

  it("rejects credentials, insecure remote URLs, aliases and special-use targets", async () => {
    const policy = new EndpointPolicy({
      resolve: async (host) =>
        host === "public.example" ? ["8.8.8.8"] : ["127.0.0.1"],
    });
    for (const url of [
      "https://user:pass@public.example/v1",
      "http://public.example/v1",
      "https://localhost/v1",
      "https://127.0.0.1/v1",
      "https://[::1]/v1",
      "https://0x7f000001/v1",
      "https://public.example:444/v1",
    ])
      await expect(policy.plan(url)).rejects.toBeInstanceOf(
        EndpointPolicyError,
      );
  });

  it("permits only explicit numeric loopback HTTP and revalidates a redirect destination", async () => {
    const local = new EndpointPolicy({
      allowLoopbackHttp: true,
      resolve: async () => ["127.0.0.1"],
    });
    await expect(local.plan("http://127.0.0.1/v1")).resolves.toMatchObject({
      address: "127.0.0.1",
    });
    await expect(local.plan("http://localhost/v1")).rejects.toBeInstanceOf(
      EndpointPolicyError,
    );
    const rebinding = new EndpointPolicy({
      resolve: async (host) =>
        host === "first.example" ? ["8.8.8.8"] : ["10.0.0.1"],
    });
    await expect(
      rebinding.planRedirect(
        "https://first.example/v1",
        "https://second.example/v1",
      ),
    ).rejects.toBeInstanceOf(EndpointPolicyError);
  });

  it("rejects IPv4-compatible, mapped, translated, and transition IPv6 forms from literals and DNS", async () => {
    const policy = new EndpointPolicy({ resolve: async () => ["::7f00:1"] });
    for (const value of [
      "https://[::7f00:1]/v1",
      "https://[::ffff:127.0.0.1]/v1",
      "https://[::ffff:0:7f00:1]/v1",
      "https://[64:ff9b::7f00:1]/v1",
      "https://[2002:7f00:0001::]/v1",
    ])
      await expect(policy.plan(value)).rejects.toBeInstanceOf(
        EndpointPolicyError,
      );
    await expect(policy.plan("https://dns.example/v1")).rejects.toBeInstanceOf(
      EndpointPolicyError,
    );
    const translatedDns = new EndpointPolicy({
      resolve: async () => ["::ffff:0:7f00:1"],
    });
    await expect(
      translatedDns.plan("https://dns.example/v1"),
    ).rejects.toBeInstanceOf(EndpointPolicyError);
  });
});
