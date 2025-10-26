/**
 * Messaging Auth Tests
 *
 * Tests authentication flow for messaging commands
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { getAuthProof } from "../../../cli/lib/getAuthProof";
import type { MeritsClient } from "../../../src/client/types";
import type { MeritsVault } from "../../../cli/lib/vault/MeritsVault";
import type { Challenge } from "../../../core/interfaces/IdentityAuth";

describe("Messaging Auth Helper", () => {
  let mockClient: MeritsClient;
  let mockVault: MeritsVault;

  beforeEach(() => {
    // Mock client with identityAuth interface
    mockClient = {
      identityAuth: {
        issueChallenge: mock(async (req: any): Promise<Challenge> => {
          return {
            challengeId: "test-challenge-123",
            payloadToSign: {
              challengeId: "test-challenge-123",
              aid: req.aid,
              purpose: req.purpose,
              args: req.args,
              exp: Date.now() + 60000,
            },
          };
        }),
        verifyAuth: mock(async () => true),
      },
      transport: {} as any,
      group: {} as any,
      identityRegistry: {} as any,
      router: {} as any,
      createAuth: mock(async () => ({
        challengeId: "test",
        sigs: ["sig"],
        ksn: 0,
      })),
      computeArgsHash: mock(() => "hash"),
      computeCtHash: mock(() => "hash"),
      close: mock(() => {}),
    };

    // Mock vault
    mockVault = {
      getIdentity: mock(async (name: string) => ({
        aid: "test-aid-123",
        ksn: 0,
        metadata: { registered: true },
      })),
      signIndexed: mock(async (name: string, data: Uint8Array) => {
        return ["0-testsignature"];
      }),
    } as any;
  });

  test("creates auth proof for send operation", async () => {
    const proof = await getAuthProof({
      client: mockClient,
      vault: mockVault,
      identityName: "alice",
      purpose: "send",
      args: {
        to: "bob-aid",
        ctHash: "hash123",
        ttlMs: 86400000,
        alg: "",
        ek: "",
      },
    });

    expect(proof.challengeId).toBe("test-challenge-123");
    expect(proof.sigs).toEqual(["0-testsignature"]);
    expect(proof.ksn).toBe(0);

    // Verify issueChallenge was called with correct params
    expect(mockClient.identityAuth.issueChallenge).toHaveBeenCalledWith({
      aid: "test-aid-123",
      purpose: "send",
      args: {
        to: "bob-aid",
        ctHash: "hash123",
        ttlMs: 86400000,
        alg: "",
        ek: "",
      },
    });
  });

  test("creates auth proof for receive operation", async () => {
    const proof = await getAuthProof({
      client: mockClient,
      vault: mockVault,
      identityName: "alice",
      purpose: "receive",
      args: {
        for: "alice-aid",
      },
    });

    expect(proof.challengeId).toBeDefined();
    expect(proof.sigs).toHaveLength(1);

    // Verify challenge args
    expect(mockClient.identityAuth.issueChallenge).toHaveBeenCalledWith({
      aid: "test-aid-123",
      purpose: "receive",
      args: {
        for: "alice-aid",
      },
    });
  });

  test("creates auth proof for ack operation", async () => {
    const proof = await getAuthProof({
      client: mockClient,
      vault: mockVault,
      identityName: "alice",
      purpose: "ack",
      args: {
        messageId: "msg-123",
        for: "alice-aid",
      },
    });

    expect(proof.challengeId).toBeDefined();
    expect(proof.sigs).toHaveLength(1);

    // Verify challenge args
    expect(mockClient.identityAuth.issueChallenge).toHaveBeenCalledWith({
      aid: "test-aid-123",
      purpose: "ack",
      args: {
        messageId: "msg-123",
        for: "alice-aid",
      },
    });
  });

  test("uses vault.signIndexed (no key export)", async () => {
    const exportSpy = mock(() => {});
    (mockVault as any).exportPrivateKey = exportSpy;

    await getAuthProof({
      client: mockClient,
      vault: mockVault,
      identityName: "alice",
      purpose: "receive",
      args: { for: "alice-aid" },
    });

    // Verify signIndexed was called
    expect(mockVault.signIndexed).toHaveBeenCalled();

    // Verify exportPrivateKey was NOT called
    expect(exportSpy).not.toHaveBeenCalled();
  });

  test("uses client.identityAuth (not client.identity)", async () => {
    await getAuthProof({
      client: mockClient,
      vault: mockVault,
      identityName: "alice",
      purpose: "send",
      args: {
        to: "bob",
        ctHash: "hash",
        ttlMs: 1000,
        alg: "",
        ek: "",
      },
    });

    // Verify identityAuth.issueChallenge was called
    expect(mockClient.identityAuth.issueChallenge).toHaveBeenCalled();
  });
});
