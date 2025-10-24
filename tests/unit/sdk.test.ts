/**
 * SDK Unit Tests
 *
 * Tests the unified createMeritsClient() API
 */

import { describe, test, expect } from "bun:test";
import { createMeritsClient } from "../../src/client";

describe("Unified SDK", () => {
  test("createMeritsClient returns all interfaces", () => {
    const client = createMeritsClient("https://test.convex.cloud");

    // Verify all interfaces are present
    expect(client.identity).toBeDefined();
    expect(client.transport).toBeDefined();
    expect(client.group).toBeDefined();
    expect(client.router).toBeDefined();

    // Verify helpers are present
    expect(typeof client.createAuth).toBe("function");
    expect(typeof client.computeArgsHash).toBe("function");
    expect(typeof client.computeCtHash).toBe("function");
    expect(typeof client.close).toBe("function");

    client.close();
  });

  test("computeArgsHash produces deterministic output", () => {
    const client = createMeritsClient("https://test.convex.cloud");

    const hash1 = client.computeArgsHash({ a: 1, b: 2 });
    const hash2 = client.computeArgsHash({ b: 2, a: 1 }); // Different order

    expect(hash1).toBe(hash2); // Should be same (deterministic)

    const hash3 = client.computeArgsHash({ a: 1, b: 3 });
    expect(hash1).not.toBe(hash3); // Different values

    client.close();
  });

  test("computeCtHash produces hex hash", () => {
    const client = createMeritsClient("https://test.convex.cloud");

    const ct = "Hello, world!";
    const hash = client.computeCtHash(ct);

    // Should be 64 hex characters (32 bytes * 2)
    expect(hash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);

    // Should be deterministic
    const hash2 = client.computeCtHash(ct);
    expect(hash).toBe(hash2);

    client.close();
  });

  test("router is functional", () => {
    const client = createMeritsClient("https://test.convex.cloud");

    const handled: string[] = [];

    client.router.register("test.message", (msg, plaintext) => {
      handled.push(plaintext.text);
    });

    expect(client.router.hasHandler("test.message")).toBe(true);
    expect(client.router.getRegisteredTypes()).toContain("test.message");

    client.close();
  });

  test("close() closes underlying client", () => {
    const client = createMeritsClient("https://test.convex.cloud");

    // Should not throw
    expect(() => client.close()).not.toThrow();
  });
});
