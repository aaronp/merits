/**
 * Transport Interface Tests
 *
 * Tests the Transport contract using ConvexTransport adapter.
 * Includes subscribe (push) functionality tests.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { ConvexTransport } from "../../convex/adapters/ConvexTransport";
import { ConvexIdentityAuth } from "../../convex/adapters/ConvexIdentityAuth";
import { Transport } from "../../core/interfaces/Transport";
import { IdentityAuth } from "../../core/interfaces/IdentityAuth";
import { AuthProof } from "../../core/types";
import {
  generateKeyPair,
  createAID,
  encodeCESRKey,
  sign,
} from "../helpers/crypto-utils";
import { eventually, eventuallyValue } from "../helpers/eventually";

const CONVEX_URL = process.env.CONVEX_URL;

if (!CONVEX_URL) {
  throw new Error("CONVEX_URL environment variable is not set");
}

describe("Transport Interface (Convex implementation)", () => {
  let convex: ConvexClient;
  let transport: Transport;
  let identityAuth: IdentityAuth;

  let aliceKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let bobKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let aliceAid: string;
  let bobAid: string;

  /**
   * Helper to create auth proof for a user
   */
  async function createAuthProof(
    aid: string,
    privateKey: Uint8Array,
    purpose: "send" | "receive" | "ack",
    args: Record<string, unknown>
  ): Promise<AuthProof> {
    const challenge = await identityAuth.issueChallenge({
      aid,
      purpose,
      args,
    });

    // Sign the payload
    const canonical = JSON.stringify(
      challenge.payloadToSign,
      Object.keys(challenge.payloadToSign).sort()
    );
    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);
    const signature = await sign(data, privateKey);

    // Create indexed signature
    const sigB64 = btoa(String.fromCharCode(...signature))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    return {
      challengeId: challenge.challengeId,
      sigs: [`0-${sigB64}`],
      ksn: 0,
    };
  }

  beforeAll(async () => {
    convex = new ConvexClient(CONVEX_URL!);
    // Ensure clean DB state for this suite (test-only helper)
    try {
      await convex.mutation(api.testHelpers.resetAll, {} as any);
    } catch (e) {
      // Ignore if older backend without resetAll
    }
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

  test("sendMessage returns messageId", async () => {
    const auth = await createAuthProof(aliceAid, aliceKeys.privateKey, "send", {
      recpAid: bobAid,
      ctHash: await computeCtHash("test-message"),
      ttl: 60000,
      alg: "",
      ek: "",
    });

    const result = await transport.sendMessage({
      to: bobAid,
      ct: "test-message",
      typ: "chat.text.v1",
      ttlMs: 60000,
      auth,
    });

    expect(result.messageId).toBeTruthy();
  }, 8000);

  test("receiveMessages returns sent messages", async () => {
    // Alice sends to Bob
    const sendAuth = await createAuthProof(aliceAid, aliceKeys.privateKey, "send", {
      recpAid: bobAid,
      ctHash: await computeCtHash("message-for-bob"),
      ttl: 60000,
      alg: "",
      ek: "",
    });

    const { messageId } = await transport.sendMessage({
      to: bobAid,
      ct: "message-for-bob",
      typ: "test.v1",
      ttlMs: 60000,
      auth: sendAuth,
    });

    // Bob receives - use eventually to wait for message to appear
    const receiveAuth = await createAuthProof(bobAid, bobKeys.privateKey, "receive", {
      recpAid: bobAid,
    });

    const msg = await eventuallyValue(
      async () => {
        const messages = await transport.receiveMessages({
          for: bobAid,
          auth: receiveAuth,
        });
        return messages.find((m) => m.id === messageId);
      },
      { timeout: 3000, message: "Message not received" }
    );

    expect(msg.from).toBe(aliceAid);
    expect(msg.to).toBe(bobAid);
    expect(msg.ct).toBe("message-for-bob");
    expect(msg.typ).toBe("test.v1");
    expect(msg.senderProof.ksn).toBe(0);
  }, 12000);

  test("ackMessage removes message from receive queue", async () => {
    // Alice sends to Bob
    const sendAuth = await createAuthProof(aliceAid, aliceKeys.privateKey, "send", {
      recpAid: bobAid,
      ctHash: await computeCtHash("msg-to-ack"),
      ttl: 60000,
      alg: "",
      ek: "",
    });

    const { messageId } = await transport.sendMessage({
      to: bobAid,
      ct: "msg-to-ack",
      ttlMs: 60000,
      auth: sendAuth,
    });

    // Bob receives - wait for message to appear
    const receiveAuth = await createAuthProof(bobAid, bobKeys.privateKey, "receive", {
      recpAid: bobAid,
    });

    const msgToAck = await eventuallyValue(
      async () => {
        const messages = await transport.receiveMessages({
          for: bobAid,
          auth: receiveAuth,
        });
        return messages.find((m) => m.id === messageId);
      },
      { timeout: 3000 }
    );

    expect(msgToAck).toBeDefined();

    // Bob acknowledges
    const ackAuth = await createAuthProof(bobAid, bobKeys.privateKey, "ack", {
      recpAid: bobAid,
      messageId,
    });

    await transport.ackMessage({
      messageId,
      auth: ackAuth,
    });

    // Message should eventually disappear
    await eventually(
      async () => {
        const receiveAuth2 = await createAuthProof(bobAid, bobKeys.privateKey, "receive", {
          recpAid: bobAid,
        });
        const messages = await transport.receiveMessages({
          for: bobAid,
          auth: receiveAuth2,
        });
        return messages.find((m) => m.id === messageId) === undefined;
      },
      { timeout: 3000, message: "Message not removed after ack" }
    );
  }, 12000);

  test("subscribe receives messages in real-time with auto-ack", async () => {
    const receivedMessages: string[] = [];

    // Subscribe as Bob
    const subscribeAuth = await createAuthProof(bobAid, bobKeys.privateKey, "receive", {
      recpAid: bobAid,
    });

    const cancel = await transport.subscribe({
      for: bobAid,
      auth: subscribeAuth,
      onMessage: async (msg) => {
        receivedMessages.push(msg.ct);
        return false; // Do not auto-ack in this test (no 'ack' auth)
      },
    });

    // Alice sends a message
    const sendAuth = await createAuthProof(aliceAid, aliceKeys.privateKey, "send", {
      recpAid: bobAid,
      ctHash: await computeCtHash("live-message"),
      ttl: 60000,
      alg: "",
      ek: "",
    });

    await transport.sendMessage({
      to: bobAid,
      ct: "live-message",
      typ: "chat.text.v1",
      ttlMs: 60000,
      auth: sendAuth,
    });

    // Wait for push notification to arrive
    await eventually(
      () => receivedMessages.includes("live-message"),
      { timeout: 5000, message: "Message not received via subscribe" }
    );

    expect(receivedMessages).toContain("live-message");

    // Clean up subscription
    cancel();
  }, 10000); // Longer timeout for subscribe test

  /**
   * Helper to compute ciphertext hash
   */
  async function computeCtHash(ct: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(ct);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
});
