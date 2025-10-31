import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { generateKeyPair, createAID, signPayload, computeArgsHash, encodeCESRKey } from "../helpers/crypto-utils";

describe("Onboarding bootstrap with anon role permissions", () => {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL environment variable required for integration tests");
  }

  let client: ConvexClient;
  let anon: { aid: string; privateKey: Uint8Array; ksn: number; publicKeyCESR: string };
  let onboardingGroupId: any;

  beforeAll(async () => {
    client = new ConvexClient(convexUrl);

    // Generate anon user
    const keys = await generateKeyPair();
    anon = {
      aid: createAID(keys.publicKey),
      privateKey: keys.privateKey,
      publicKeyCESR: keys.publicKeyCESR,
      ksn: 0,
    };

    // Register key state
    await client.mutation(api.auth.registerKeyState, {
      aid: anon.aid,
      ksn: 0,
      keys: [encodeCESRKey(keys.publicKey)],
      threshold: "1",
      lastEvtSaid: `evt-${anon.aid.slice(0,8)}-0`,
    });

    // Bootstrap onboarding
    const res = await client.mutation(api.authorization_bootstrap.bootstrapOnboarding, {} as any);
    onboardingGroupId = res.onboardingGroupId;
  });

  afterAll(() => {
    client.close();
  });

  async function createAuth(purpose: string, args: Record<string, any>) {
    const argsHash = computeArgsHash(args);
    const ch = await client.mutation(api.auth.issueChallenge, {
      aid: anon.aid,
      purpose,
      argsHash,
    });
    const sigs = await signPayload(ch.payload, anon.privateKey, 0);
    return { challengeId: ch.challengeId, sigs, ksn: anon.ksn };
  }

  test("anon can send to onboarding group without membership", async () => {
    const auth = await createAuth("sendGroupMessage", {
      groupChatId: onboardingGroupId,
      messageType: "text",
    });

    const res = await client.mutation(api.groups.sendGroupMessage, {
      groupChatId: onboardingGroupId,
      encryptedMessage: "encrypted:hello-onboarding",
      messageType: "text",
      auth,
    });

    expect(res.seqNo).toBe(0);
  });

  test("anon cannot read onboarding group (not a member)", async () => {
    await expect(
      client.query(api.groups.getGroupMessages, {
        groupChatId: onboardingGroupId,
        callerAid: anon.aid,
      })
    ).rejects.toThrow();
  });
});


