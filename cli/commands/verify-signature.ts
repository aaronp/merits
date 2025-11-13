/**
 * verify-signature Command - Verify Ed25519 signatures
 *
 * Usage:
 *   merits verify-signature --signed-file message.json
 *   cat message.json | merits verify-signature
 *
 * Input format (JSON):
 *   {
 *     "message": "Message text",
 *     "signature": "<base64url>",
 *     "publicKey": "<base64url>"
 *   }
 *
 * Output:
 *   {
 *     "valid": true/false
 *   }
 *
 * This is useful for:
 * - Verifying challenge-response signatures
 * - Testing signature creation/verification
 * - Debugging auth flows
 */

import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { type GlobalOptions, normalizeFormat } from '../lib/options';

export interface VerifySignatureOptions extends GlobalOptions {
  signedFile?: string;
}

export async function verifySignature(opts: VerifySignatureOptions): Promise<void> {
  // Load signed message
  let signedData: any;
  if (opts.signedFile) {
    signedData = JSON.parse(readFileSync(opts.signedFile, 'utf-8'));
  } else {
    // Read from stdin
    const stdinContent = await readStdin();
    signedData = JSON.parse(stdinContent);
  }

  const { message, signature, publicKey } = signedData;
  if (!message || !signature || !publicKey) {
    throw new Error("Signed file must contain 'message', 'signature', and 'publicKey' fields");
  }

  // Decode signature and public key
  const signatureBytes = base64UrlToUint8Array(signature);
  const publicKeyBytes = base64UrlToUint8Array(publicKey);

  // Verify signature
  const messageBytes = new TextEncoder().encode(message);
  const isValid = ed25519.verify(signatureBytes, messageBytes, publicKeyBytes);

  // Output result
  const result = { valid: isValid };

  const format = normalizeFormat(opts.format || 'json');

  if (format === 'json') {
    // RFC8785 canonicalized JSON
    const canonical = JSON.stringify(result, Object.keys(result).sort());
    console.log(canonical);
  } else if (format === 'pretty') {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === 'raw') {
    console.log(JSON.stringify(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = base64 + padding;
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
