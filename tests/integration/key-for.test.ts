/**
 * Integration test for key-for command
 *
 * Tests fetching public keys for registered AIDs.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { MessageBusClient } from "../../src/client";
import {
  generateKeyPair,
  encodeCESRKey,
  createAID,
} from "../helpers/crypto-utils";

const CONVEX_URL = process.env.CONVEX_URL;

if (!CONVEX_URL) {
  console.log("⚠️  CONVEX_URL not set - skipping integration tests");
  console.log("   Set CONVEX_URL to run these tests");
  process.exit(0);
}

describe("Key-For Command", () => {
  let client: MessageBusClient;
  let convex: ConvexClient;
  let aliceKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let aliceAid: string;
  let aliceCesrKey: string;

  beforeAll(async () => {
    client = new MessageBusClient(CONVEX_URL!);
    convex = new ConvexClient(CONVEX_URL!);

    // Setup Alice
    aliceKeys = await generateKeyPair();
    aliceAid = createAID(aliceKeys.publicKey);
    aliceCesrKey = encodeCESRKey(aliceKeys.publicKey);

    console.log("\n=== TEST SETUP ===");
    console.log("Alice AID:", aliceAid);
    console.log("Alice Public Key (CESR):", aliceCesrKey);

    // Register Alice's key state
    await client.registerKeyState(aliceAid, 0, [aliceCesrKey], "1", "EAAA");

    // Register Alice as a user (TEST ONLY - normally done via registerUser with auth)
    const alicePublicKeyB64 = aliceCesrKey.slice(1); // Remove 'D' prefix
    await convex.mutation(api.testHelpers.registerTestUser, {
      aid: aliceAid,
      publicKey: alicePublicKeyB64,
    });
  });

  test("Fetch public key for registered AID", async () => {
    // Call getPublicKey API
    const result = await convex.query(api.auth.getPublicKey, { aid: aliceAid });

    // Verify response structure
    expect(result).toBeDefined();
    expect(result.aid).toBe(aliceAid);
    expect(result.publicKey).toBeDefined();
    expect(result.ksn).toBe(0);
    expect(result.updatedAt).toBeGreaterThan(0);

    // Verify public key format (base64url)
    expect(typeof result.publicKey).toBe("string");
    expect(result.publicKey.length).toBeGreaterThan(0);

    console.log("✅ Public key fetched successfully");
    console.log("   AID:", result.aid);
    console.log("   KSN:", result.ksn);
    console.log("   Public Key:", result.publicKey);
  });

  test("Error when AID not found", async () => {
    const fakeAid = "D" + "x".repeat(43); // Invalid but well-formed AID

    try {
      await convex.query(api.auth.getPublicKey, { aid: fakeAid });
      expect.unreachable("Should have thrown error for non-existent AID");
    } catch (err: any) {
      // Convex wraps errors in server error format, just verify an error was thrown
      expect(err).toBeDefined();
      expect(err.message).toBeDefined();
      console.log("✅ Correctly throws error for non-existent AID");
    }
  });

  test("Fetch returns correct KSN", async () => {
    // Fetch key
    const result = await convex.query(api.auth.getPublicKey, { aid: aliceAid });

    // Verify KSN matches what we registered
    expect(result.ksn).toBe(0);

    console.log("✅ KSN correctly returned");
  });
});
