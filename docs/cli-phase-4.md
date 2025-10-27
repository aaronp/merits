# CLI Phase 4: Streaming & Groups

**Status**: 📋 Planning
**Prerequisites**: [Phase 3 Complete](./cli-phase-3.md) ✅
**Duration**: Week 3-4
**Next Phase**: [Phase 5: Admin & Interactive](./cli-phase-5.md)

## Overview

Implement real-time message streaming and group management functionality. This phase adds the `merits watch` command for continuous message monitoring and a full suite of group management commands.

**Key Innovation**: Session token optimization for streaming operations, eliminating repeated authentication overhead.

**Core Interface Extensions**: This phase extends the Transport and IdentityAuth interfaces from Phase 2/3 with session token support, auto-ack semantics, and group messaging capabilities.

**Related Documentation**:
- [CLI Roadmap](./roadmap-cli.md) - Overall CLI development plan
- [Phase 3 Complete](./cli-phase-3.md) - Messaging commands foundation
- [Groups System](../convex/groups.ts) - Backend group implementation
- [Transport Interface](../core/interfaces/Transport.ts) - Backend-agnostic transport API
- [IdentityAuth Interface](../core/interfaces/IdentityAuth.ts) - Challenge/response auth

---

## ⚠️ Transport Interface Extensions (Phase 4)

Phase 4 extends the Transport interface from Phase 2/3 to support streaming and session tokens:

### New Methods

```typescript
// core/interfaces/Transport.ts - Phase 4 additions

export interface Transport {
  // ... Phase 2/3 methods (sendMessage, receiveMessages, ackMessage) ...

  /**
   * Open authenticated session for streaming operations (Phase 4)
   * Returns short-lived token that can be reused without signing
   */
  openSession(req: {
    aid: AID;
    scopes: ("receive" | "ack")[];
    ttlMs: number;
    auth: AuthProof;
  }): Promise<{ token: string; expiresAt: number }>;

  /**
   * Subscribe to real-time messages (Phase 4 - extended)
   * Accepts either auth proof OR session token
   */
  subscribe(opts: SubscribeOptions): Promise<() => void>;

  /**
   * Refresh session token for active subscription (Phase 4)
   * Allows token rotation without tearing down connection
   */
  refreshSessionToken(opts: {
    for: AID;
    sessionToken: string;
  }): Promise<void>;
}

/**
 * Phase 4: Extended SubscribeOptions with session token support
 */
export interface SubscribeOptions {
  for: AID;

  // Either an AuthProof (interactive) OR a short-lived session token (streaming)
  auth?: AuthProof;
  sessionToken?: string;

  // Incoming message handler
  // Return true to auto-ack (server will acknowledge)
  // Return false to skip auto-ack (manual ack required)
  onMessage: (msg: EncryptedMessage) => Promise<boolean> | boolean;

  // Optional hooks (Phase 4 additions)
  onError?: (err: Error) => void;
  onClose?: () => void;

  // Auto-ack override (Phase 4)
  // If true, server auto-acks after onMessage returns successfully
  // Overrides onMessage() return value semantics
  autoAck?: boolean;
}
```

### Updated Methods

```typescript
/**
 * Acknowledge message receipt (Phase 4 - extended)
 * Now accepts either auth proof OR session token
 */
ackMessage(req: {
  messageId: string;
  receiptSig?: string[];
  auth?: AuthProof;        // Original Phase 3 method
  sessionToken?: string;   // Phase 4 addition for streaming
}): Promise<void>;
```

### IdentityAuth Purpose Extensions

Phase 4 adds new auth purposes:

```typescript
// core/interfaces/IdentityAuth.ts - Phase 4 additions

export type Purpose =
  | "send"
  | "receive"
  | "ack"
  | "admin"
  | "manageGroup"      // Existing from Phase 2
  | "sendGroup"        // Phase 4: Send to group
  | "openSession";     // Phase 4: Create session token
```

**Note**: All Phase 4 Transport extensions will be upstreamed to `core/interfaces/Transport.ts` during implementation.

---

## Goals

### Primary Goals
1. Real-time message streaming with `merits watch`
2. Session token optimization for continuous operations
3. Complete group management commands
4. Server-side message fanout for groups
5. Role-based group access control

### Secondary Goals
- Batch acknowledgment operations
- Auto-reconnect on connection loss
- Message filtering and routing
- Group invitation system

### Performance Goals
- Watch mode: <100ms per message (using session tokens)
- Batch ack: <500ms for 10 messages
- Group fanout: Transparent to sender (server-side)

---

## Commands

### 1. `merits watch`

**Purpose**: Stream messages in real-time with continuous acknowledgment

**Syntax**:
```bash
merits watch [options]

Options:
  --from <identity>        Watch as this identity (default: config.defaultIdentity)
  --auto-ack               Automatically acknowledge messages (default: true)
  --plaintext              Decrypt and show plaintext
  --format <type>          Output format (json|text|compact)
  --filter <pattern>       Filter messages by sender or content
```

**Implementation Strategy**:

```typescript
// cli/commands/watch.ts
import { getSessionToken } from "../lib/getAuthProof";
import type { CLIContext } from "../lib/context";

export interface WatchOptions {
  from?: string;
  autoAck?: boolean;
  plaintext?: boolean;
  format?: "json" | "text" | "compact";
  filter?: string;
  _ctx: CLIContext;
}

export async function watchMessages(opts: WatchOptions): Promise<void> {
  const ctx = opts._ctx;
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No default identity set. Use --from or: merits identity set-default <name>");
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Silent in JSON mode (for scripting/logging)
  const isJsonMode = opts.format === "json" || ctx.config.outputFormat === "json";

  if (!isJsonMode) {
    console.log(`👀 Watching for messages as ${identityName}...`);
    console.log("Press Ctrl+C to stop\n");
  }

  // Open authenticated session with short-lived token
  let { sessionToken, expiresAt } = await getSessionToken(
    ctx,
    identityName,
    ["receive", "ack"],
    60000 // 60 second token
  );

  let messageCount = 0;
  let ackCount = 0;
  let refreshInterval: NodeJS.Timeout | undefined;

  // Subscribe with session token (no repeated auth needed)
  const unsubscribe = await ctx.client.transport.subscribe({
    for: identity.aid,
    sessionToken,

    // Auto-ack preference (server-side)
    // If true: server acks after onMessage returns successfully
    // If false: messages remain unread until explicit ack
    autoAck: opts.autoAck !== false,

    onMessage: async (msg) => {
      messageCount++;

      // Decrypt if requested (using vault from Phase 2/3)
      let plaintext: string | undefined;
      if (opts.plaintext) {
        try {
          plaintext = await ctx.vault.decrypt(identityName, msg.ct);
        } catch (err) {
          plaintext = `[Decryption failed: ${(err as Error).message}]`;
        }
      }

      // Display message
      displayMessage(msg, plaintext, opts.format, isJsonMode);

      // Return true for server-side auto-ack
      // (Server will ack using session token, no client signing needed)
      return opts.autoAck !== false;
    },

    onError: (error) => {
      if (!isJsonMode) {
        console.error("Stream error:", error.message);
      }
    },

    onClose: () => {
      if (!isJsonMode) {
        console.log(`\n📊 Session ended: ${messageCount} messages, ${ackCount} acknowledged`);
      }
    },
  });

  // Handle Ctrl+C gracefully
  const cleanup = async () => {
    if (!isJsonMode) {
      console.log("\nStopping watch...");
    }
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
    await unsubscribe();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);

  // Auto-refresh token before expiry
  refreshInterval = setInterval(async () => {
    const timeLeft = expiresAt - Date.now();
    if (timeLeft < 10000) {
      // Refresh token with 10s buffer
      const newSession = await getSessionToken(
        ctx,
        identityName,
        ["receive", "ack"],
        60000
      );
      sessionToken = newSession.sessionToken;
      expiresAt = newSession.expiresAt;

      // Update subscription with new token
      await ctx.client.transport.refreshSessionToken({
        for: identity.aid,
        sessionToken,
      });

      if (!isJsonMode) {
        console.log("🔄 Session token refreshed");
      }
    }
  }, 5000);

  // Wait indefinitely (cleanup on SIGINT)
  await new Promise(() => {});
}

/**
 * Display message in requested format
 */
function displayMessage(
  msg: any,
  plaintext: string | undefined,
  format: string | undefined,
  isJsonMode: boolean
) {
  if (isJsonMode || format === "json") {
    // Structured output for scripts/logs
    console.log(JSON.stringify({ ...msg, plaintext }, null, 2));
  } else if (format === "compact") {
    // Compact one-line format
    const content = plaintext || `${msg.ct.slice(0, 20)}...`;
    console.log(`${msg.id} | ${msg.from} | ${content}`);
  } else {
    // Human-friendly default format
    console.log(`\n📨 New message from ${msg.from}`);
    console.log(`   ID: ${msg.id}`);
    if (plaintext) {
      console.log(`   Message: ${plaintext}`);
    } else {
      console.log(`   Ciphertext: ${msg.ct.slice(0, 50)}...`);
    }
  }
}
```

**Key Implementation Notes**:

1. **Server-Side Auto-Ack**: The `autoAck` option tells the server to acknowledge messages after `onMessage` returns successfully. This eliminates client-side ack calls and signing overhead.

2. **Vault Decryption**: Uses `ctx.vault.decrypt(identityName, ct)` from Phase 2/3, maintaining consistency with Phase 3's `receive` command.

3. **JSON Mode Silence**: All banners and emoji logs are suppressed when `--format json` is specified, making output scriptable.

4. **Graceful Cleanup**: Clears refresh interval and calls unsubscribe before exiting on SIGINT.

5. **Token Refresh**: Uses `transport.refreshSessionToken()` to rotate tokens mid-stream without tearing down the subscription.

6. **Auto-Ack Semantics**:
   - `--auto-ack` (default): Messages removed from unread queue immediately (at-most-once delivery)
   - `--no-auto-ack`: Messages remain unread until explicit `merits ack` (at-least-once delivery)

**Example Usage**:
```bash
# Basic watch with auto-ack
merits watch

# Watch and decrypt messages
merits watch --plaintext

# Watch without auto-ack (manual acknowledgment)
merits watch --no-auto-ack

# Watch with JSON output (for logging)
merits watch --format json > message-log.json

# Watch as specific identity
merits watch --from work-identity
```

**Key Features**:
- Session token eliminates repeated signing
- Auto-reconnect on connection loss
- Graceful shutdown (Ctrl+C)
- Token auto-refresh before expiry

---

### 2. Group Management Commands

#### `merits group create`

**Purpose**: Create a new group

**Syntax**:
```bash
merits group create <name> [options]

Arguments:
  <name>                   Group name

Options:
  --description <text>     Group description
  --from <identity>        Creator identity (default: config.defaultIdentity)
  --format <type>          Output format (json|text)
```

**Implementation**:

```typescript
// cli/commands/group/create.ts
import { getAuthProof } from "../../lib/getAuthProof";
import type { CLIContext } from "../../lib/context";

export interface GroupCreateOptions {
  description?: string;
  from?: string;
  format?: "json" | "text";
  _ctx: CLIContext;
}

export async function createGroup(name: string, opts: GroupCreateOptions): Promise<void> {
  const ctx = opts._ctx;
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No default identity set. Use --from or: merits identity set-default <name>");
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Auth proof with purpose "manageGroup"
  const auth = await getAuthProof(ctx, identityName, "manageGroup", {
    action: "create",
    name,
  });

  // Create group via GroupApi
  const result = await ctx.client.group.createGroup({
    name,
    description: opts.description,
    auth,
  });

  // Output result
  if (opts.format === "json" || ctx.config.outputFormat === "json") {
    console.log(JSON.stringify({ groupId: result.groupId, name }, null, 2));
  } else {
    console.log(`✅ Group created!`);
    console.log(`   Group ID: ${result.groupId}`);
    console.log(`   Name: ${name}`);
  }
}
```

#### `merits group list`

**Purpose**: List all groups (owned, admin, or member)

**Syntax**:
```bash
merits group list [options]

Options:
  --from <identity>        Identity to list groups for (default: config.defaultIdentity)
  --format <type>          Output format (json|text|compact)
```

**Implementation**:

```typescript
// cli/commands/group/list.ts
import { getAuthProof } from "../../lib/getAuthProof";

export async function listGroups(opts: GroupListOptions): Promise<void> {
  const ctx = opts._ctx;
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No default identity set");
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Auth proof
  const auth = await getAuthProof(ctx, identityName, "manageGroup", {
    action: "list",
  });

  // List groups
  const groups = await ctx.client.group.listGroups({
    aid: identity.aid,
    auth,
  });

  // Output
  if (opts.format === "json" || ctx.config.outputFormat === "json") {
    console.log(JSON.stringify(groups, null, 2));
  } else {
    for (const group of groups) {
      console.log(`${group.id} | ${group.name} | ${group.role}`);
    }
  }
}
```

#### `merits group info`

**Purpose**: Show detailed group information

**Syntax**:
```bash
merits group info <group-id> [options]

Arguments:
  <group-id>               Group ID

Options:
  --from <identity>        Identity requesting info (default: config.defaultIdentity)
  --format <type>          Output format (json|text)
```

**Implementation**: Similar pattern, uses `getAuthProof(ctx, identityName, "manageGroup", { action: "info", groupId })` then calls `client.group.getGroup({ groupId, auth })`.

#### `merits group add`

**Purpose**: Add member to group

**Syntax**:
```bash
merits group add <group-id> <member-aid> [options]

Arguments:
  <group-id>               Group ID
  <member-aid>             AID to add

Options:
  --role <role>            Member role (member|admin|owner) (default: member)
  --from <identity>        Identity performing action (default: config.defaultIdentity)
```

**Implementation**:

```typescript
// cli/commands/group/add.ts
export async function addMember(
  groupId: string,
  memberAid: AID,
  opts: GroupAddOptions
): Promise<void> {
  const ctx = opts._ctx;
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No default identity set");
  }

  // Auth proof with all relevant args
  const auth = await getAuthProof(ctx, identityName, "manageGroup", {
    action: "addMember",
    groupId,
    members: [memberAid],
    role: opts.role || "member",
  });

  // Add member
  await ctx.client.group.addMembers({
    groupId,
    members: [memberAid],
    role: opts.role,
    auth,
  });

  console.log(`✅ Added ${memberAid} to group ${groupId}`);
}
```

#### `merits group remove`

**Purpose**: Remove member from group

**Syntax**:
```bash
merits group remove <group-id> <member-aid> [options]

Arguments:
  <group-id>               Group ID
  <member-aid>             AID to remove

Options:
  --from <identity>        Identity performing action (default: config.defaultIdentity)
```

**Implementation**: Uses `getAuthProof(ctx, identityName, "manageGroup", { action: "removeMember", groupId, members: [memberAid] })` then calls `client.group.removeMembers({ groupId, members: [memberAid], auth })`.

#### `merits group leave`

**Purpose**: Leave a group

**Syntax**:
```bash
merits group leave <group-id> [options]

Arguments:
  <group-id>               Group ID to leave

Options:
  --from <identity>        Identity leaving (default: config.defaultIdentity)
  --transfer-to <aid>      Transfer ownership (required if sole owner)
```

**Ownership Transfer Rules**:
1. If the leaver is the **sole owner**, `--transfer-to` is **required**
2. If they are **not an owner**, `--transfer-to` is ignored
3. If they're an owner but there are **other owners**, transfer is optional

**Implementation**:

```typescript
// cli/commands/group/leave.ts
export async function leaveGroup(groupId: string, opts: GroupLeaveOptions): Promise<void> {
  const ctx = opts._ctx;
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No default identity set");
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Auth proof
  const auth = await getAuthProof(ctx, identityName, "manageGroup", {
    action: "leave",
    groupId,
    transferTo: opts.transferTo,
  });

  // Leave group
  await ctx.client.group.leaveGroup({
    groupId,
    transferOwnershipTo: opts.transferTo,
    auth,
  });

  console.log(`✅ Left group ${groupId}`);
  if (opts.transferTo) {
    console.log(`   Ownership transferred to ${opts.transferTo}`);
  }
}
```

**All Group Commands**: Use `--from` to specify identity (defaults to `config.defaultIdentity`). All commands require auth proof with purpose `"manageGroup"` and action-specific args.

---

## Session Token System

### Overview

Session tokens are **scoped bearer tokens** that eliminate repeated authentication overhead for streaming operations. A single auth proof creates a short-lived token reusable for multiple operations.

**Security Model**: Anyone who possesses the token can act as that AID for the specified scopes until expiry. This is acceptable because:
- Tokens are short-lived (≤60s)
- Tokens are scoped to specific operations
- Tokens are bound to AID + key state number (KSN)
- Token refresh requires fresh vault signature

### Token Lifecycle

```typescript
// 1. Issue token with initial auth proof (requires vault signing)
const { sessionToken, expiresAt } = await getSessionToken(
  ctx,
  "alice",
  ["receive", "ack"],
  60000 // 60 seconds
);

// 2. Use token for multiple operations (no signing required!)
await client.transport.subscribe({
  for: aliceAid,
  sessionToken, // No auth proof needed
  autoAck: true, // Server acks using session token
  onMessage: async (msg) => {
    // Message processed, server auto-acks
    // No client signing or ackMessage call needed!
  },
});

// 3. Token expires after 60s
// Must refresh with new auth proof (requires vault signing again)
const newSession = await getSessionToken(ctx, "alice", ["receive", "ack"], 60000);
await client.transport.refreshSessionToken({
  for: aliceAid,
  sessionToken: newSession.sessionToken,
});
```

### Security Properties

1. **Short-lived**: Maximum 60 second lifetime (configurable via ttlMs)
2. **Scoped**: Limited to specific purposes (e.g., "receive" and "ack")
3. **AID-bound**: Token is only valid for the AID it was issued for
4. **KSN-bound**: Token invalidated if AID rotates keys (KSN mismatch)
5. **Non-extendable**: Cannot extend existing token, must issue new one with fresh proof
6. **Refresh requires signing**: Each refresh needs a new vault signature (prevents silent token extension)

**Key Rotation Protection**: If an attacker steals a token, then the victim rotates their keys (increments KSN), the stolen token becomes invalid. The backend must verify that the token's KSN matches the current AID's KSN.

### Implementation

```typescript
// cli/lib/getAuthProof.ts (extend existing file)

/**
 * Get session token for streaming operations
 *
 * Issues an authentication proof to create a short-lived bearer token
 * that can be reused for multiple operations without signing.
 *
 * @param ctx - CLI context (client + vault + config)
 * @param identityName - Identity name in vault
 * @param scopes - Operations allowed (e.g., ["receive", "ack"])
 * @param ttlMs - Token lifetime in milliseconds (max 60000)
 * @returns Session token and expiry timestamp
 */
export async function getSessionToken(
  ctx: CLIContext,
  identityName: string,
  scopes: ("receive" | "ack")[],
  ttlMs = 60000
): Promise<{ sessionToken: string; expiresAt: number }> {
  // Get identity from vault
  const identity = await ctx.vault.getIdentity(identityName);

  // Issue auth proof for session creation
  // Purpose: "openSession" (new in Phase 4)
  const auth = await getAuthProof(
    ctx,
    identityName,
    "openSession",
    {
      scopes,
      ttlMs, // Consistent naming with Transport interface
    }
  );

  // Create session via Transport interface
  const session = await ctx.client.transport.openSession({
    aid: identity.aid,
    scopes,
    ttlMs,
    auth,
  });

  return {
    sessionToken: session.token,
    expiresAt: session.expiresAt,
  };
}
```

### Backend Requirements

The backend must implement:

1. **Token Issuance** (`openSession` mutation):
   - Verify auth proof with purpose "openSession"
   - Generate cryptographically random token
   - Store token with: `{ aid, ksn, scopes, expiresAt }`
   - Return `{ token, expiresAt }`

2. **Token Validation** (in `receive`, `ack`, `subscribe` mutations):
   - Accept either `auth: AuthProof` OR `sessionToken: string`
   - If `sessionToken` provided:
     - Verify token exists and not expired
     - Verify token's AID matches request AID
     - Verify token's KSN matches current AID's KSN (key rotation check)
     - Verify scope matches operation (e.g., "receive" scope for receive operation)

3. **Token Refresh** (`refreshSessionToken` mutation):
   - Allows updating session token mid-stream without tearing down connection
   - Backend updates internal token reference for active subscriptions

4. **Token Expiry Cleanup**:
   - Periodic job to delete expired tokens
   - Immediate revocation on key rotation (KSN mismatch)

### Token Refresh Strategy

For long-lived `watch` sessions, tokens must be refreshed before expiry:

```typescript
// Auto-refresh with 10 second buffer
const refreshInterval = setInterval(async () => {
  const timeLeft = expiresAt - Date.now();
  if (timeLeft < 10000) {
    // Get fresh token (requires new vault signature)
    const newSession = await getSessionToken(
      ctx,
      identityName,
      ["receive", "ack"],
      60000
    );

    // Update active subscription without disconnecting
    await ctx.client.transport.refreshSessionToken({
      for: identity.aid,
      sessionToken: newSession.sessionToken,
    });

    // Update local tracking
    sessionToken = newSession.sessionToken;
    expiresAt = newSession.expiresAt;
  }
}, 5000); // Check every 5 seconds
```

**Important**: Token refresh requires a fresh auth proof, which requires vault signing. This ensures periodic cryptographic proof of possession even during long-lived sessions.

---

## Group Messaging Flow

### Sending to Groups

Groups use the **same CLI syntax** as direct messages. The CLI detects whether the recipient is an AID or group ID automatically:

```bash
# Send to user (AID detected)
merits send DHytGsw0r-wYg0DSf_4l_D594hXtKH_e5-zMIdlM --message "Hello Alice!"

# Send to group (group ID detected)
merits send 01HMXD7G8K9Q2R3S4T5V6W7X8Y9Z --message "Hello team!"
```

### Group Detection Logic

The `send` command must distinguish between AIDs and group IDs to route correctly:

```typescript
// cli/commands/send.ts (Phase 4 update)
import { isValidAID } from "../../core/types";

export async function sendMessage(recipient: string, opts: SendOptions): Promise<void> {
  const ctx = opts._ctx;
  const identityName = opts.from || ctx.config.defaultIdentity;

  if (!identityName) {
    throw new Error("No default identity set. Use --from or: merits identity set-default <name>");
  }

  const identity = await ctx.vault.getIdentity(identityName);

  // Detect recipient type
  const isDirect = isValidAID(recipient);

  if (isDirect) {
    // Direct message to AID
    await sendDirectMessage(ctx, identity, recipient, opts);
  } else {
    // Group message (assume group ID)
    await sendGroupMessage(ctx, identity, recipient, opts);
  }
}

/**
 * Send direct message to AID
 */
async function sendDirectMessage(
  ctx: CLIContext,
  identity: Identity,
  recipientAid: AID,
  opts: SendOptions
): Promise<void> {
  // ... existing Phase 3 send logic ...

  // Auth proof with purpose "send"
  const auth = await getAuthProof(ctx, identity.name, "send", {
    to: recipientAid,
    ctHash,
    ttlMs,
  });

  const result = await ctx.client.transport.sendMessage({
    to: recipientAid,
    ct,
    ttlMs,
    auth,
  });

  // ... output result ...
}

/**
 * Send group message
 * Backend handles fanout to all members
 */
async function sendGroupMessage(
  ctx: CLIContext,
  identity: Identity,
  groupId: string,
  opts: SendOptions
): Promise<void> {
  // Get message content (same as direct send)
  const plaintext = opts.message || (await readStdin());
  const ct = await encryptMessage(plaintext, identity.publicKey);
  const ctHash = sha256Hex(new TextEncoder().encode(ct));
  const ttlMs = opts.ttl ?? 24 * 60 * 60 * 1000;

  // Auth proof with purpose "sendGroup" (Phase 4)
  const auth = await getAuthProof(ctx, identity.name, "sendGroup", {
    groupId,
    ctHash,
    ttlMs,
  });

  // Send via GroupApi interface
  const result = await ctx.client.group.sendGroupMessage({
    groupId,
    ct,
    ttlMs,
    auth,
  });

  // Output result
  if (opts.format === "json" || ctx.config.outputFormat === "json") {
    console.log(JSON.stringify({ messageId: result.messageId, groupId, sentAt: Date.now() }, null, 2));
  } else {
    console.log(`✅ Message sent to group!`);
    console.log(`   Message ID: ${result.messageId}`);
  }
}
```

**Key Points**:
1. **CLI doesn't fanout**: CLI always sends once, either to `transport.sendMessage` or `group.sendGroupMessage`
2. **Backend handles expansion**: Server is solely responsible for creating individual messages for each group member
3. **Different auth purposes**: `"send"` for direct messages, `"sendGroup"` for groups
4. **Same UX**: User doesn't need to know if recipient is AID or group ID

### Backend Fanout Behavior

When the backend receives a group message:

1. **Single Request**: Client sends one message to group ID
2. **Server Fanout**: Backend creates individual P2P messages for each member:
   ```typescript
   // Backend (convex/groups.ts)
   export const sendGroupMessage = mutation({
     handler: async (ctx, { groupId, ct, ttlMs, auth }) => {
       // Verify sender is group member
       const group = await getGroup(ctx, groupId);
       const members = await getGroupMembers(ctx, groupId);

       // Create individual message for each member
       const messageIds = [];
       for (const member of members) {
         // Re-encrypt for member's public key (per-member encryption)
         const memberCt = await reEncryptForMember(ct, member.aid);

         // Create P2P message
         const messageId = await ctx.db.insert("messages", {
           from: auth.aid,
           to: member.aid,
           ct: memberCt,
           ttlMs,
           createdAt: Date.now(),
         });

         messageIds.push(messageId);
       }

       // Return single message ID (first in fanout)
       return { messageId: messageIds[0] };
     },
   });
   ```

3. **Member Perspective**: Each member receives message as normal P2P message via `merits receive`
4. **Cost Model**: Sender effectively pays for N individual messages (where N = member count)

### Group Message Encryption

**Phase 4 Approach: Per-Member Encryption**
- Sender encrypts message once with placeholder encryption
- **Backend re-encrypts for each member's public key**
- Maintains end-to-end security
- No shared group key management

**Future Enhancement (Phase 5+): Shared Group Keys**
- Group has symmetric key distributed to members
- Message encrypted once with group key
- More efficient for large groups
- Requires key rotation on membership changes

**Phase 4 Decision**: Use per-member encryption to maintain E2E security without introducing group key management complexity. The backend handles re-encryption during fanout.

---

## Testing Strategy

### Test Modes

Phase 4 tests should support both real backend and mocked transport:

1. **E2E Tests with Real Backend**: Full integration tests using `CONVEX_URL`
2. **Unit Tests with Mocked Transport**: Fast tests without backend dependency
3. **--test-mode Flag**: Special watch mode for deterministic testing

### Watch Command Tests

**File**: `tests/cli/e2e/watch.test.ts`

**Note**: Watch tests spawn background processes, so they need careful stdout handling and cleanup.

```typescript
import { spawn } from "child_process";
import { eventually } from "../../helpers/eventually";

describe("E2E Watch Command", () => {
  test("watch receives and auto-acks messages", async () => {
    const aliceDir = path.join(TEST_ROOT, "alice");
    const bobDir = path.join(TEST_ROOT, "bob");

    // Setup identities
    await runCLI(["identity", "new", "alice"], { dataDir: aliceDir });
    await runCLI(["identity", "new", "bob"], { dataDir: bobDir });

    const aliceInfo = JSON.parse(
      await runCLI(["identity", "show", "alice", "--format", "json"], { dataDir: aliceDir })
    );
    const bobInfo = JSON.parse(
      await runCLI(["identity", "show", "bob", "--format", "json"], { dataDir: bobDir })
    );

    // Start watch in background with JSON output (no banners)
    const watchProcess = spawn("bun", [
      "run",
      "cli/index.ts",
      "--data-dir",
      bobDir,
      "watch",
      "--plaintext",
      "--format",
      "json",
    ]);

    const watchOutput: string[] = [];
    watchProcess.stdout.on("data", (chunk) => {
      watchOutput.push(chunk.toString());
    });

    // Wait for subscription to be ready (implementation-specific)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Alice sends message
    await runCLI(
      ["send", bobInfo.aid, "--message", "Test message", "--from", "alice"],
      { dataDir: aliceDir }
    );

    // Verify Bob receives via watch
    await eventually(
      () => {
        const allOutput = watchOutput.join("");
        return allOutput.includes("Test message");
      },
      { timeout: 5000, interval: 100 }
    );

    // Stop watch gracefully
    watchProcess.kill("SIGINT");

    // Wait for process to exit
    await new Promise((resolve) => {
      watchProcess.on("exit", resolve);
    });
  });

  test("watch --test-mode exits after first message", async () => {
    // Proposed: Add --test-mode flag to watch for deterministic testing
    // Watch subscribes, receives one message, acks, and exits automatically

    const bobDir = path.join(TEST_ROOT, "bob");

    // Start watch in test mode (blocks until first message)
    const watchPromise = runCLI(
      ["watch", "--test-mode", "--plaintext", "--from", "bob"],
      { dataDir: bobDir }
    );

    // Send message
    await runCLI(
      ["send", bobInfo.aid, "--message", "Test", "--from", "alice"],
      { dataDir: aliceDir }
    );

    // Watch should exit after receiving
    const output = await watchPromise;
    expect(output).toContain("Test");
  });
});
```

**Testing Best Practices**:
1. Use `--format json` to suppress banners in watch tests
2. Spawn watch as background process for real-time tests
3. Use `eventually()` helper for polling stdout
4. Always clean up: `watchProcess.kill("SIGINT")` and wait for exit
5. Consider adding `--test-mode` flag for deterministic watch behavior

### Group Tests

**File**: `tests/cli/e2e/groups.test.ts`

```typescript
import { eventually, eventuallyValue } from "../../helpers/eventually";

describe("E2E Group Commands", () => {
  test("create group, add members, send message", async () => {
    // Create identities
    const aliceDir = path.join(TEST_ROOT, "alice");
    const bobDir = path.join(TEST_ROOT, "bob");
    const carolDir = path.join(TEST_ROOT, "carol");

    await runCLI(["identity", "new", "alice"], { dataDir: aliceDir });
    await runCLI(["identity", "new", "bob"], { dataDir: bobDir });
    await runCLI(["identity", "new", "carol"], { dataDir: carolDir });

    // Get AIDs
    const aliceInfo = JSON.parse(
      await runCLI(["identity", "show", "alice", "--format", "json"], { dataDir: aliceDir })
    );
    const bobInfo = JSON.parse(
      await runCLI(["identity", "show", "bob", "--format", "json"], { dataDir: bobDir })
    );
    const carolInfo = JSON.parse(
      await runCLI(["identity", "show", "carol", "--format", "json"], { dataDir: carolDir })
    );

    // Alice creates group
    const createOutput = await runCLI(
      ["group", "create", "test-team", "--from", "alice", "--format", "json"],
      { dataDir: aliceDir }
    );
    const { groupId } = JSON.parse(createOutput);

    expect(groupId).toBeDefined();

    // Alice adds Bob and Carol
    await runCLI(
      ["group", "add", groupId, bobInfo.aid, "--from", "alice"],
      { dataDir: aliceDir }
    );
    await runCLI(
      ["group", "add", groupId, carolInfo.aid, "--from", "alice"],
      { dataDir: aliceDir }
    );

    // Alice sends to group
    await runCLI(
      ["send", groupId, "--message", "Hello team!", "--from", "alice"],
      { dataDir: aliceDir }
    );

    // Both Bob and Carol receive (using eventuallyValue for eventual consistency)
    const bobMessage = await eventuallyValue(
      async () => {
        const output = await runCLI(
          ["receive", "--plaintext", "--format", "json", "--from", "bob"],
          { dataDir: bobDir }
        );
        const messages = JSON.parse(output);
        return messages.find((m: any) => m.plaintext === "Hello team!");
      },
      { timeout: 5000, interval: 100, message: "Waiting for Bob to receive group message" }
    );

    const carolMessage = await eventuallyValue(
      async () => {
        const output = await runCLI(
          ["receive", "--plaintext", "--format", "json", "--from", "carol"],
          { dataDir: carolDir }
        );
        const messages = JSON.parse(output);
        return messages.find((m: any) => m.plaintext === "Hello team!");
      },
      { timeout: 5000, interval: 100, message: "Waiting for Carol to receive group message" }
    );

    expect(bobMessage.plaintext).toBe("Hello team!");
    expect(carolMessage.plaintext).toBe("Hello team!");
    expect(bobMessage.from).toBe(aliceInfo.aid);
    expect(carolMessage.from).toBe(aliceInfo.aid);
  });

  test("group ownership transfer on leave", async () => {
    // Alice creates group and adds Bob
    const { groupId } = JSON.parse(
      await runCLI(["group", "create", "test", "--from", "alice", "--format", "json"], { dataDir: aliceDir })
    );
    await runCLI(["group", "add", groupId, bobInfo.aid, "--role", "member", "--from", "alice"], { dataDir: aliceDir });

    // Alice tries to leave without transfer (should fail - sole owner)
    await expect(
      runCLI(["group", "leave", groupId, "--from", "alice"], { dataDir: aliceDir })
    ).rejects.toThrow(/transfer/i);

    // Alice leaves with transfer to Bob (should succeed)
    await runCLI(["group", "leave", groupId, "--transfer-to", bobInfo.aid, "--from", "alice"], { dataDir: aliceDir });

    // Verify Bob is now owner
    const groupInfo = JSON.parse(
      await runCLI(["group", "info", groupId, "--from", "bob", "--format", "json"], { dataDir: bobDir })
    );
    expect(groupInfo.members.find((m: any) => m.aid === bobInfo.aid).role).toBe("owner");
  });
});
```

**Testing Considerations**:
1. **Backend Fanout**: Tests assume backend implements group message fanout
2. **Eventual Consistency**: Use `eventuallyValue()` for group message delivery (fanout takes time)
3. **Real Backend Required**: These tests need `CONVEX_URL` set (can't mock group fanout easily)
4. **CI Strategy**: Consider stubbing Transport layer for faster unit tests, use real backend only for smoke tests

---

## Implementation Checklist

### Session Tokens
- [ ] Add `getSessionToken()` to `cli/lib/getAuthProof.ts`
- [ ] Backend: `openSession` mutation
- [ ] Backend: Token validation in mutations
- [ ] Backend: Token expiry cleanup
- [ ] CLI: Token refresh logic
- [ ] Tests: Session token lifecycle

### Watch Command
- [ ] `cli/commands/watch.ts` implementation
- [ ] Subscribe with session token
- [ ] Auto-ack functionality
- [ ] Graceful shutdown (SIGINT)
- [ ] Token auto-refresh
- [ ] Message filtering
- [ ] Tests: Watch receives and acks messages

### Group Commands
- [ ] `cli/commands/group/create.ts`
- [ ] `cli/commands/group/list.ts`
- [ ] `cli/commands/group/info.ts`
- [ ] `cli/commands/group/add.ts`
- [ ] `cli/commands/group/remove.ts`
- [ ] `cli/commands/group/leave.ts`
- [ ] Tests: Full group lifecycle

### Group Messaging
- [ ] Update `send` command to detect group IDs
- [ ] Backend: Group message fanout
- [ ] Backend: Per-member encryption
- [ ] Tests: Group message delivery

---

## Success Criteria

### Functional
- ✅ `merits watch` receives messages in real-time
- ✅ Session tokens eliminate repeated signing
- ✅ Auto-ack works with session tokens
- ✅ All group commands implemented
- ✅ Group messaging with server-side fanout

### Performance
- ⚡ Watch ack: <100ms (session token, no signing)
- ⚡ Batch ack 10 messages: <500ms
- ⚡ Group send (5 members): <2s

### Security
- 🔐 Session tokens <60s lifetime
- 🔐 Tokens scoped to specific purposes
- 🔐 Token refresh requires fresh auth
- 🔐 Group permissions enforced

### UX
- ✅ Watch provides real-time feedback
- ✅ Graceful shutdown on Ctrl+C
- ✅ Group commands intuitive
- ✅ Error messages helpful

---

## Dependencies

### New Dependencies
```json
{
  "@types/node": "^20.0.0"  // For process.stdin, setInterval, etc.
}
```

All other dependencies already available from Phase 1-3.

---

## Files to Create/Modify

```
cli/
├── lib/
│   └── getAuthProof.ts        # EXTEND: Add getSessionToken()
└── commands/
    ├── watch.ts               # NEW: Watch command
    └── group/
        ├── create.ts          # NEW: Create group
        ├── list.ts            # NEW: List groups
        ├── info.ts            # NEW: Group info
        ├── add.ts             # NEW: Add member
        ├── remove.ts          # NEW: Remove member
        └── leave.ts           # NEW: Leave group

convex/
├── messages.ts                # MODIFY: Add session token support
└── groups.ts                  # MODIFY: Add CLI-facing queries/mutations

tests/cli/
└── e2e/
    ├── watch.test.ts          # NEW: Watch command tests
    └── groups.test.ts         # NEW: Group command tests
```

---

## Implementation Order

### Week 3, Days 1-3: Session Tokens & Watch

1. **Session token infrastructure**
   - Backend: `openSession` mutation
   - Backend: Token validation
   - CLI: `getSessionToken()` helper
   - Tests

2. **Watch command**
   - Subscribe with session token
   - Auto-ack with token reuse
   - Token refresh logic
   - Graceful shutdown
   - Tests

### Week 3, Days 4-5: Group Commands (Part 1)

3. **Core group commands**
   - `group create`
   - `group list`
   - `group info`
   - Tests

### Week 4, Days 1-2: Group Commands (Part 2)

4. **Group membership**
   - `group add`
   - `group remove`
   - `group leave`
   - Tests

### Week 4, Days 3-5: Group Messaging

5. **Group messaging**
   - Update `send` to detect groups
   - Backend fanout implementation
   - Per-member encryption
   - End-to-end tests

---

## Future Enhancements (Phase 5+)

Deferred to later phases:
- Message filtering/routing (`--filter` flag in watch)
- Group invitations with accept/reject
- Group message threading
- Read receipts for group messages
- Group analytics (message counts, active members)
- Shared group keys for efficient encryption

---

## Next Steps

After Phase 4 completion:
1. Create `cli-phase-4-complete.md` with results
2. Update roadmap with completion status
3. Begin Phase 5 (Admin & Interactive)

**Related**: [Phase 5: Admin & Interactive](./cli-phase-5.md) (to be created)

---

**Status**: 📋 Planning
**Prerequisites**: Phase 3 ✅
**Estimated Effort**: 1 week

**Key Deliverables**:
- Session token system (watch without repeated auth)
- Real-time message streaming
- Complete group management
- Group messaging with fanout
