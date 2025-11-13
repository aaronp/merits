/**
 * create-user Command
 *
 * Create a registration challenge for a new user.
 *
 * Usage:
 *   merits gen-key > alice-keys.json
 *   export AID=$(jq -r '.aid' alice-keys.json)
 *   export PUBLIC_KEY=$(jq -r '.publicKey' alice-keys.json)
 *   merits create-user --id ${AID} --public-key ${PUBLIC_KEY} > challenge.json
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "challengeId": "<id>",
 *     "payload": {...},
 *     "purpose": "registerUser"
 *   }
 */

import { type GlobalOptions, normalizeFormat, withGlobalOptions } from '../lib/options';

export interface CreateUserOptions extends GlobalOptions {
  id: string; // User AID
  publicKey: string; // Base64url-encoded public key
}

/**
 * Create registration challenge for new user
 *
 * @param opts Command options
 */
export const createUser = withGlobalOptions(async (opts: CreateUserOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  if (!opts.id || !opts.publicKey) {
    throw new Error('Both --id and --public-key are required');
  }

  const args = { aid: opts.id, publicKey: opts.publicKey };

  // Convert base64url public key to Uint8Array
  const publicKeyBytes = Buffer.from(opts.publicKey, 'base64url');

  // Register key state first (required before issuing challenge)
  await ctx.client.identityRegistry.registerIdentity({
    aid: opts.id,
    publicKey: publicKeyBytes,
    ksn: 0,
  });

  // Issue challenge for user registration
  const challenge = await ctx.client.identityAuth.issueChallenge({
    aid: opts.id,
    purpose: 'registerUser' as any,
    args,
    ttlMs: 120000, // 2 minutes to complete challenge
  });

  const output = {
    challengeId: challenge.challengeId,
    payload: challenge.payloadToSign,
    purpose: 'registerUser',
    args,
  };

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
    console.error('\nNext steps:');
    console.error('  1. Sign the challenge:');
    console.error('     merits sign --file challenge.json --keys alice-keys.json > challenge-response.json');
    console.error('  2. Confirm the challenge:');
    console.error('     merits confirm-challenge --file challenge-response.json > session-token.json');
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
