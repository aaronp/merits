/**
 * Router Integration Test
 *
 * Tests the full flow: send → receive → route → handle
 * Demonstrates end-to-end message routing with the Transport and Router.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { ConvexTransport } from "../../src/adapters/ConvexTransport";
import { ConvexIdentityAuth } from "../../src/adapters/ConvexIdentityAuth";
import { createMessageRouter } from "../../core/runtime/router";
import { eventually, eventuallyValue } from "../helpers/eventually";
import { SignedRequest } from "../../core/types";
import { signMutationArgs } from "../../core/signatures";
import {
  generateKeyPair,
  createAID,
  encodeCESRKey,
} from "../helpers/crypto-utils";

const CONVEX_URL = process.env.CONVEX_URL;

if (!CONVEX_URL) {
  throw new Error("CONVEX_URL environment variable is not set");
}

describe("Router Integration: Full Flow", () => {
  let convex: ConvexClient;
  let transport: ConvexTransport;
  let identityAuth: ConvexIdentityAuth;

  let aliceKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let bobKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let aliceAid: string;
  let bobAid: string;

  beforeAll(async () => {
    convex = new ConvexClient(CONVEX_URL!);
    transport = new ConvexTransport(convex);
    identityAuth = new ConvexIdentityAuth(convex);

    // Generate test users
    aliceKeys = await generateKeyPair();
    bobKeys = await generateKeyPair();
    aliceAid = createAID(aliceKeys.publicKey);
    bobAid = createAID(bobKeys.publicKey);

    // Register key states
    await convex.mutation(api.auth.registerKeyState, {
      aid: aliceAid,
      ksn: 0,
      keys: [encodeCESRKey(aliceKeys.publicKey)],
      threshold: "1",
      lastEvtSaid: "EAAA",
    });

    await convex.mutation(api.auth.registerKeyState, {
      aid: bobAid,
      ksn: 0,
      keys: [encodeCESRKey(bobKeys.publicKey)],
      threshold: "1",
      lastEvtSaid: "EBBB",
    });

    // Grant all permissions to test users (bypasses RBAC for integration tests)
    await convex.mutation(api.testHelpers.grantAllPermissions, { aid: aliceAid });
    await convex.mutation(api.testHelpers.grantAllPermissions, { aid: bobAid });
  });

  afterAll(() => {
    convex.close();
  });

  test("end-to-end: send → receive → route → handle", async () => {
    // Set up router with handlers
    const router = createMessageRouter();
    const chatMessages: Array<{ from: string; text: string }> = [];
    const customMessages: Array<{ from: string; data: any }> = [];

    router.register("chat.text.v1", (msg, plaintext: any) => {
      chatMessages.push({ from: msg.from, text: plaintext.text });
    });

    router.register("app.custom.v1", (msg, plaintext: any) => {
      customMessages.push({ from: msg.from, data: plaintext });
    });

    // Alice sends two different message types to Bob
    const sendSig1 = await createSignedRequest(aliceAid, aliceKeys.privateKey, {
      recpAid: bobAid,
      ct: mockEncrypt({ text: "Hello Bob!" }),
      typ: "chat.text.v1",
      ttl: 60000,
    });

    await transport.sendMessage({
      to: bobAid,
      ct: mockEncrypt({ text: "Hello Bob!" }),
      typ: "chat.text.v1",
      ttlMs: 60000,
      sig: sendSig1,
    });

    const sendSig2 = await createSignedRequest(aliceAid, aliceKeys.privateKey, {
      recpAid: bobAid,
      ct: mockEncrypt({ action: "ping", value: 42 }),
      typ: "app.custom.v1",
      ttl: 60000,
    });

    await transport.sendMessage({
      to: bobAid,
      ct: mockEncrypt({ action: "ping", value: 42 }),
      typ: "app.custom.v1",
      ttlMs: 60000,
      sig: sendSig2,
    });

    // Bob receives and routes messages
    const receiveSig = await createSignedRequest(bobAid, bobKeys.privateKey, {
      recpAid: bobAid,
    });

    const messages = await eventuallyValue(
      async () => {
        const msgs = await transport.receiveMessages({
          for: bobAid,
          sig: receiveSig,
        });
        return msgs.length >= 2 ? msgs : undefined;
      },
      { timeout: 3000, message: "Messages not received" }
    );

    // Route each message through the router
    const mockCtx = {
      decrypt: async (msg: any) => mockDecrypt(msg.ct),
    };

    for (const msg of messages) {
      await router.dispatch(mockCtx, msg);
    }

    // Verify handlers were called correctly
    expect(chatMessages.length).toBeGreaterThan(0);
    expect(chatMessages[0].from).toBe(aliceAid);
    expect(chatMessages[0].text).toBe("Hello Bob!");

    expect(customMessages.length).toBeGreaterThan(0);
    expect(customMessages[0].from).toBe(aliceAid);
    expect(customMessages[0].data.action).toBe("ping");
    expect(customMessages[0].data.value).toBe(42);
  });

  test("router with subscribe: live routing", async () => {
    const router = createMessageRouter();
    const liveMessages: string[] = [];

    router.register("live.test.v1", (msg, plaintext: any) => {
      liveMessages.push(plaintext.content);
    });

    // Bob subscribes with auto-routing
    const subscribeSig = await createSignedRequest(bobAid, bobKeys.privateKey, {
      recpAid: bobAid,
    });

    const cancel = await transport.subscribe({
      for: bobAid,
      sig: subscribeSig,
      onMessage: async (msg) => {
        // Route through router on each message
        await router.dispatch(
          { decrypt: async (m) => mockDecrypt(m.ct) },
          msg
        );
        return false; // Do not auto-ack
      },
    });

    // Alice sends a live message
    const sendSig = await createSignedRequest(aliceAid, aliceKeys.privateKey, {
      recpAid: bobAid,
      ct: mockEncrypt({ content: "Live update!" }),
      typ: "live.test.v1",
      ttl: 60000,
    });

    await transport.sendMessage({
      to: bobAid,
      ct: mockEncrypt({ content: "Live update!" }),
      typ: "live.test.v1",
      ttlMs: 60000,
      sig: sendSig,
    });

    // Wait for message to be routed
    await eventually(
      () => liveMessages.includes("Live update!"),
      { timeout: 5000, message: "Live message not routed" }
    );

    expect(liveMessages).toContain("Live update!");

    cancel();
  }, 10000);

  /**
   * Helper to create signed request
   */
  async function createSignedRequest(
    aid: string,
    privateKey: Uint8Array,
    args: Record<string, unknown>
  ): Promise<SignedRequest> {
    return await signMutationArgs(args, privateKey, aid);
  }

  /**
   * Mock encryption (base64 for testing)
   */
  function mockEncrypt(plaintext: any): string {
    return Buffer.from(JSON.stringify(plaintext)).toString("base64");
  }

  /**
   * Mock decryption
   */
  function mockDecrypt(ciphertext: string): any {
    return JSON.parse(Buffer.from(ciphertext, "base64").toString("utf-8"));
  }
});
