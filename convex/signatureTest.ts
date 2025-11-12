/**
 * Signature Test Mutation
 * 
 * Isolated test endpoint to verify signature creation and verification.
 * This helps debug signature issues by providing a minimal test case.
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { verifyMutationSignature } from "../core/signatures";
import { decodeCESRKey } from "../core/crypto";
import { ensureKeyState } from "./auth";

/**
 * Test signature verification with detailed logging
 * 
 * This mutation accepts a simple payload and signature, then verifies it.
 * Returns detailed information about the verification process.
 */
export const testSignatureVerification = mutation({
  args: {
    // Simple test payload
    message: v.string(),
    // Signature metadata
    sig: v.object({
      keyId: v.string(),
      signature: v.string(),
      timestamp: v.number(),
      nonce: v.string(),
      signedFields: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    console.log('[TEST-SIG] Starting signature verification test');
    console.log('[TEST-SIG] Full args received:', JSON.stringify(args, null, 2));
    console.log('[TEST-SIG] Message:', args.message);
    console.log('[TEST-SIG] Sig object:', JSON.stringify(args.sig, null, 2));
    console.log('[TEST-SIG] Has sig field?', 'sig' in args);
    console.log('[TEST-SIG] Sig value:', args.sig);

    // Get key state for the signer
    const keyState = await ensureKeyState(ctx, args.sig.keyId);
    
    if (!keyState.keys[0]) {
      throw new Error(`No public key found for AID: ${args.sig.keyId}`);
    }

    const publicKeyCESR = keyState.keys[0];
    console.log('[TEST-SIG] Public key CESR:', publicKeyCESR);

    // Decode public key
    const publicKeyBytes = decodeCESRKey(publicKeyCESR);
    
    // Helper to convert Uint8Array to hex
    const uint8ArrayToHex = (bytes: Uint8Array): string => {
      return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    };
    
    console.log('[TEST-SIG] Public key bytes (hex):', uint8ArrayToHex(publicKeyBytes));

    // Build the full args object (matching what verifyMutationSignature expects)
    // verifyMutationSignature expects args to include the 'sig' field
    const fullArgs = {
      message: args.message,
      sig: args.sig,
    };

    // Log what we're about to verify
    console.log('[TEST-SIG] About to verify with fullArgs:', JSON.stringify(fullArgs, null, 2));
    
    // Verify signature
    try {
      const isValid = await verifyMutationSignature(
        fullArgs,
        publicKeyBytes,
        5 * 60 * 1000 // 5 minute window
      );

      console.log('[TEST-SIG] Verification result:', isValid);

      return {
        success: isValid,
        keyId: args.sig.keyId,
        publicKeyCESR,
        publicKeyHex: uint8ArrayToHex(publicKeyBytes),
        message: args.message,
        timestamp: args.sig.timestamp,
        nonce: args.sig.nonce,
      };
    } catch (error: any) {
      console.error('[TEST-SIG] Verification error:', error);
      return {
        success: false,
        error: error.message,
        keyId: args.sig.keyId,
        publicKeyCESR,
        publicKeyHex: uint8ArrayToHex(publicKeyBytes),
        message: args.message,
        timestamp: args.sig.timestamp,
        nonce: args.sig.nonce,
      };
    }
  },
});

