/**
 * Core types for Merits message bus
 *
 * These types are backend-agnostic and can be used with any implementation
 * (Convex, Kafka, PostgreSQL, etc.)
 */

/**
 * Autonomic Identifier (AID) - A KERI decentralized identifier
 *
 * Format: CESR-encoded string starting with a derivation code
 * Examples: "Eabc123...", "Dxyz456..."
 *
 * - "D" prefix = Ed25519 non-transferable identifier (public key)
 * - "E" prefix = Blake3-256 digest (inception event SAID)
 */
export type AID = string;

/**
 * Indexed signature in KERI format
 *
 * Format: "<index>-<base64url_signature>"
 * Example: "0-5QbK7e..." means signature from key at index 0
 *
 * The index selects which key in the KeyState.keys array was used to sign.
 */
export type IndexedSig = string;

/**
 * Key State - Current cryptographic state of an AID
 *
 * Represents the controller's current key configuration at a specific
 * Key Sequence Number (KSN). Used for signature verification.
 */
export interface KeyState {
  /** The AID this key state belongs to */
  aid: AID;

  /** Key Sequence Number - increments on each rotation */
  ksn: number;

  /** Current signing keys (CESR-encoded) */
  keys: string[];

  /** Threshold of signatures required (hex string) */
  threshold: string;

  /** SAID of the last key event that established this state */
  lastEvtSaid: string;
}

/**
 * Authentication proof derived from challenge/response flow
 *
 * The client proves control of an AID by:
 * 1. Requesting a challenge for a specific purpose + args
 * 2. Signing the challenge payload with their current keys
 * 3. Submitting this proof with the actual operation
 */
export interface AuthProof {
  /** Server-issued challenge identifier */
  challengeId: string;

  /** Indexed signatures over the challenge payload */
  sigs: IndexedSig[];

  /** Key Sequence Number the client is using */
  ksn: number;
}

/**
 * Validate AID format
 *
 * Basic validation - checks for CESR prefix and minimum length.
 * Full validation would require parsing the CESR derivation code.
 */
export function isValidAID(s: string): boolean {
  // CESR identifiers: single-char derivation code + base64url
  return /^[A-Z][A-Za-z0-9_-]{7,}$/.test(s);
}

/**
 * Validate indexed signature format
 */
export function isIndexedSig(s: string): boolean {
  // Format: number-base64url
  return /^\d+-[A-Za-z0-9_-]+$/.test(s);
}

/**
 * Parse indexed signature into components
 */
export function parseIndexedSig(sig: IndexedSig): { index: number; signature: string } {
  const hyphenIndex = sig.indexOf("-");
  if (hyphenIndex === -1) {
    throw new Error(`Invalid indexed signature format: ${sig}`);
  }

  const index = parseInt(sig.substring(0, hyphenIndex), 10);
  const signature = sig.substring(hyphenIndex + 1);

  if (isNaN(index)) {
    throw new Error(`Invalid index in signature: ${sig}`);
  }

  return { index, signature };
}
