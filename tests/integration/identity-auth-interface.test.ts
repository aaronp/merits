/**
 * IdentityAuth Interface Tests
 *
 * Tests the IdentityAuth contract using ConvexIdentityAuth adapter.
 * These tests verify that the Convex implementation satisfies the interface.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { ConvexIdentityAuth } from "../../src/adapters/ConvexIdentityAuth";
import { IdentityAuth } from "../../core/interfaces/IdentityAuth";
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

describe("IdentityAuth Interface (Convex implementation)", () => {
  let convex: ConvexClient;
  let auth: IdentityAuth;
  let aliceKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let aliceAid: string;

  beforeAll(async () => {
    convex = new ConvexClient(CONVEX_URL!);
    auth = new ConvexIdentityAuth(convex);

    // Generate test user
    aliceKeys = await generateKeyPair();
    aliceAid = createAID(aliceKeys.publicKey);

    // Register key state
    await convex.mutation(api.auth.registerKeyState, {
      aid: aliceAid,
      ksn: 0,
      keys: [encodeCESRKey(aliceKeys.publicKey)],
      threshold: "1",
      lastEvtSaid: "EAAA",
    });
  });

  afterAll(() => {
    convex.close();
  });

  test("issueChallenge returns well-formed payload", async () => {
    const result = await auth.issueChallenge({
      aid: aliceAid,
      purpose: "send",
      args: { to: "Ebob...", ctHash: "sha256:abc" },
    });

    expect(result.challengeId).toBeTruthy();
    expect(result.payloadToSign).toBeDefined();
    expect(result.payloadToSign.ver).toBe("msg-auth/1");
    expect(result.payloadToSign.aid).toBe(aliceAid);
    expect(result.payloadToSign.purpose).toBe("send");
    expect(result.payloadToSign.nonce).toBeTruthy();
    expect(result.payloadToSign.ts).toBeGreaterThan(0);
    expect(result.payloadToSign.argsHash).toBeTruthy();
  });

  test("issueChallenge with different purposes produces different payloads", async () => {
    const sendChallenge = await auth.issueChallenge({
      aid: aliceAid,
      purpose: "send",
      args: { test: "value" },
    });

    const receiveChallenge = await auth.issueChallenge({
      aid: aliceAid,
      purpose: "receive",
      args: { test: "value" },
    });

    expect(sendChallenge.payloadToSign.purpose).toBe("send");
    expect(receiveChallenge.payloadToSign.purpose).toBe("receive");
    // ArgsHash is the same (computed from args only), but purpose differs
    expect(sendChallenge.payloadToSign.argsHash).toBe(
      receiveChallenge.payloadToSign.argsHash
    );
    // But nonces are different (each challenge is unique)
    expect(sendChallenge.payloadToSign.nonce).not.toBe(
      receiveChallenge.payloadToSign.nonce
    );
  });

  test("issueChallenge with different args produces different argsHash", async () => {
    const challenge1 = await auth.issueChallenge({
      aid: aliceAid,
      purpose: "send",
      args: { to: "Ebob", ct: "msg1" },
    });

    const challenge2 = await auth.issueChallenge({
      aid: aliceAid,
      purpose: "send",
      args: { to: "Ebob", ct: "msg2" }, // Different args
    });

    expect(challenge1.payloadToSign.argsHash).not.toBe(
      challenge2.payloadToSign.argsHash
    );
  });

  test("challenge payload is deterministic (can be signed)", async () => {
    const challenge = await auth.issueChallenge({
      aid: aliceAid,
      purpose: "send",
      args: { to: "Ebob" },
    });

    // Verify we can canonicalize and sign the payload
    const canonical = JSON.stringify(
      challenge.payloadToSign,
      Object.keys(challenge.payloadToSign).sort()
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(canonical);
    const signature = await sign(data, aliceKeys.privateKey);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64); // Ed25519 signature length
  });

  test("verifyAuth throws error on client (server-side only)", async () => {
    await expect(
      auth.verifyAuth({
        proof: {
          challengeId: "test-id",
          sigs: ["0-signature"],
          ksn: 0,
        },
        expectedPurpose: "send",
        args: {},
      })
    ).rejects.toThrow("server-side only");
  });
});
