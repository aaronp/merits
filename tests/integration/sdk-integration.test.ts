/**
 * SDK Integration Test
 *
 * End-to-end test using the unified createMeritsClient() API
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMeritsClient, type AuthCredentials } from "../../src/client";
import { generateKeyPair, createAID } from "../../core/crypto";
import { api } from "../../convex/_generated/api";
import { eventually, eventuallyValue } from "../helpers/eventually";

describe("SDK Integration", () => {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL environment variable required");
  }

  let client: ReturnType<typeof createMeritsClient>;
  let alice: AuthCredentials;
  let bob: AuthCredentials;

  beforeEach(async () => {
    client = createMeritsClient(convexUrl);

    // Generate keys
    const aliceKeys = await generateKeyPair();
    const bobKeys = await generateKeyPair();

    alice = {
      aid: createAID(aliceKeys.publicKey),
      privateKey: aliceKeys.privateKey,
      ksn: 0,
    };

    bob = {
      aid: createAID(bobKeys.publicKey),
      privateKey: bobKeys.privateKey,
      ksn: 0,
    };

    // Register key states (using direct Convex mutation for setup)
    const convex = (client as any).identity.client; // Access underlying client
    await convex.mutation(api.auth.registerKeyState, {
      aid: alice.aid,
      ksn: 0,
      keys: [aliceKeys.publicKeyCESR],
      threshold: "1",
      lastEvtSaid: "evt-alice-0",
    });

    await convex.mutation(api.auth.registerKeyState, {
      aid: bob.aid,
      ksn: 0,
      keys: [bobKeys.publicKeyCESR],
      threshold: "1",
      lastEvtSaid: "evt-bob-0",
    });

    // Bootstrap Alice as super admin and onboard both users
    await convex.mutation(api._test_helpers.resetAdminRoles, {});
    await convex.mutation(api._test_helpers.bootstrapSuperAdmin, {
      aid: alice.aid,
    });

    // Also whitelist Bob as an onboarding admin to allow messages from unknown users
    // This ensures sends succeed even if tier writes are delayed in some environments
    await convex.mutation(api.authorization.addOnboardingAdmin, {
      aid: bob.aid,
      description: "SDK test onboarding admin",
      auth: await client.createAuth(alice, "admin", {
        action: "addOnboardingAdmin",
        aid: bob.aid,
      }),
    });

    // Onboard Alice herself
    await convex.mutation(api.authorization.onboardUser, {
      userAid: alice.aid,
      onboardingProof: "ETEST_PROOF_ALICE",
      notes: "Test admin user",
      auth: await client.createAuth(alice, "admin", {
        action: "onboardUser",
        userAid: alice.aid,
        onboardingProof: "ETEST_PROOF_ALICE",
      }),
    });

    // Onboard Bob so he can receive messages
    await convex.mutation(api.authorization.onboardUser, {
      userAid: bob.aid,
      onboardingProof: "ETEST_PROOF_BOB",
      notes: "Test user",
      auth: await client.createAuth(alice, "admin", {
        action: "onboardUser",
        userAid: bob.aid,
        onboardingProof: "ETEST_PROOF_BOB",
      }),
    });
  });

  afterEach(() => {
    client.close();
  });

  test("send and receive message using unified SDK", async () => {
    // Alice sends a message to Bob
    const ct = Buffer.from("Hello Bob!").toString("base64");
    const ctHash = client.computeCtHash(ct);

    const sendAuth = await client.createAuth(alice, "send", {
      recpAid: bob.aid,
      ctHash,
      ttl: 60000,
      alg: "",
      ek: "",
    });

    const { messageId } = await client.transport.sendMessage({
      to: bob.aid,
      ct,
      typ: "chat.text.v1",
      ttlMs: 60000,
      auth: sendAuth,
    });

    expect(messageId).toBeDefined();

    // Give the message a moment to be stored
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Bob receives the message
    const receiveAuth = await client.createAuth(bob, "receive", {
      recpAid: bob.aid,
    });

    const messages = await eventuallyValue(
      async () => {
        const msgs = await client.transport.receiveMessages({
          for: bob.aid,
          auth: receiveAuth,
        });
        return msgs.length > 0 ? msgs : undefined;
      },
      { timeout: 10000, interval: 500 }
    );

    expect(messages).toBeDefined();
    expect(messages!.length).toBe(1);
    expect(messages![0].from).toBe(alice.aid);
    expect(messages![0].ct).toBe(ct);
    expect(messages![0].typ).toBe("chat.text.v1");
  });

  test("use router to dispatch messages", async () => {
    // Set up router
    const handled: any[] = [];
    client.router.register("chat.text.v1", (msg, plaintext) => {
      handled.push({ msg, plaintext });
    });

    // Alice sends a message
    const messageText = "Hello via router!";
    const ct = Buffer.from(JSON.stringify({ text: messageText })).toString(
      "base64"
    );
    const ctHash = client.computeCtHash(ct);

    const sendAuth = await client.createAuth(alice, "send", {
      recpAid: bob.aid,
      ctHash,
      ttl: 60000,
      alg: "",
      ek: "",
    });

    await client.transport.sendMessage({
      to: bob.aid,
      ct,
      typ: "chat.text.v1",
      ttlMs: 60000,
      auth: sendAuth,
    });

    // Bob receives and routes the message
    const receiveAuth = await client.createAuth(bob, "receive", {
      recpAid: bob.aid,
    });

    await eventually(
      async () => {
        const messages = await client.transport.receiveMessages({
          for: bob.aid,
          auth: receiveAuth,
        });

        for (const msg of messages) {
          // Decode message
          const plaintext = JSON.parse(Buffer.from(msg.ct, "base64").toString());

          // Dispatch to router
          await client.router.dispatch(
            {
              decrypt: async (encrypted) => plaintext,
            },
            msg
          );
        }

        return handled.length > 0;
      },
      { timeout: 3000 }
    );

    expect(handled.length).toBe(1);
    expect(handled[0].plaintext.text).toBe(messageText);
  });

  test("create group using SDK", async () => {
    const createAuth = await client.createAuth(alice, "manageGroup", {
      action: "createGroup",
      name: "SDK Test Group",
      members: [bob.aid].sort(),
    });

    const { groupId } = await client.group.createGroup({
      name: "SDK Test Group",
      initialMembers: [bob.aid],
      auth: createAuth,
    });

    expect(groupId).toBeDefined();

    // List groups for Alice
    const groups = await client.group.listGroups({
      for: alice.aid,
      auth: createAuth, // Not verified for queries
    });

    expect(groups.length).toBeGreaterThan(0);
    expect(groups.some((g) => g.id === groupId)).toBe(true);
  });

  test("helper functions work correctly", () => {
    // computeArgsHash
    const hash1 = client.computeArgsHash({ a: 1, b: 2 });
    const hash2 = client.computeArgsHash({ b: 2, a: 1 });
    expect(hash1).toBe(hash2);

    // computeCtHash
    const ct = "test content";
    const ctHash = client.computeCtHash(ct);
    expect(ctHash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(ctHash)).toBe(true);
  });
});
