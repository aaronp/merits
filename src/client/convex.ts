/**
 * Convex Implementation of MeritsClient
 *
 * Adapts the Convex backend to the backend-agnostic MeritsClient interface
 */

import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { ConvexIdentityAuth } from "../../convex/adapters/ConvexIdentityAuth";
import { ConvexTransport } from "../../convex/adapters/ConvexTransport";
import { ConvexGroupApi } from "../../convex/adapters/ConvexGroupApi";
import { createMessageRouter } from "../../core/runtime/router";
import { computeArgsHash, signPayload, sha256Hex } from "../../core/crypto";
import type { MeritsClient, IdentityRegistry, AuthCredentials } from "./types";
import type { AuthProof } from "../../core/types";

/**
 * Convex-specific implementation of IdentityRegistry
 */
class ConvexIdentityRegistry implements IdentityRegistry {
  constructor(private convex: ConvexClient) {}

  async registerIdentity(req: {
    aid: string;
    publicKey: Uint8Array;
    ksn: number;
  }): Promise<void> {
    // In our testing setup, AID === public key with 'D' prefix
    // So we just use the AID directly (it's already in CESR format)
    await this.convex.mutation(api.auth.registerKeyState, {
      aid: req.aid,
      ksn: req.ksn,
      keys: [req.aid], // AID is the public key in CESR format
      threshold: "1",
      lastEvtSaid: "", // Empty for initial registration
    });
  }

  async rotateKeys(req: {
    aid: string;
    oldKsn: number;
    newKsn: number;
    newPublicKey: Uint8Array;
    rotationProofSigs: string[];
  }): Promise<void> {
    // Convert new public key to CESR format
    const publicKeyBase64url = this.uint8ArrayToBase64Url(req.newPublicKey);
    const publicKeyCESR = `B${publicKeyBase64url}`;

    // Call rotation mutation (to be implemented on Convex backend)
    await this.convex.mutation(api.auth.rotateKeyState, {
      aid: req.aid,
      oldKsn: req.oldKsn,
      newKsn: req.newKsn,
      newKeys: [publicKeyCESR],
      threshold: "1",
      rotationProofSigs: req.rotationProofSigs,
    });
  }

  async getPublicKey(aid: string): Promise<{ publicKey: Uint8Array; ksn: number }> {
    // Query the key state from backend
    const keyState = await this.convex.query(api.auth.getKeyState, { aid });

    if (!keyState) {
      throw new Error(`Identity not found: ${aid}`);
    }

    // In our testing setup, AID === public key with 'D' prefix
    // The key is stored as the AID itself
    const publicKeyCESR = keyState.keys[0];
    if (!publicKeyCESR || !publicKeyCESR.startsWith("D")) {
      throw new Error(`Invalid public key format for ${aid}`);
    }

    const publicKeyBase64url = publicKeyCESR.slice(1); // Remove 'D' prefix
    const publicKey = this.base64UrlToUint8Array(publicKeyBase64url);

    return {
      publicKey,
      ksn: keyState.ksn,
    };
  }

  private uint8ArrayToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  private base64UrlToUint8Array(base64url: string): Uint8Array {
    // Convert base64url back to standard base64
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

/**
 * Convex implementation of MeritsClient
 */
export class ConvexMeritsClient implements MeritsClient {
  private convex: ConvexClient;
  public identityAuth: ConvexIdentityAuth;
  public transport: ConvexTransport;
  public group: ConvexGroupApi;
  public identityRegistry: IdentityRegistry;
  public router: ReturnType<typeof createMessageRouter>;

  constructor(convexUrl: string) {
    this.convex = new ConvexClient(convexUrl);
    this.identityAuth = new ConvexIdentityAuth(this.convex);
    this.transport = new ConvexTransport(this.convex);
    this.group = new ConvexGroupApi(this.convex);
    this.identityRegistry = new ConvexIdentityRegistry(this.convex);
    this.router = createMessageRouter();
  }

  /** Get access to the underlying Convex client for direct mutations/queries */
  get connection(): ConvexClient {
    return this.convex;
  }

  async createAuth(
    credentials: AuthCredentials,
    purpose: string,
    args: Record<string, any>
  ): Promise<AuthProof> {
    const argsHash = computeArgsHash(args);
    const challenge = await this.identityAuth.issueChallenge({
      aid: credentials.aid,
      purpose: purpose as any,
      args,
    });
    const sigs = await signPayload(
      challenge.payloadToSign,
      credentials.privateKey,
      0
    );

    return {
      challengeId: challenge.challengeId,
      sigs,
      ksn: credentials.ksn,
    };
  }

  computeArgsHash(args: Record<string, any>): string {
    return computeArgsHash(args);
  }

  computeCtHash(ct: string): string {
    const encoder = new TextEncoder();
    const data = encoder.encode(ct);
    return sha256Hex(data);
  }

  async registerUser(req: {
    aid: string;
    publicKey: string;
    challengeId: string;
    sigs: string[];
    ksn: number;
  }): Promise<import("./types").SessionToken> {
    // Call backend registerUser mutation
    await this.convex.mutation(api.auth.registerUser, {
      aid: req.aid,
      publicKey: req.publicKey,
      auth: {
        challengeId: req.challengeId as any,
        sigs: req.sigs,
        ksn: req.ksn,
      },
    });

    // TODO: Backend should return actual session token
    // For now, generate placeholder until session token system is implemented
    return {
      token: `session_${req.aid}_${Date.now()}`,
      aid: req.aid,
      expiresAt: Date.now() + 3600000, // 1 hour
      ksn: req.ksn,
    };
  }

  async getUserStatus(aid: string): Promise<import("./types").UserStatus> {
    // Query user status from backend
    const status = await this.convex.query(api.userStatus.getUserStatus, { aid });
    return status;
  }

  close(): void {
    this.convex.close();
  }
}
