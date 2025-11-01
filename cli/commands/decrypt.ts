/**
 * decrypt Command - Standalone message decryption for testing
 *
 * Usage:
 *   merits decrypt --encrypted-file message.json --keys-file my-keys.json
 *   cat message.json | merits decrypt --keys-file my-keys.json
 *
 * Input format (JSON):
 *   {
 *     "ciphertext": "<base64url>",
 *     "ephemeralPublicKey": "<base64url>",
 *     "nonce": "<base64url>"
 *   }
 *
 * Keys file format (JSON):
 *   {
 *     "privateKey": "<base64url>",
 *     "publicKey": "<base64url>"
 *   }
 *
 * Output: Decrypted plaintext message
 */

import { normalizeFormat, type GlobalOptions } from "../lib/options";
import {
  ed25519PrivateKeyToX25519,
  deriveSharedSecret,
  decryptAESGCM,
} from "../lib/crypto-group";
import { readFileSync } from "fs";

export interface DecryptOptions extends GlobalOptions {
  encryptedFile?: string;
  keysFile: string;
}

export async function decrypt(opts: DecryptOptions): Promise<void> {
  // Load encrypted message
  let encryptedData: any;
  if (opts.encryptedFile) {
    encryptedData = JSON.parse(readFileSync(opts.encryptedFile, "utf-8"));
  } else {
    // Read from stdin
    const stdinContent = await readStdin();
    encryptedData = JSON.parse(stdinContent);
  }

  const { ciphertext, ephemeralPublicKey, nonce } = encryptedData;
  if (!ciphertext || !ephemeralPublicKey || !nonce) {
    throw new Error("Encrypted file must contain 'ciphertext', 'ephemeralPublicKey', and 'nonce' fields");
  }

  // Load our keys
  const keysData = JSON.parse(readFileSync(opts.keysFile, "utf-8"));
  const ourPrivateKeyB64 = keysData.privateKey;
  if (!ourPrivateKeyB64) {
    throw new Error("Keys file must contain 'privateKey' field");
  }

  // Decode keys
  const ourEd25519PrivateKey = base64UrlToUint8Array(ourPrivateKeyB64);
  const ephemeralX25519PublicKey = base64UrlToUint8Array(ephemeralPublicKey);

  // Convert our Ed25519 private key → X25519
  // Note: ephemeralPublicKey is already X25519 (not Ed25519), so no conversion needed
  const ourX25519PrivateKey = ed25519PrivateKeyToX25519(ourEd25519PrivateKey);

  // Derive shared secret
  const sharedSecret = await deriveSharedSecret(ourX25519PrivateKey, ephemeralX25519PublicKey);

  // Decrypt message
  const ciphertextBytes = base64UrlToUint8Array(ciphertext);
  const nonceBytes = base64UrlToUint8Array(nonce);
  const plaintextBytes = await decryptAESGCM(ciphertextBytes, sharedSecret, nonceBytes);

  // Clear sensitive data from memory
  ourX25519PrivateKey.fill(0);
  sharedSecret.fill(0);

  // Output plaintext
  const plaintext = new TextDecoder().decode(plaintextBytes);

  const format = normalizeFormat(opts.format || "json");

  if (format === "json") {
    // RFC8785 canonicalized JSON
    const result = { plaintext };
    const canonical = JSON.stringify(result, Object.keys(result).sort());
    console.log(canonical);
  } else if (format === "pretty") {
    console.log(JSON.stringify({ plaintext }, null, 2));
  } else if (format === "raw") {
    // Raw mode outputs just the plaintext (no JSON wrapper)
    console.log(plaintext);
  } else {
    console.log(JSON.stringify({ plaintext }, null, 2));
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
  return Buffer.concat(chunks).toString("utf-8").trim();
}

function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = base64 + padding;
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
