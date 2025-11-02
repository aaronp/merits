/**
 * Simple integration test for allow/deny list API operations
 *
 * Tests just the list management APIs without full message flow.
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

describe("Allow/Deny List API Operations", () => {
  let client: MessageBusClient;
  let convex: ConvexClient;
  let aliceKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let aliceAid: string;
  let bobKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let bobAid: string;

  beforeAll(async () => {
    client = new MessageBusClient(CONVEX_URL!);
    convex = new ConvexClient(CONVEX_URL!);

    // Setup Alice
    aliceKeys = await generateKeyPair();
    aliceAid = createAID(aliceKeys.publicKey);
    const aliceCesrKey = encodeCESRKey(aliceKeys.publicKey);

    // Setup Bob
    bobKeys = await generateKeyPair();
    bobAid = createAID(bobKeys.publicKey);
    const bobCesrKey = encodeCESRKey(bobKeys.publicKey);

    console.log("\n=== TEST SETUP ===");
    console.log("Alice AID:", aliceAid);
    console.log("Bob AID:", bobAid);

    // Register key states with timeout
    try {
      await Promise.race([
        client.registerKeyState(aliceAid, 0, [aliceCesrKey], "1", "EAAA"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout registering Alice key state")), 10000)
        ),
      ]);

      await Promise.race([
        client.registerKeyState(bobAid, 0, [bobCesrKey], "1", "EBBB"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout registering Bob key state")), 10000)
        ),
      ]);

      console.log("✓ Key states registered successfully");
    } catch (error) {
      console.error("❌ Failed to register key states:", error);
      throw error;
    }
  }, 30000);

  test("Allow-list: Add, list, remove, clear", async () => {
    // 1. Initially empty
    let list = await convex.query(api.allowList.list, { ownerAid: aliceAid });
    expect(list.isActive).toBe(false);
    expect(list.allowList.length).toBe(0);

    // 2. Add Bob to Alice's allow-list
    const addAuth = await client.createAuth(
      { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 },
      "addToAllowList",
      { allowedAid: bobAid }
    );

    const addResult = await convex.mutation(api.allowList.add, {
      allowedAid: bobAid,
      note: "test note",
      auth: addAuth,
    });

    expect(addResult.added || addResult.alreadyExists).toBe(true);

    // 3. List should now show Bob
    list = await convex.query(api.allowList.list, { ownerAid: aliceAid });
    expect(list.isActive).toBe(true);
    expect(list.allowList.length).toBeGreaterThan(0);
    expect(list.allowList.some((e: any) => e.aid === bobAid)).toBe(true);

    // 4. Adding again should return alreadyExists
    const addAgainAuth = await client.createAuth(
      { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 },
      "addToAllowList",
      { allowedAid: bobAid }
    );

    const addAgainResult = await convex.mutation(api.allowList.add, {
      allowedAid: bobAid,
      auth: addAgainAuth,
    });

    expect(addAgainResult.alreadyExists).toBe(true);

    // 5. Remove Bob
    const removeAuth = await client.createAuth(
      { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 },
      "removeFromAllowList",
      { allowedAid: bobAid }
    );

    const removeResult = await convex.mutation(api.allowList.remove, {
      allowedAid: bobAid,
      auth: removeAuth,
    });

    expect(removeResult.removed).toBe(true);

    // 6. List should be empty again
    list = await convex.query(api.allowList.list, { ownerAid: aliceAid });
    expect(list.isActive).toBe(false);
    expect(list.allowList.length).toBe(0);

    console.log("✅ Allow-list operations passed");
  }, 20000);

  test("Deny-list: Add, list, remove, clear", async () => {
    // 1. Initially empty
    let list = await convex.query(api.denyList.list, { ownerAid: aliceAid });
    expect(list.denyList.length).toBe(0);

    // 2. Add Bob to Alice's deny-list
    const addAuth = await client.createAuth(
      { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 },
      "addToDenyList",
      { deniedAid: bobAid }
    );

    const addResult = await convex.mutation(api.denyList.add, {
      deniedAid: bobAid,
      reason: "test reason",
      auth: addAuth,
    });

    expect(addResult.added || addResult.alreadyExists).toBe(true);

    // 3. List should now show Bob
    list = await convex.query(api.denyList.list, { ownerAid: aliceAid });
    expect(list.denyList.length).toBeGreaterThan(0);
    expect(list.denyList.some((e: any) => e.aid === bobAid)).toBe(true);
    const bobEntry = list.denyList.find((e: any) => e.aid === bobAid);
    expect(bobEntry.reason).toBe("test reason");

    // 4. Adding again should return alreadyExists
    const addAgainAuth = await client.createAuth(
      { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 },
      "addToDenyList",
      { deniedAid: bobAid }
    );

    const addAgainResult = await convex.mutation(api.denyList.add, {
      deniedAid: bobAid,
      auth: addAgainAuth,
    });

    expect(addAgainResult.alreadyExists).toBe(true);

    // 5. Remove Bob
    const removeAuth = await client.createAuth(
      { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 },
      "removeFromDenyList",
      { deniedAid: bobAid }
    );

    const removeResult = await convex.mutation(api.denyList.remove, {
      deniedAid: bobAid,
      auth: removeAuth,
    });

    expect(removeResult.removed).toBe(true);

    // 6. List should be empty again
    list = await convex.query(api.denyList.list, { ownerAid: aliceAid });
    expect(list.denyList.length).toBe(0);

    console.log("✅ Deny-list operations passed");
  }, 20000);

  test("Clear operations: Remove all entries at once", async () => {
    // 1. Add multiple entries to both lists
    for (const aid of [bobAid, aliceAid]) {
      const allowAuth = await client.createAuth(
        { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 },
        "addToAllowList",
        { allowedAid: aid }
      );

      await convex.mutation(api.allowList.add, {
        allowedAid: aid,
        auth: allowAuth,
      });

      if (aid !== aliceAid) {
        const denyAuth = await client.createAuth(
          { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 },
          "addToDenyList",
          { deniedAid: aid }
        );

        await convex.mutation(api.denyList.add, {
          deniedAid: aid,
          auth: denyAuth,
        });
      }
    }

    // 2. Clear allow-list
    const clearAllowAuth = await client.createAuth(
      { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 },
      "clearAllowList",
      {}
    );

    const clearAllowResult = await convex.mutation(api.allowList.clear, {
      auth: clearAllowAuth,
    });

    expect(clearAllowResult.removed).toBeGreaterThan(0);

    const allowList = await convex.query(api.allowList.list, { ownerAid: aliceAid });
    expect(allowList.allowList.length).toBe(0);

    // 3. Clear deny-list
    const clearDenyAuth = await client.createAuth(
      { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 },
      "clearDenyList",
      {}
    );

    const clearDenyResult = await convex.mutation(api.denyList.clear, {
      auth: clearDenyAuth,
    });

    expect(clearDenyResult.removed).toBeGreaterThan(0);

    const denyList = await convex.query(api.denyList.list, { ownerAid: aliceAid });
    expect(denyList.denyList.length).toBe(0);

    console.log("✅ Clear operations passed");
  }, 30000);
});
