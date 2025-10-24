/**
 * Group Integration Tests
 *
 * End-to-end flow:
 * 1. Alice creates a group with Bob and Carol
 * 2. Alice sends a message to the group
 * 3. Bob and Carol receive the message via server-side fanout
 * 4. Alice adds Dave to the group
 * 5. Bob (non-admin) tries to add Eve (should fail)
 * 6. Carol leaves the group
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { ConvexGroupApi } from "../../convex/adapters/ConvexGroupApi";
import { ConvexIdentityAuth } from "../../convex/adapters/ConvexIdentityAuth";
import { ConvexTransport } from "../../convex/adapters/ConvexTransport";
import { generateKeyPair, createAID, signPayload } from "../helpers/crypto-utils";
import { eventually, eventuallyValue } from "../helpers/eventually";
import type { AuthProof } from "../../core/types";

describe("Group Integration", () => {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL environment variable required for integration tests");
  }

  let client: ConvexClient;
  let groupApi: ConvexGroupApi;
  let identityAuth: ConvexIdentityAuth;
  let transport: ConvexTransport;

  // Test users
  let alice: { aid: string; privateKey: Uint8Array; ksn: number };
  let bob: { aid: string; privateKey: Uint8Array; ksn: number };
  let carol: { aid: string; privateKey: Uint8Array; ksn: number };
  let dave: { aid: string; privateKey: Uint8Array; ksn: number };

  beforeEach(async () => {
    client = new ConvexClient(convexUrl);
    groupApi = new ConvexGroupApi(client);
    identityAuth = new ConvexIdentityAuth(client);
    transport = new ConvexTransport(client);

    // Generate keys for test users
    const aliceKeys = await generateKeyPair();
    const bobKeys = await generateKeyPair();
    const carolKeys = await generateKeyPair();
    const daveKeys = await generateKeyPair();

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

    carol = {
      aid: createAID(carolKeys.publicKey),
      privateKey: carolKeys.privateKey,
      ksn: 0,
    };

    dave = {
      aid: createAID(daveKeys.publicKey),
      privateKey: daveKeys.privateKey,
      ksn: 0,
    };

    // Register key states
    await client.mutation(api.auth.registerKeyState, {
      aid: alice.aid,
      ksn: 0,
      keys: [aliceKeys.publicKeyCESR],
      threshold: "1",
      lastEvtSaid: "evt-alice-0",
    });

    await client.mutation(api.auth.registerKeyState, {
      aid: bob.aid,
      ksn: 0,
      keys: [bobKeys.publicKeyCESR],
      threshold: "1",
      lastEvtSaid: "evt-bob-0",
    });

    await client.mutation(api.auth.registerKeyState, {
      aid: carol.aid,
      ksn: 0,
      keys: [carolKeys.publicKeyCESR],
      threshold: "1",
      lastEvtSaid: "evt-carol-0",
    });

    await client.mutation(api.auth.registerKeyState, {
      aid: dave.aid,
      ksn: 0,
      keys: [daveKeys.publicKeyCESR],
      threshold: "1",
      lastEvtSaid: "evt-dave-0",
    });
  });

  afterEach(() => {
    client.close();
  });

  async function createAuthProof(
    user: { aid: string; privateKey: Uint8Array; ksn: number },
    purpose: string,
    args: Record<string, any>
  ): Promise<AuthProof> {
    const challenge = await identityAuth.issueChallenge({
      aid: user.aid,
      purpose: purpose as any,
      args,
    });

    const sigs = await signPayload(challenge.payloadToSign, user.privateKey, 0);

    return {
      challengeId: challenge.challengeId,
      sigs,
      ksn: user.ksn,
    };
  }

  test("create group and send message with fanout", async () => {
    // Alice creates a group with Bob and Carol
    const createAuth = await createAuthProof(alice, "manageGroup", {
      action: "createGroup",
      name: "Test Group",
      members: [bob.aid, carol.aid].sort(),
    });

    const { groupId } = await groupApi.createGroup({
      name: "Test Group",
      initialMembers: [bob.aid, carol.aid],
      auth: createAuth,
    });

    expect(groupId).toBeDefined();

    // Verify group was created
    const groups = await groupApi.listGroups({
      for: alice.aid,
      auth: createAuth, // Not actually verified by listGroups (it's a query)
    });

    expect(groups.length).toBe(1);
    expect(groups[0].name).toBe("Test Group");
    expect(groups[0].members.length).toBe(3); // Alice, Bob, Carol

    // Alice sends a message to the group
    const messageText = "Hello group!";
    const ct = Buffer.from(messageText).toString("base64");

    // Compute ctHash for auth binding
    const encoder = new TextEncoder();
    const data = encoder.encode(ct);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const ctHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const sendAuth = await createAuthProof(alice, "sendGroup", {
      groupId,
      ctHash,
      ttl: 24 * 60 * 60 * 1000,
    });

    const { messageId } = await groupApi.sendGroupMessage({
      groupId,
      ct,
      typ: "chat.text.v1",
      ttlMs: 24 * 60 * 60 * 1000,
      auth: sendAuth,
    });

    expect(messageId).toBeDefined();

    // Bob receives the message (server fanned out to Bob)
    const bobReceiveAuth = await createAuthProof(bob, "receive", {
      recpAid: bob.aid,
    });

    const bobMessages = await eventuallyValue(
      async () => {
        const messages = await transport.receiveMessages({
          for: bob.aid,
          auth: bobReceiveAuth,
        });
        return messages.length > 0 ? messages : undefined;
      },
      { timeout: 3000, message: "Bob did not receive group message" }
    );

    expect(bobMessages.length).toBe(1);
    expect(bobMessages[0].from).toBe(alice.aid);
    expect(bobMessages[0].ct).toBe(ct);
    expect(bobMessages[0].typ).toBe("chat.text.v1");

    // Carol receives the message (server fanned out to Carol)
    const carolReceiveAuth = await createAuthProof(carol, "receive", {
      recpAid: carol.aid,
    });

    const carolMessages = await eventuallyValue(
      async () => {
        const messages = await transport.receiveMessages({
          for: carol.aid,
          auth: carolReceiveAuth,
        });
        return messages.length > 0 ? messages : undefined;
      },
      { timeout: 3000, message: "Carol did not receive group message" }
    );

    expect(carolMessages.length).toBe(1);
    expect(carolMessages[0].from).toBe(alice.aid);
    expect(carolMessages[0].ct).toBe(ct);

    // Alice should NOT receive her own message
    const aliceReceiveAuth = await createAuthProof(alice, "receive", {
      recpAid: alice.aid,
    });

    const aliceMessages = await transport.receiveMessages({
      for: alice.aid,
      auth: aliceReceiveAuth,
    });

    expect(aliceMessages.length).toBe(0); // No self-send
  });

  test("add and remove members", async () => {
    // Alice creates a group
    const createAuth = await createAuthProof(alice, "manageGroup", {
      action: "createGroup",
      name: "Dynamic Group",
      members: [bob.aid].sort(),
    });

    const { groupId } = await groupApi.createGroup({
      name: "Dynamic Group",
      initialMembers: [bob.aid],
      auth: createAuth,
    });

    // Alice adds Dave
    const addAuth = await createAuthProof(alice, "manageGroup", {
      action: "addMembers",
      groupId,
      members: [dave.aid].sort(),
    });

    await groupApi.addMembers({
      groupId,
      members: [dave.aid],
      auth: addAuth,
    });

    // Verify Dave is now a member
    await eventually(
      async () => {
        const groups = await groupApi.listGroups({
          for: dave.aid,
          auth: addAuth, // Not verified
        });
        return groups.some((g) => g.id === groupId);
      },
      { timeout: 3000, message: "Dave not added to group" }
    );

    // Bob (non-admin) tries to remove Dave - should fail
    const bobRemoveAuth = await createAuthProof(bob, "manageGroup", {
      action: "removeMembers",
      groupId,
      members: [dave.aid].sort(),
    });

    await expect(
      groupApi.removeMembers({
        groupId,
        members: [dave.aid],
        auth: bobRemoveAuth,
      })
    ).rejects.toThrow(/Only admins or owners can remove members/);
  });

  test("leave group", async () => {
    // Alice creates a group
    const createAuth = await createAuthProof(alice, "manageGroup", {
      action: "createGroup",
      name: "Leave Test",
      members: [bob.aid, carol.aid].sort(),
    });

    const { groupId } = await groupApi.createGroup({
      name: "Leave Test",
      initialMembers: [bob.aid, carol.aid],
      auth: createAuth,
    });

    // Carol leaves the group
    const leaveAuth = await createAuthProof(carol, "manageGroup", {
      action: "leaveGroup",
      groupId,
    });

    await groupApi.leaveGroup({
      groupId,
      auth: leaveAuth,
    });

    // Verify Carol is no longer a member
    await eventually(
      async () => {
        const groups = await groupApi.listGroups({
          for: carol.aid,
          auth: leaveAuth,
        });
        return !groups.some((g) => g.id === groupId);
      },
      { timeout: 3000, message: "Carol still in group after leaving" }
    );

    // Alice (last owner) cannot leave
    const aliceLeaveAuth = await createAuthProof(alice, "manageGroup", {
      action: "leaveGroup",
      groupId,
    });

    await expect(
      groupApi.leaveGroup({
        groupId,
        auth: aliceLeaveAuth,
      })
    ).rejects.toThrow(/Last owner cannot leave/);
  });
});
