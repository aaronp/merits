/**
 * encrypt Command - Standalone message encryption for testing
 *
 * Usage:
 *   merits encrypt --message "Hello" --public-key-file bob-key.json
 *   echo "Hello" | merits encrypt --public-key-file bob-key.json
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "ciphertext": "<base64url>",
 *     "ephemeralPublicKey": "<base64url>",
 *     "nonce": "<base64url>"
 *   }
 *
 * This command performs X25519 ECDH with an ephemeral key pair
 * and encrypts the message with AES-256-GCM.
 */

import { normalizeFormat, type GlobalOptions } from "../lib/options";
import {
  ed25519PublicKeyToX25519,
  deriveSharedSecret,
  encryptAESGCM,
} from "../lib/crypto-group";
import { x25519 } from "@noble/curves/ed25519.js";
import { readFileSync } from "fs";

export interface EncryptOptions extends GlobalOptions {
  message?: string;
  publicKeyFile: string;
}

export async function encrypt(opts: EncryptOptions): Promise<void> {
  // Get message content
  let plaintext: string;
  if (opts.message) {
    plaintext = opts.message;
  } else {
    // Read from stdin
    plaintext = await readStdin();
  }

  // Load recipient's public key from file
  const keyData = JSON.parse(readFileSync(opts.publicKeyFile, "utf-8"));
  const recipientPublicKeyB64 = keyData.publicKey;
  if (!recipientPublicKeyB64) {
    throw new Error("Public key file must contain 'publicKey' field");
  }

  // Decode public key (assuming base64url format)
  const recipientEd25519PublicKey = base64UrlToUint8Array(recipientPublicKeyB64);

  // Convert Ed25519 → X25519
  const recipientX25519PublicKey = ed25519PublicKeyToX25519(recipientEd25519PublicKey);

  // Generate ephemeral key pair
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

  // Derive shared secret
  const sharedSecret = await deriveSharedSecret(ephemeralPrivateKey, recipientX25519PublicKey);

  // Encrypt message
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const { ciphertext, nonce } = await encryptAESGCM(plaintextBytes, sharedSecret);

  // Clear ephemeral private key and shared secret from memory
  ephemeralPrivateKey.fill(0);
  sharedSecret.fill(0);

  // Output result
  const result = {
    ciphertext: uint8ArrayToBase64Url(ciphertext),
    ephemeralPublicKey: uint8ArrayToBase64Url(ephemeralPublicKey),
    nonce: uint8ArrayToBase64Url(nonce),
  };

  const format = normalizeFormat(opts.format || "json");

  if (format === "json") {
    // RFC8785 canonicalized JSON
    const canonical = JSON.stringify(result, Object.keys(result).sort());
    console.log(canonical);
  } else if (format === "pretty") {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === "raw") {
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
  return Buffer.concat(chunks).toString("utf-8").trim();
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
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
