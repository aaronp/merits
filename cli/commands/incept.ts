/**
 * incept Command
 *
 * Convenience command that performs the full user inception flow:
 * 1. Generate a new Ed25519 key pair
 * 2. Register the identity with the server
 * 3. Sign the registration challenge
 * 4. Confirm the challenge to obtain a session token
 *
 * Usage:
 *   merits incept
 *   merits incept --seed test123  # Deterministic (testing only)
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "aid": "<CESR-encoded AID>",
 *     "keys": {
 *       "privateKey": "<base64url>",
 *       "publicKey": "<base64url>"
 *     },
 *     "challenge": {
 *       "challengeId": "<id>",
 *       "payload": {...}
 *     },
 *     "session": {
 *       "token": "<session-token>",
 *       "aid": "<aid>",
 *       "expiresAt": <timestamp>
 *     }
 *   }
 */

import * as ed from '@noble/ed25519';
import { createAID, generateKeyPair, sha256, signPayloadWithSigner } from '../../core/crypto';
import { Ed25519Signer } from '../../core/Ed25519Signer';
import { getOrCreate as createMeritsClient } from '../../src/client/index';
import { saveProjectConfig } from '../lib/config';
import { type GlobalOptions, normalizeFormat, withGlobalOptions } from '../lib/options';

export interface InceptOptions extends GlobalOptions {
  seed?: string; // Deterministic seed for testing
}

/**
 * Perform full user inception flow
 *
 * @param opts Command options
 */
export const incept = withGlobalOptions(async (opts: InceptOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  // Step 1: Generate key pair
  let keys: any;
  if (opts.seed) {
    // Deterministic key generation for testing
    const seedBytes = new TextEncoder().encode(opts.seed);
    const seedHash = sha256(seedBytes);
    const publicKey = await ed.getPublicKeyAsync(seedHash);

    keys = {
      publicKey,
      privateKey: seedHash,
    };
  } else {
    // Random key generation
    keys = await generateKeyPair();
  }

  const aid = createAID(keys.publicKey);
  const publicKeyB64 = Buffer.from(keys.publicKey).toString('base64url');
  const privateKeyB64 = Buffer.from(keys.privateKey).toString('base64url');

  // Step 2: Create a temporary client with the new signer for registration
  // (incept doesn't have credentials yet, so ctx.client will be null)
  const signer = new Ed25519Signer(keys.privateKey, keys.publicKey);
  const tempClient = createMeritsClient(aid, signer, keys.privateKey, ctx.config);

  // Step 3: Register identity and get challenge
  const publicKeyBytes = Buffer.from(publicKeyB64, 'base64url');

  // Register key state first
  await tempClient.identityRegistry.registerIdentity({
    aid,
    publicKey: publicKeyBytes,
    ksn: 0,
  });

  // Issue challenge for user registration
  const args = { aid, publicKey: publicKeyB64 };
  const challenge = await tempClient.identityAuth.issueChallenge({
    aid,
    purpose: 'registerUser' as any,
    args,
    ttlMs: 120000, // 2 minutes
  });

  // Step 4: Sign the challenge using signer
  const sigs = await signPayloadWithSigner(challenge.payloadToSign, signer, 0);

  // Step 5: Register user and obtain session token
  let sessionResult: any;
  try {
    sessionResult = await tempClient.registerUser({
      aid,
      publicKey: publicKeyB64,
      challengeId: challenge.challengeId,
      sigs,
      ksn: 0,
    });
  } catch (err: any) {
    // If user already exists, provide helpful error message
    if (err.message && (err.message.includes('already exists') || err.message.includes('AlreadyExistsError'))) {
      throw new Error(
        `User ${aid} already exists. Use 'merits sign-in' command to create a new session token instead.`,
      );
    } else {
      throw err;
    }
  } finally {
    // Clean up temporary client
    tempClient.close();
  }

  // Build output
  const output = {
    aid,
    keys: {
      privateKey: privateKeyB64,
      publicKey: publicKeyB64,
    },
    challenge: {
      challengeId: challenge.challengeId,
      payload: challenge.payloadToSign,
    },
    session: {
      token: sessionResult.token,
      aid: sessionResult.aid,
      expiresAt: sessionResult.expiresAt,
    },
  };

  // Save to .merits file for easy reuse
  saveProjectConfig({
    backend: {
      type: ctx.config.backend.type,
      url: ctx.config.backend.url,
    },
    credentials: {
      aid,
      privateKey: privateKeyB64,
      publicKey: publicKeyB64,
      ksn: 0,
    },
  });

  // Output in requested format
  switch (format) {
    case 'json':
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(output));
      break;
    case 'pretty':
      console.log(JSON.stringify(output, null, 2));
      break;
    case 'raw':
      console.log(JSON.stringify(output));
      break;
  }

  // Hint for next step (only in pretty mode)
  if (format === 'pretty' && !opts.noBanner) {
    console.error('\n✅ User inception complete!');
    console.error('   Configuration saved to .merits file');
    console.error('   Session token obtained and ready to use.');
    console.error('\nNext steps:');
    console.error("  Run commands without credentials flag (e.g., 'merits status')");
    console.error('  Backend URL and credentials are now configured for this directory');
  }
});

/**
 * Canonicalize JSON according to RFC8785
 * - Sort object keys deterministically
 * - No whitespace
 */
function canonicalizeJSON(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJSON).join(',')}]`;
  }

  // Sort object keys
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((key) => {
    return `${JSON.stringify(key)}:${canonicalizeJSON(obj[key])}`;
  });

  return `{${entries.join(',')}}`;
}
