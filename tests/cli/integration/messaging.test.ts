/**
 * Messaging Integration Tests
 *
 * Tests the full send → receive → ack flow
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sendMessage } from "../../../cli/commands/send";
import { receiveMessages } from "../../../cli/commands/receive";
import { ackMessage } from "../../../cli/commands/ack";
import type { CLIContext } from "../../../cli/lib/context";
import { createMeritsClient } from "../../../src/client";
import { OSKeychainVault } from "../../../cli/lib/vault/OSKeychainVault";
import { generateKeyPair, createAID } from "../../../core/crypto";
import os from "os";
import path from "path";
import fs from "fs/promises";

describe("Messaging Flow", () => {
  let ctx: CLIContext;
  let tempDir: string;
  let aliceAid: string;
  let bobAid: string;

  beforeAll(async () => {
    // Create temporary directory for test vault
    tempDir = path.join(os.tmpdir(), `merits-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const convexUrl = process.env.CONVEX_URL;
    if (!convexUrl) {
      throw new Error("CONVEX_URL environment variable required for integration tests");
    }

    // Setup vault
    const vault = new OSKeychainVault(
      path.join(tempDir, "vault.json"),
      "merits-test"
    );

    // Create client
    const client = createMeritsClient({
      backend: {
        type: "convex",
        url: convexUrl,
      },
      defaultIdentity: "alice",
      outputFormat: "text",
      vaultPath: path.join(tempDir, "vault.json"),
    });

    ctx = {
      vault,
      client,
      config: {
        backend: {
          type: "convex",
          url: convexUrl,
        },
        defaultIdentity: "alice",
        outputFormat: "text",
        vaultPath: path.join(tempDir, "vault.json"),
      },
    };

    // Create two test identities
    const aliceKeys = await generateKeyPair();
    aliceAid = createAID(aliceKeys.publicKey);
    await ctx.vault.storeIdentity("alice", {
      aid: aliceAid,
      privateKey: aliceKeys.privateKey,
      ksn: 0,
      metadata: {
        publicKey: aliceKeys.publicKey,
        createdAt: Date.now(),
        registered: true,
      },
    });

    const bobKeys = await generateKeyPair();
    bobAid = createAID(bobKeys.publicKey);
    await ctx.vault.storeIdentity("bob", {
      aid: bobAid,
      privateKey: bobKeys.privateKey,
      ksn: 0,
      metadata: {
        publicKey: bobKeys.publicKey,
        createdAt: Date.now(),
        registered: true,
      },
    });

    // Register identities with backend
    await ctx.client.identityRegistry.registerIdentity({
      aid: aliceAid,
      publicKey: aliceKeys.publicKey,
      ksn: 0,
    });

    await ctx.client.identityRegistry.registerIdentity({
      aid: bobAid,
      publicKey: bobKeys.publicKey,
      ksn: 0,
    });
  });

  afterAll(async () => {
    // Cleanup
    ctx.client.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("send → receive → ack flow", async () => {
    // Send message from Alice to Bob
    await sendMessage(bobAid, {
      message: "Hello Bob!",
      from: "alice",
      format: "json",
      _ctx: ctx,
    });

    // Wait a bit for message to propagate
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Receive messages as Bob
    const receivedMessages: any[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => {
      try {
        const parsed = JSON.parse(msg);
        if (Array.isArray(parsed)) {
          receivedMessages.push(...parsed);
        }
      } catch {
        // Not JSON, ignore
      }
    };

    await receiveMessages({
      from: "bob",
      plaintext: true,
      format: "json",
      _ctx: ctx,
    });

    console.log = originalLog;

    expect(receivedMessages.length).toBeGreaterThan(0);
    const msg = receivedMessages[0];
    expect(msg.from).toBe(aliceAid);
    expect(msg.plaintext).toBe("Hello Bob!");
    expect(msg.envelopeHash).toBeDefined();

    // Acknowledge message
    await ackMessage(msg.id, {
      envelopeHash: msg.envelopeHash,
      from: "bob",
      _ctx: ctx,
    });

    // Success - no errors thrown
    expect(true).toBe(true);
  }, 15000); // 15 second timeout for network operations

  test("piping support for send", async () => {
    // Simulate stdin input
    const originalStdin = process.stdin;
    const mockStdin = {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from("Piped message content");
      },
    };
    (process as any).stdin = mockStdin;

    try {
      await sendMessage(bobAid, {
        from: "alice",
        format: "json",
        _ctx: ctx,
      });

      // Success - no errors thrown
      expect(true).toBe(true);
    } finally {
      (process as any).stdin = originalStdin;
    }
  }, 10000);

  test("JSON mode is silent (no narration)", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => {
      logs.push(msg);
    };

    try {
      await sendMessage(bobAid, {
        message: "Test message",
        from: "alice",
        format: "json",
        _ctx: ctx,
      });

      // Should only have JSON output, no "Sending message..." narration
      expect(logs.length).toBe(1);
      const parsed = JSON.parse(logs[0]);
      expect(parsed.messageId).toBeDefined();
      expect(logs[0]).not.toContain("Sending message");
    } finally {
      console.log = originalLog;
    }
  }, 10000);
});
