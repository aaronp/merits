/**
 * Integration test for allow/deny list access control
 *
 * Tests the full allow/deny list functionality:
 * - Adding/removing AIDs from allow-list
 * - Adding/removing AIDs from deny-list
 * - Priority rules (deny-list takes priority)
 * - Message filtering based on access control
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { MessageBusClient, type AuthCredentials } from "../../src/client";
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

describe("Allow/Deny List Integration", () => {
  let client: MessageBusClient;
  let convex: ConvexClient;
  let aliceKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let aliceAid: string;
  let aliceCreds: AuthCredentials;
  let bobKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let bobAid: string;
  let bobCreds: AuthCredentials;
  let carolKeys: { publicKey: Uint8Array; privateKey: Uint8Array };
  let carolAid: string;
  let carolCreds: AuthCredentials;

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

    // Setup Carol
    carolKeys = await generateKeyPair();
    carolAid = createAID(carolKeys.publicKey);
    const carolCesrKey = encodeCESRKey(carolKeys.publicKey);

    console.log("\n=== TEST SETUP ===");
    console.log("Alice AID:", aliceAid);
    console.log("Bob AID:", bobAid);
    console.log("Carol AID:", carolAid);

    // Register all key states
    await client.registerKeyState(aliceAid, 0, [aliceCesrKey], "1", "EAAA");
    await client.registerKeyState(bobAid, 0, [bobCesrKey], "1", "EBBB");
    await client.registerKeyState(carolAid, 0, [carolCesrKey], "1", "ECCC");

    // Bootstrap admin and permissions (if available)
    try {
      await convex.mutation(api._test_helpers.resetAdminRoles, {});
      await convex.mutation(api.authorization.bootstrapDefaultTiers, {});
      await convex.mutation(api._test_helpers.bootstrapSuperAdmin, { aid: bobAid });

      // Assign all users to "known" tier so they can message each other
      for (const aid of [aliceAid, bobAid, carolAid]) {
        await convex.mutation(api.authorization.assignTier, {
          aid,
          tierName: "known",
          promotionProof: "SYSTEM_ADMIN",
          notes: "Test user",
          auth: await client.createAuth(
            { aid: bobAid, privateKey: bobKeys.privateKey, ksn: 0 },
            "assign_tier",
            { aid, tierName: "known" }
          ),
        });
      }
    } catch (e) {
      console.log("⚠️  Skipping authorization setup (not available in this deployment)");
      console.log("   Tests will focus on access control without RBAC");
    }

    // Setup credentials
    aliceCreds = { aid: aliceAid, privateKey: aliceKeys.privateKey, ksn: 0 };
    bobCreds = { aid: bobAid, privateKey: bobKeys.privateKey, ksn: 0 };
    carolCreds = { aid: carolAid, privateKey: carolKeys.privateKey, ksn: 0 };
  });

  test("Deny-list: Block sender from sending messages", async () => {
    // 1. Add Alice to Bob's deny-list
    const addAuth = await client.createAuth(bobCreds, "addToDenyList", {
      deniedAid: aliceAid,
    });

    const addResult = await convex.mutation(api.denyList.add, {
      deniedAid: aliceAid,
      reason: "test block",
      auth: addAuth,
    });

    expect(addResult.added).toBe(true);

    // 2. Try to send message from Alice to Bob (should fail)
    try {
      await client.send(
        bobAid,
        "test message",
        aliceCreds,
        { ttl: 60000 }
      );
      expect.unreachable("Should have thrown error");
    } catch (err: any) {
      expect(err.message).toContain("Sender is on deny-list");
    }

    // 3. Remove Alice from Bob's deny-list
    const removeAuth = await client.createAuth(bobCreds, "removeFromDenyList", {
      deniedAid: aliceAid,
    });

    const removeResult = await convex.mutation(api.denyList.remove, {
      deniedAid: aliceAid,
      auth: removeAuth,
    });

    expect(removeResult.removed).toBe(true);

    // 4. Now Alice can send to Bob again
    const messageId = await client.send(
      bobAid,
      "message after unblock",
      aliceCreds,
      { ttl: 60000 }
    );

    expect(messageId).toBeDefined();
  });

  test("Allow-list: Default-deny mode (only allowed AIDs can send)", async () => {
    // 1. Add Carol to Bob's allow-list (activates default-deny)
    const addAuth = await client.createAuth(bobCreds, "addToAllowList", {
      allowedAid: carolAid,
    });

    const addResult = await convex.mutation(api.allowList.add, {
      allowedAid: carolAid,
      note: "test allow",
      auth: addAuth,
    });

    expect(addResult.added).toBe(true);

    // 2. Carol (on allow-list) can send to Bob
    const carolMessageId = await client.send(
      bobAid,
      "from allowed sender",
      carolCreds,
      { ttl: 60000 }
    );

    expect(carolMessageId).toBeDefined();

    // 3. Alice (not on allow-list) cannot send to Bob
    try {
      await client.send(
        bobAid,
        "from non-allowed sender",
        aliceCreds,
        { ttl: 60000 }
      );
      expect.unreachable("Should have thrown error");
    } catch (err: any) {
      expect(err.message).toContain("Sender not on allow-list");
    }

    // 4. Clear allow-list (deactivate default-deny)
    const clearAuth = await client.createAuth(bobCreds, "clearAllowList", {});

    const clearResult = await convex.mutation(api.allowList.clear, {
      auth: clearAuth,
    });

    expect(clearResult.removed).toBeGreaterThan(0);

    // 5. Alice can now send again
    const aliceMessageId = await client.send(
      bobAid,
      "after allow-list cleared",
      aliceCreds,
      { ttl: 60000 }
    );

    expect(aliceMessageId).toBeDefined();
  });

  test("Priority rules: Deny-list takes priority over allow-list", async () => {
    // 1. Add Alice to both allow-list and deny-list
    const allowAuth = await client.createAuth(bobCreds, "addToAllowList", {
      allowedAid: aliceAid,
    });

    await convex.mutation(api.allowList.add, {
      allowedAid: aliceAid,
      note: "test allow",
      auth: allowAuth,
    });

    const denyAuth = await client.createAuth(bobCreds, "addToDenyList", {
      deniedAid: aliceAid,
    });

    await convex.mutation(api.denyList.add, {
      deniedAid: aliceAid,
      reason: "test deny",
      auth: denyAuth,
    });

    // 2. Alice cannot send (deny wins over allow)
    try {
      await client.send(
        bobAid,
        "should be blocked",
        aliceCreds,
        { ttl: 60000 }
      );
      expect.unreachable("Should have thrown error");
    } catch (err: any) {
      expect(err.message).toContain("Sender is on deny-list");
    }

    // Cleanup: remove from both lists
    const removeDenyAuth = await client.createAuth(bobCreds, "removeFromDenyList", {
      deniedAid: aliceAid,
    });

    await convex.mutation(api.denyList.remove, {
      deniedAid: aliceAid,
      auth: removeDenyAuth,
    });

    const clearAllowAuth = await client.createAuth(bobCreds, "clearAllowList", {});

    await convex.mutation(api.allowList.clear, {
      auth: clearAllowAuth,
    });
  });

  test("List operations: Query allow/deny lists", async () => {
    // 1. Add multiple AIDs to Bob's lists
    const addAllow1 = await client.createAuth(bobCreds, "addToAllowList", {
      allowedAid: aliceAid,
    });

    await convex.mutation(api.allowList.add, {
      allowedAid: aliceAid,
      note: "alice",
      auth: addAllow1,
    });

    const addAllow2 = await client.createAuth(bobCreds, "addToAllowList", {
      allowedAid: carolAid,
    });

    await convex.mutation(api.allowList.add, {
      allowedAid: carolAid,
      note: "carol",
      auth: addAllow2,
    });

    const addDeny = await client.createAuth(bobCreds, "addToDenyList", {
      deniedAid: aliceAid,
    });

    await convex.mutation(api.denyList.add, {
      deniedAid: aliceAid,
      reason: "test",
      auth: addDeny,
    });

    // 2. Query allow-list
    const allowList = await convex.query(api.allowList.list, {
      ownerAid: bobAid,
    });

    expect(allowList.allowList.length).toBe(2);
    expect(allowList.isActive).toBe(true);
    expect(allowList.allowList.some((e: any) => e.aid === aliceAid)).toBe(true);
    expect(allowList.allowList.some((e: any) => e.aid === carolAid)).toBe(true);

    // 3. Query deny-list
    const denyList = await convex.query(api.denyList.list, {
      ownerAid: bobAid,
    });

    expect(denyList.denyList.length).toBe(1);
    expect(denyList.denyList[0].aid).toBe(aliceAid);
    expect(denyList.denyList[0].reason).toBe("test");

    // Cleanup
    const clearAllowAuth = await client.createAuth(bobCreds, "clearAllowList", {});
    await convex.mutation(api.allowList.clear, { auth: clearAllowAuth });

    const clearDenyAuth = await client.createAuth(bobCreds, "clearDenyList", {});
    await convex.mutation(api.denyList.clear, { auth: clearDenyAuth });
  });

  test("Message filtering: getUnread filters blocked senders", async () => {
    // 1. Send messages from Alice and Carol to Bob
    await client.send(bobAid, "from alice 1", aliceCreds, { ttl: 60000 });
    await client.send(bobAid, "from carol 1", carolCreds, { ttl: 60000 });

    // 2. Block Alice
    const denyAuth = await client.createAuth(bobCreds, "addToDenyList", {
      deniedAid: aliceAid,
    });

    await convex.mutation(api.denyList.add, {
      deniedAid: aliceAid,
      reason: "test",
      auth: denyAuth,
    });

    // 3. Send more messages
    try {
      await client.send(bobAid, "from alice 2 (blocked)", aliceCreds, { ttl: 60000 });
      expect.unreachable("Should have been blocked");
    } catch (err: any) {
      // Expected: Alice is blocked
      expect(err.message).toContain("Sender is on deny-list");
    }

    await client.send(bobAid, "from carol 2", carolCreds, { ttl: 60000 });

    // 4. Bob retrieves messages - should only see Carol's messages
    const messages = await convex.query(api.messages.getUnread, {
      aid: bobAid,
      includeGroupMessages: false,
    });

    // Should only see messages from Carol (Alice is blocked)
    const senders = messages.messages.map((m: any) => m.from);
    expect(senders.includes(carolAid)).toBe(true);
    expect(senders.includes(aliceAid)).toBe(false);

    // Cleanup
    const removeDenyAuth = await client.createAuth(bobCreds, "removeFromDenyList", {
      deniedAid: aliceAid,
    });

    await convex.mutation(api.denyList.remove, {
      deniedAid: aliceAid,
      auth: removeDenyAuth,
    });
  });
});
