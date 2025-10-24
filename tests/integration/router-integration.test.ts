/**
 * Router Integration Test
 *
 * Tests the full flow: send → receive → route → handle
 * Demonstrates end-to-end message routing with the Transport and Router.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { ConvexTransport } from "../../convex/adapters/ConvexTransport";
import { ConvexIdentityAuth } from "../../convex/adapters/ConvexIdentityAuth";
import { createMessageRouter } from "../../core/runtime/router";
import { eventually, eventuallyValue } from "../helpers/eventually";
import {
  generateKeyPair,
  createAID,
  encodeCESRKey,
  sign,
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

    // Setup admins and onboard users
    await convex.mutation(api._test_helpers.resetAdminRoles, {});
    await convex.mutation(api._test_helpers.bootstrapSuperAdmin, {
      aid: aliceAid,
    });

    // Onboard both users
    const aliceAdminChallenge = await identityAuth.issueChallenge({
      aid: aliceAid,
      purpose: "admin",
      args: {
        action: "onboardUser",
        userAid: aliceAid,
        onboardingProof: "ETEST_ALICE",
      },
    });

    const aliceAdminSig = await sign(
      new TextEncoder().encode(
        JSON.stringify(
          aliceAdminChallenge.payloadToSign,
          Object.keys(aliceAdminChallenge.payloadToSign).sort()
        )
      ),
      aliceKeys.privateKey
    );

    await convex.mutation(api.authorization.onboardUser, {
      userAid: aliceAid,
      onboardingProof: "ETEST_ALICE",
      notes: "Test user",
      auth: {
        challengeId: aliceAdminChallenge.challengeId as any,
        sigs: [
          `0-${btoa(String.fromCharCode(...aliceAdminSig))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "")}`,
        ],
        ksn: 0,
      },
    });

    const bobAdminChallenge = await identityAuth.issueChallenge({
      aid: aliceAid,
      purpose: "admin",
      args: {
        action: "onboardUser",
        userAid: bobAid,
        onboardingProof: "ETEST_BOB",
      },
    });

    const bobAdminSig = await sign(
      new TextEncoder().encode(
        JSON.stringify(
          bobAdminChallenge.payloadToSign,
          Object.keys(bobAdminChallenge.payloadToSign).sort()
        )
      ),
      aliceKeys.privateKey
    );

    await convex.mutation(api.authorization.onboardUser, {
      userAid: bobAid,
      onboardingProof: "ETEST_BOB",
      notes: "Test user",
      auth: {
        challengeId: bobAdminChallenge.challengeId as any,
        sigs: [
          `0-${btoa(String.fromCharCode(...bobAdminSig))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "")}`,
        ],
        ksn: 0,
      },
    });
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
    const sendAuth1 = await createAuthProof(aliceAid, aliceKeys.privateKey, "send", {
      recpAid: bobAid,
      ctHash: await computeCtHash(mockEncrypt({ text: "Hello Bob!" })),
      ttl: 60000,
      alg: "",
      ek: "",
    });

    await transport.sendMessage({
      to: bobAid,
      ct: mockEncrypt({ text: "Hello Bob!" }),
      typ: "chat.text.v1",
      ttlMs: 60000,
      auth: sendAuth1,
    });

    const sendAuth2 = await createAuthProof(aliceAid, aliceKeys.privateKey, "send", {
      recpAid: bobAid,
      ctHash: await computeCtHash(mockEncrypt({ action: "ping", value: 42 })),
      ttl: 60000,
      alg: "",
      ek: "",
    });

    await transport.sendMessage({
      to: bobAid,
      ct: mockEncrypt({ action: "ping", value: 42 }),
      typ: "app.custom.v1",
      ttlMs: 60000,
      auth: sendAuth2,
    });

    // Bob receives and routes messages
    const receiveAuth = await createAuthProof(bobAid, bobKeys.privateKey, "receive", { recpAid: bobAid });

    const messages = await eventuallyValue(
      async () => {
        const msgs = await transport.receiveMessages({
          for: bobAid,
          auth: receiveAuth,
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
    const subscribeAuth = await createAuthProof(bobAid, bobKeys.privateKey, "receive", { recpAid: bobAid });

    const cancel = await transport.subscribe({
      for: bobAid,
      auth: subscribeAuth,
      onMessage: async (msg) => {
        // Route through router on each message
        await router.dispatch(
          { decrypt: async (m) => mockDecrypt(m.ct) },
          msg
        );
        return false; // Do not auto-ack (ack requires per-message auth)
      },
    });

    // Alice sends a live message
    const sendAuth = await createAuthProof(aliceAid, aliceKeys.privateKey, "send", {
      recpAid: bobAid,
      ctHash: await computeCtHash(mockEncrypt({ content: "Live update!" })),
      ttl: 60000,
      alg: "",
      ek: "",
    });

    await transport.sendMessage({
      to: bobAid,
      ct: mockEncrypt({ content: "Live update!" }),
      typ: "live.test.v1",
      ttlMs: 60000,
      auth: sendAuth,
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
   * Helper to create auth proof
   */
  async function createAuthProof(
    aid: string,
    privateKey: Uint8Array,
    purpose: "send" | "receive" | "ack",
    args: Record<string, unknown>
  ) {
    const challenge = await identityAuth.issueChallenge({
      aid,
      purpose,
      args,
    });

    const canonical = JSON.stringify(
      challenge.payloadToSign,
      Object.keys(challenge.payloadToSign).sort()
    );
    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);
    const signature = await sign(data, privateKey);

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

  /**
   * Compute ciphertext hash
   */
  async function computeCtHash(ct: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(ct);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
});
