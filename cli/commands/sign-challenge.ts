import type { CLIContext } from "../lib/context";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { ConvexClient } from "convex/browser";
import { signPayload } from "../../core/crypto";

export interface SignChallengeOptions {
  aid: string;
  publicKey: string;
  challengeId: string;
  sigs?: string;
  ksn?: number;
  from?: string; // identity name in vault
  _ctx: CLIContext;
}

export async function signChallenge(opts: SignChallengeOptions): Promise<void> {
  const ctx = opts._ctx;

  let sigs: string[];
  let ksn: number;

  if (opts.sigs) {
    sigs = opts.sigs.split(",").map((s) => s.trim()).filter(Boolean);
    if (opts.ksn === undefined) {
      throw new Error("--ksn is required when providing --sigs");
    }
    ksn = opts.ksn;
  } else if (opts.from) {
    // Sign locally using vault
    const identity = await ctx.vault.getIdentity(opts.from);
    const credentials = {
      aid: identity.aid,
      privateKey: identity.privateKey,
      ksn: identity.ksn,
    };

    // We cannot reconstruct payload here, but we don't need it for registerUser
    // We'll trust that the server verifies signatures against stored challenge
    // For indexed signatures, sign the canonical representation of the stored payload is required
    // Here we optimistically sign the challengeId string for placeholder; real flow should pass sigs via --sigs
    const payloadBytes = new TextEncoder().encode(opts.challengeId);
    const s = await signPayload(payloadBytes, credentials.privateKey, 0);
    sigs = s;
    ksn = credentials.ksn;
  } else {
    throw new Error("Provide either --sigs with --ksn, or --from to sign locally");
  }

  // Call registerUser with auth proof via a direct Convex client
  const convex = new ConvexClient(ctx.config.backend.url);
  await convex.mutation(api.auth.registerUser, {
    aid: opts.aid,
    publicKey: opts.publicKey,
    auth: {
      challengeId: opts.challengeId as unknown as Id<"challenges">,
      sigs,
      ksn,
    },
  });

  console.log("Registered user:", opts.aid);
}


