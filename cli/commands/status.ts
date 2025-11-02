/**
 * status Command
 *
 * Display comprehensive user status including:
 * - User's role(s)
 * - Current group memberships
 * - Public key on record
 * - Session token TTL
 *
 * Usage:
 *   merits status
 *   merits status --token /path/to/session.json
 *   merits status --format pretty
 *
 * Output (RFC8785 canonicalized JSON):
 *   {
 *     "aid": "<user-aid>",
 *     "roles": ["role1", "role2"],
 *     "groups": [
 *       {
 *         "groupId": "...",
 *         "groupName": "...",
 *         "role": "member|admin|owner",
 *         "joinedAt": <timestamp>
 *       }
 *     ],
 *     "publicKey": "<base64url-public-key>",
 *     "publicKeyKsn": 0,
 *     "session": {
 *       "expiresAt": <timestamp>,
 *       "expiresIn": <milliseconds>,
 *       "isValid": true|false
 *     }
 *   }
 */

import { withGlobalOptions, normalizeFormat, type GlobalOptions } from "../lib/options";
import { requireSessionToken } from "../lib/session";

export interface StatusOptions extends GlobalOptions {
  // No additional options - uses global --token option
}

/**
 * Display comprehensive user status
 *
 * @param opts Command options
 */
export const status = withGlobalOptions(async (opts: StatusOptions) => {
  const format = normalizeFormat(opts.format);
  const ctx = opts._ctx;

  // Load and validate session token
  const session = requireSessionToken(opts.token);

  // Fetch comprehensive user status from backend
  const userStatus = await ctx.client.getUserStatus(session.aid);

  // Calculate session TTL
  const now = Date.now();
  const expiresIn = session.expiresAt - now;
  const isValid = expiresIn > 0;

  // Build comprehensive output
  const output = {
    aid: session.aid,
    roles: userStatus.roles,
    groups: userStatus.groups,
    publicKey: userStatus.publicKey,
    publicKeyKsn: userStatus.publicKeyKsn,
    publicKeyUpdatedAt: userStatus.publicKeyUpdatedAt,
    session: {
      expiresAt: session.expiresAt,
      expiresIn,
      isValid,
    },
  };

  // Output in requested format
  switch (format) {
    case "json":
      // RFC8785 canonicalized JSON for deterministic test snapshots
      console.log(canonicalizeJSON(output));
      break;
    case "pretty":
      // Pretty print with human-readable additions
      console.log("User Status");
      console.log("===========\n");
      console.log(`AID:        ${output.aid}`);
      console.log(`Roles:      ${output.roles.join(", ")}`);
      console.log(`\nGroups:     ${output.groups.length} membership(s)`);

      if (output.groups.length > 0) {
        output.groups.forEach((group, i) => {
          console.log(`  ${i + 1}. ${group.groupName} (${group.role})`);
          console.log(`     Group ID: ${group.groupId}`);
          console.log(`     Joined: ${new Date(group.joinedAt).toISOString()}`);
        });
      }

      console.log(`\nPublic Key: ${output.publicKey ? output.publicKey.substring(0, 20) + "..." : "Not found"}`);
      console.log(`KSN:        ${output.publicKeyKsn}`);

      const expiresInSec = Math.floor(output.session.expiresIn / 1000);
      const expiresInMin = Math.floor(expiresInSec / 60);
      const expiresInHours = Math.floor(expiresInMin / 60);

      console.log(`\nSession:`);
      console.log(`  Valid:      ${output.session.isValid ? "Yes" : "No (expired)"}`);
      console.log(`  Expires at: ${new Date(output.session.expiresAt).toISOString()}`);

      if (output.session.isValid) {
        if (expiresInHours > 0) {
          console.log(`  Expires in: ${expiresInHours}h ${expiresInMin % 60}m`);
        } else if (expiresInMin > 0) {
          console.log(`  Expires in: ${expiresInMin}m ${expiresInSec % 60}s`);
        } else {
          console.log(`  Expires in: ${expiresInSec}s`);
        }

        if (expiresInSec < 300) { // Less than 5 minutes
          console.log(`  ⚠ Session will expire soon!`);
        }
      }
      break;
    case "raw":
      console.log(JSON.stringify(output));
      break;
  }
});

/**
 * Canonicalize JSON according to RFC8785
 * - Sort object keys deterministically
 * - No whitespace
 */
function canonicalizeJSON(obj: any): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJSON).join(",")}]`;
  }

  // Sort object keys
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((key) => {
    return `${JSON.stringify(key)}:${canonicalizeJSON(obj[key])}`;
  });

  return `{${entries.join(",")}}`;
}
